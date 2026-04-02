import db from "@/lib/db";

type AppendViewingSessionEventInput = {
    sessionId: string;
    locationId: string;
    type: string;
    actorRole?: string | null;
    actorUserId?: string | null;
    source?: string | null;
    payload?: Record<string, unknown> | null;
};

function asString(value: unknown): string {
    return String(value || "").trim();
}

export async function appendViewingSessionEvent(input: AppendViewingSessionEventInput) {
    const sessionId = asString(input.sessionId);
    const locationId = asString(input.locationId);
    const type = asString(input.type);
    if (!sessionId || !locationId || !type) return null;

    try {
        return await db.viewingSessionEvent.create({
            data: {
                sessionId,
                locationId,
                type,
                actorRole: asString(input.actorRole) || null,
                actorUserId: asString(input.actorUserId) || null,
                source: asString(input.source) || null,
                payload: (input.payload as any) || undefined,
            },
        });
    } catch (error) {
        console.warn("[viewing-session-events] Failed to append session event:", error);
        return null;
    }
}
