import db from "@/lib/db";
import { publishViewingSessionRealtimeEvent } from "@/lib/realtime/viewing-session-events";
import { resolveLiveModelForMode } from "@/lib/viewings/sessions/live-models";
import { generateViewingSessionJoinSecrets } from "@/lib/viewings/sessions/security";
import { VIEWING_SESSION_EVENT_TYPES, VIEWING_SESSION_MODES, VIEWING_SESSION_STATUSES } from "@/lib/viewings/sessions/types";

export const VIEWING_SESSION_JOIN_MAX_ATTEMPTS = 5;
export const VIEWING_SESSION_JOIN_LOCK_MINUTES = 10;
export const VIEWING_SESSION_CHAIN_THRESHOLD_MINUTES = 14;
export const VIEWING_SESSION_LIVE_LIMIT_MINUTES = 15;

export function appendJoinAuditEntry(
    existingAudit: unknown,
    entry: Record<string, unknown>,
    maxEntries: number = 30
): Record<string, unknown> {
    const resolvedMaxEntries = Math.min(Math.max(Number(maxEntries || 30), 5), 200);
    const current = existingAudit && typeof existingAudit === "object" ? (existingAudit as Record<string, unknown>) : {};
    const existingEntries = Array.isArray((current as any).entries) ? (current as any).entries : [];
    const nextEntries = [...existingEntries, entry].slice(-resolvedMaxEntries);
    return {
        ...current,
        entries: nextEntries,
        updatedAt: new Date().toISOString(),
    };
}

function normalizeMode(mode: string | null | undefined) {
    if (mode === VIEWING_SESSION_MODES.assistantLiveVoicePremium) {
        return VIEWING_SESSION_MODES.assistantLiveVoicePremium;
    }
    return VIEWING_SESSION_MODES.assistantLiveToolHeavy;
}

export async function ensureViewingSessionWithinLiveWindow(sessionId: string): Promise<{
    sessionId: string;
    chained: boolean;
    previousSessionId: string | null;
    chainIndex: number;
}> {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
        throw new Error("Missing sessionId.");
    }

    const session = await db.viewingSession.findUnique({
        where: { id: normalizedSessionId },
        include: {
            nextSessions: {
                where: {
                    status: {
                        in: [
                            VIEWING_SESSION_STATUSES.scheduled,
                            VIEWING_SESSION_STATUSES.active,
                            VIEWING_SESSION_STATUSES.paused,
                        ],
                    },
                },
                orderBy: [{ chainIndex: "desc" }, { createdAt: "desc" }],
                take: 1,
            },
        },
    });
    if (!session) {
        throw new Error("Viewing session not found.");
    }

    if (session.status !== VIEWING_SESSION_STATUSES.active || !session.startedAt) {
        const existingNext = session.nextSessions[0];
        if (existingNext?.id) {
            return {
                sessionId: existingNext.id,
                chained: true,
                previousSessionId: session.id,
                chainIndex: existingNext.chainIndex,
            };
        }
        return {
            sessionId: session.id,
            chained: false,
            previousSessionId: session.previousSessionId || null,
            chainIndex: session.chainIndex,
        };
    }

    const ageMs = Date.now() - new Date(session.startedAt).getTime();
    const thresholdMs = VIEWING_SESSION_CHAIN_THRESHOLD_MINUTES * 60 * 1000;
    if (ageMs < thresholdMs) {
        return {
            sessionId: session.id,
            chained: false,
            previousSessionId: session.previousSessionId || null,
            chainIndex: session.chainIndex,
        };
    }

    const existingNext = session.nextSessions[0];
    if (existingNext?.id) {
        return {
            sessionId: existingNext.id,
            chained: true,
            previousSessionId: session.id,
            chainIndex: existingNext.chainIndex,
        };
    }

    const mode = normalizeMode(session.mode);
    const secrets = generateViewingSessionJoinSecrets();
    const now = new Date();

    const chainedSession = await db.$transaction(async (tx) => {
        const next = await tx.viewingSession.create({
            data: {
                locationId: session.locationId,
                viewingId: session.viewingId,
                contactId: session.contactId,
                primaryPropertyId: session.primaryPropertyId,
                currentActivePropertyId: session.currentActivePropertyId,
                relatedPropertyIds: Array.isArray(session.relatedPropertyIds) ? session.relatedPropertyIds : [],
                agentId: session.agentId,
                clientName: session.clientName || null,
                clientLanguage: session.clientLanguage || null,
                agentLanguage: session.agentLanguage || null,
                mode,
                status: VIEWING_SESSION_STATUSES.active,
                sessionLinkTokenHash: secrets.tokenHash,
                pinCodeHash: secrets.pinCodeHash,
                pinCodeSalt: secrets.pinCodeSalt,
                tokenExpiresAt: secrets.expiresAt,
                startedAt: now,
                notes: session.notes || null,
                audioPlaybackClientEnabled: session.audioPlaybackClientEnabled,
                audioPlaybackAgentEnabled: session.audioPlaybackAgentEnabled,
                liveModel: session.liveModel || resolveLiveModelForMode(mode),
                contextVersion: session.contextVersion,
                chainIndex: session.chainIndex + 1,
                previousSessionId: session.id,
                contextSnapshot: session.contextSnapshot || undefined,
            },
            select: {
                id: true,
                chainIndex: true,
            },
        });

        await tx.viewingSession.update({
            where: { id: session.id },
            data: {
                status: VIEWING_SESSION_STATUSES.expired,
                endedAt: now,
            },
        });

        return next;
    });

    await Promise.all([
        publishViewingSessionRealtimeEvent({
            sessionId: session.id,
            locationId: session.locationId,
            type: VIEWING_SESSION_EVENT_TYPES.statusChanged,
            payload: {
                sessionId: session.id,
                status: VIEWING_SESSION_STATUSES.expired,
                chainedToSessionId: chainedSession.id,
                endedAt: now.toISOString(),
            },
        }),
        publishViewingSessionRealtimeEvent({
            sessionId: chainedSession.id,
            locationId: session.locationId,
            type: VIEWING_SESSION_EVENT_TYPES.statusChanged,
            payload: {
                sessionId: chainedSession.id,
                status: VIEWING_SESSION_STATUSES.active,
                chainedFromSessionId: session.id,
                startedAt: now.toISOString(),
            },
        }),
    ]);

    return {
        sessionId: chainedSession.id,
        chained: true,
        previousSessionId: session.id,
        chainIndex: chainedSession.chainIndex,
    };
}
