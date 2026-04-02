import db from "@/lib/db";
import { publishViewingSessionRealtimeEvent } from "@/lib/realtime/viewing-session-events";
import { appendViewingSessionEvent } from "@/lib/viewings/sessions/events";
import { resolveLiveModelForMode } from "@/lib/viewings/sessions/live-models";
import { generateViewingSessionJoinSecrets } from "@/lib/viewings/sessions/security";
import {
    VIEWING_SESSION_EVENT_TYPES,
    VIEWING_SESSION_MODES,
    VIEWING_SESSION_STATUSES,
    VIEWING_SESSION_TRANSPORT_STATUSES,
    type ViewingSessionTransportStatus,
} from "@/lib/viewings/sessions/types";

export const VIEWING_SESSION_JOIN_MAX_ATTEMPTS = 5;
export const VIEWING_SESSION_JOIN_LOCK_MINUTES = 10;
export const VIEWING_SESSION_CHAIN_THRESHOLD_MINUTES = 14;
export const VIEWING_SESSION_LIVE_LIMIT_MINUTES = 15;

const TRANSPORT_TRANSITIONS: Record<ViewingSessionTransportStatus, Set<ViewingSessionTransportStatus>> = {
    [VIEWING_SESSION_TRANSPORT_STATUSES.disconnected]: new Set([
        VIEWING_SESSION_TRANSPORT_STATUSES.connecting,
    ]),
    [VIEWING_SESSION_TRANSPORT_STATUSES.connecting]: new Set([
        VIEWING_SESSION_TRANSPORT_STATUSES.connected,
        VIEWING_SESSION_TRANSPORT_STATUSES.degraded,
        VIEWING_SESSION_TRANSPORT_STATUSES.disconnected,
        VIEWING_SESSION_TRANSPORT_STATUSES.failed,
    ]),
    [VIEWING_SESSION_TRANSPORT_STATUSES.connected]: new Set([
        VIEWING_SESSION_TRANSPORT_STATUSES.reconnecting,
        VIEWING_SESSION_TRANSPORT_STATUSES.degraded,
        VIEWING_SESSION_TRANSPORT_STATUSES.disconnected,
        VIEWING_SESSION_TRANSPORT_STATUSES.chained,
        VIEWING_SESSION_TRANSPORT_STATUSES.failed,
    ]),
    [VIEWING_SESSION_TRANSPORT_STATUSES.reconnecting]: new Set([
        VIEWING_SESSION_TRANSPORT_STATUSES.connected,
        VIEWING_SESSION_TRANSPORT_STATUSES.degraded,
        VIEWING_SESSION_TRANSPORT_STATUSES.disconnected,
        VIEWING_SESSION_TRANSPORT_STATUSES.chained,
        VIEWING_SESSION_TRANSPORT_STATUSES.failed,
    ]),
    [VIEWING_SESSION_TRANSPORT_STATUSES.degraded]: new Set([
        VIEWING_SESSION_TRANSPORT_STATUSES.reconnecting,
        VIEWING_SESSION_TRANSPORT_STATUSES.connected,
        VIEWING_SESSION_TRANSPORT_STATUSES.disconnected,
        VIEWING_SESSION_TRANSPORT_STATUSES.chained,
        VIEWING_SESSION_TRANSPORT_STATUSES.failed,
    ]),
    [VIEWING_SESSION_TRANSPORT_STATUSES.chained]: new Set([
        VIEWING_SESSION_TRANSPORT_STATUSES.disconnected,
    ]),
    [VIEWING_SESSION_TRANSPORT_STATUSES.failed]: new Set([
        VIEWING_SESSION_TRANSPORT_STATUSES.connecting,
        VIEWING_SESSION_TRANSPORT_STATUSES.disconnected,
    ]),
};

export class ViewingSessionTransportTransitionError extends Error {
    readonly previousStatus: ViewingSessionTransportStatus;
    readonly requestedStatus: ViewingSessionTransportStatus;

    constructor(args: {
        previousStatus: ViewingSessionTransportStatus;
        requestedStatus: ViewingSessionTransportStatus;
    }) {
        super(`Invalid transport transition: ${args.previousStatus} -> ${args.requestedStatus}`);
        this.name = "ViewingSessionTransportTransitionError";
        this.previousStatus = args.previousStatus;
        this.requestedStatus = args.requestedStatus;
    }
}

export function canTransitionViewingSessionTransportStatus(
    previousStatus: ViewingSessionTransportStatus,
    requestedStatus: ViewingSessionTransportStatus
): boolean {
    if (previousStatus === requestedStatus) return true;
    const allowed = TRANSPORT_TRANSITIONS[previousStatus];
    if (!allowed) return false;
    return allowed.has(requestedStatus);
}

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
                liveProvider: session.liveProvider || "google_gemini_live",
                transportStatus: VIEWING_SESSION_TRANSPORT_STATUSES.disconnected,
                consentStatus: session.consentStatus || "required",
                appliedRetentionDays: session.appliedRetentionDays || 90,
                transcriptVisibility: session.transcriptVisibility || "team",
                estimatedCostUsd: 0,
                actualCostUsd: 0,
                lastTransportEventAt: null,
                sessionThreadId: session.sessionThreadId || session.id,
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
                transportStatus: VIEWING_SESSION_TRANSPORT_STATUSES.chained,
                endedAt: now,
                lastTransportEventAt: now,
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
                transportStatus: VIEWING_SESSION_TRANSPORT_STATUSES.chained,
                chainedToSessionId: chainedSession.id,
                endedAt: now.toISOString(),
            },
        }),
        publishViewingSessionRealtimeEvent({
            sessionId: session.id,
            locationId: session.locationId,
            type: VIEWING_SESSION_EVENT_TYPES.transportStatusChanged,
            payload: {
                sessionId: session.id,
                transportStatus: VIEWING_SESSION_TRANSPORT_STATUSES.chained,
                at: now.toISOString(),
            },
        }),
        publishViewingSessionRealtimeEvent({
            sessionId: chainedSession.id,
            locationId: session.locationId,
            type: VIEWING_SESSION_EVENT_TYPES.statusChanged,
            payload: {
                sessionId: chainedSession.id,
                status: VIEWING_SESSION_STATUSES.active,
                transportStatus: VIEWING_SESSION_TRANSPORT_STATUSES.disconnected,
                chainedFromSessionId: session.id,
                startedAt: now.toISOString(),
            },
        }),
        appendViewingSessionEvent({
            sessionId: session.id,
            locationId: session.locationId,
            type: "viewing_session.chained",
            source: "system",
            payload: {
                previousSessionId: session.id,
                nextSessionId: chainedSession.id,
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

export async function setViewingSessionTransportStatus(args: {
    sessionId: string;
    status: ViewingSessionTransportStatus;
    source?: string | null;
    payload?: Record<string, unknown> | null;
}) {
    const sessionId = String(args.sessionId || "").trim();
    if (!sessionId) return null;

    const status = String(args.status || "").trim();
    if (!status) return null;
    const allowedStatuses = Object.values(VIEWING_SESSION_TRANSPORT_STATUSES);
    if (!allowedStatuses.includes(status as ViewingSessionTransportStatus)) return null;
    const at = new Date();

    const existing = await db.viewingSession.findUnique({
        where: { id: sessionId },
        select: {
            id: true,
            locationId: true,
            transportStatus: true,
        },
    }).catch(() => null);
    if (!existing) return null;

    const previousStatus = existing.transportStatus as ViewingSessionTransportStatus;
    const requestedStatus = status as ViewingSessionTransportStatus;
    if (!canTransitionViewingSessionTransportStatus(previousStatus, requestedStatus)) {
        throw new ViewingSessionTransportTransitionError({
            previousStatus,
            requestedStatus,
        });
    }

    const updated = await db.viewingSession.update({
        where: { id: existing.id },
        data: {
            transportStatus: requestedStatus,
            lastTransportEventAt: at,
        },
        select: {
            id: true,
            locationId: true,
            transportStatus: true,
        },
    }).catch(() => null);

    if (!updated) return null;

    await Promise.all([
        publishViewingSessionRealtimeEvent({
            sessionId: updated.id,
            locationId: updated.locationId,
            type: VIEWING_SESSION_EVENT_TYPES.transportStatusChanged,
            payload: {
                sessionId: updated.id,
                previousTransportStatus: previousStatus,
                nextTransportStatus: updated.transportStatus,
                transportStatus: updated.transportStatus,
                at: at.toISOString(),
                ...(args.payload || {}),
            },
        }),
        appendViewingSessionEvent({
            sessionId: updated.id,
            locationId: updated.locationId,
            type: "viewing_session.transport.status",
            source: String(args.source || "system").trim() || "system",
            payload: {
                previousTransportStatus: previousStatus,
                nextTransportStatus: updated.transportStatus,
                transportStatus: updated.transportStatus,
                at: at.toISOString(),
                ...(args.payload || {}),
            },
        }),
    ]);

    return updated;
}
