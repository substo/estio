import db from "@/lib/db";
import { publishViewingSessionRealtimeEvent } from "@/lib/realtime/viewing-session-events";
import { appendViewingSessionEvent } from "@/lib/viewings/sessions/events";
import { shouldRequireViewingSessionJoinCredentials } from "@/lib/viewings/sessions/session-config";
import { generateViewingSessionJoinSecrets } from "@/lib/viewings/sessions/security";
import { VIEWING_SESSION_EVENT_TYPES, VIEWING_SESSION_KINDS } from "@/lib/viewings/sessions/types";

const QUICK_KINDS = [
    VIEWING_SESSION_KINDS.quickTranslate,
    VIEWING_SESSION_KINDS.listenOnly,
    VIEWING_SESSION_KINDS.twoWayInterpreter,
];

export async function resumeQuickViewingSession(args: {
    sessionId: string;
    locationId: string;
    actorUserId?: string | null;
}, database: typeof db = db, effects = {
    publishStatus: publishViewingSessionRealtimeEvent,
    appendEvent: appendViewingSessionEvent,
}) {
    const now = new Date();
    const result = await database.$transaction(async (tx) => {
        const session = await tx.viewingSession.findFirst({
            where: { id: args.sessionId, locationId: args.locationId, deletedAt: null },
            select: {
                id: true, locationId: true, sessionThreadId: true, chainIndex: true,
                sessionKind: true, participantMode: true, status: true,
                sessionLinkTokenHash: true, pinCodeHash: true, pinCodeSalt: true, tokenExpiresAt: true,
            },
        });
        if (!session) return { kind: "not_found" as const };
        if (!QUICK_KINDS.some((kind) => kind === session.sessionKind)) return { kind: "unsupported" as const };

        const newer = await tx.viewingSession.findFirst({
            where: {
                locationId: args.locationId,
                sessionThreadId: session.sessionThreadId,
                chainIndex: { gt: session.chainIndex },
                deletedAt: null,
            },
            orderBy: [{ chainIndex: "desc" }, { createdAt: "desc" }],
            select: { id: true },
        });
        if (newer) return { kind: "redirect" as const, sessionId: newer.id };
        if (session.status === "active") {
            const needsJoin = shouldRequireViewingSessionJoinCredentials(session.participantMode);
            if (!needsJoin || (session.sessionLinkTokenHash && session.pinCodeHash && session.pinCodeSalt && session.tokenExpiresAt && session.tokenExpiresAt > now)) {
                return { kind: "active" as const, sessionId: session.id, join: null };
            }
            const join = generateViewingSessionJoinSecrets();
            const refreshed = await tx.viewingSession.updateMany({
                where: { id: session.id, locationId: args.locationId, deletedAt: null, status: "active" },
                data: {
                    sessionLinkTokenHash: join.tokenHash,
                    pinCodeHash: join.pinCodeHash,
                    pinCodeSalt: join.pinCodeSalt,
                    tokenExpiresAt: join.expiresAt,
                },
            });
            if (!refreshed.count) return { kind: "conflict" as const };
            return { kind: "active" as const, sessionId: session.id, join: { token: join.token, pinCode: join.pinCode, expiresAt: join.expiresAt.toISOString() } };
        }

        const join = shouldRequireViewingSessionJoinCredentials(session.participantMode)
            ? generateViewingSessionJoinSecrets()
            : null;
        const updated = await tx.viewingSession.updateMany({
            where: {
                id: session.id,
                locationId: args.locationId,
                deletedAt: null,
                status: session.status,
            },
            data: {
                status: "active",
                startedAt: now,
                endedAt: null,
                transportStatus: "disconnected",
                lastTransportEventAt: now,
                savePolicy: "save_transcript",
                ...(join ? {
                    sessionLinkTokenHash: join.tokenHash,
                    pinCodeHash: join.pinCodeHash,
                    pinCodeSalt: join.pinCodeSalt,
                    tokenExpiresAt: join.expiresAt,
                } : {}),
            },
        });
        if (!updated.count) return { kind: "conflict" as const };
        return {
            kind: "resumed" as const,
            sessionId: session.id,
            join: join ? { token: join.token, pinCode: join.pinCode, expiresAt: join.expiresAt.toISOString() } : null,
        };
    });

    if (result.kind === "resumed") {
        await Promise.all([
            effects.publishStatus({
                sessionId: result.sessionId,
                locationId: args.locationId,
                type: VIEWING_SESSION_EVENT_TYPES.statusChanged,
                payload: { sessionId: result.sessionId, status: "active", endedAt: null, transportStatus: "disconnected" },
            }).catch((error) => console.warn("[viewing-session-resume] Realtime event failed:", error)),
            effects.appendEvent({
                sessionId: result.sessionId,
                locationId: args.locationId,
                type: "viewing_session.resumed",
                actorRole: "admin",
                actorUserId: args.actorUserId || null,
                source: "api",
                payload: { resumedAt: now.toISOString() },
            }).catch((error) => console.warn("[viewing-session-resume] Audit event failed:", error)),
        ]);
    }
    return result;
}
