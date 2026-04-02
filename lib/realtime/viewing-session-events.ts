import { randomUUID } from "crypto";

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
};

const CHANNEL_PREFIX = "viewing_sessions:session:";
const HISTORY_PREFIX = "viewing_sessions:history:session:";
const HISTORY_MAX_EVENTS = Math.min(
    Math.max(Number(process.env.VIEWING_SESSION_REALTIME_HISTORY_MAX || 2000), 100),
    10_000
);

export type ViewingSessionRealtimeEventEnvelope = {
    id: string;
    ts: string;
    sessionId: string;
    locationId: string;
    type: string;
    payloadVersion: number;
    payload: Record<string, unknown>;
};

type PublishViewingSessionRealtimeEventInput = {
    sessionId: string;
    locationId: string;
    type: string;
    payload?: Record<string, unknown>;
};

let _publisherPromise: Promise<any> | null = null;

async function getPublisher() {
    if (!_publisherPromise) {
        _publisherPromise = (async () => {
            const Redis = (await import("ioredis")).default;
            return new Redis(REDIS_CONNECTION);
        })();
    }
    try {
        return await _publisherPromise;
    } catch (error) {
        _publisherPromise = null;
        throw error;
    }
}

export function getViewingSessionEventsChannel(sessionId: string): string {
    return `${CHANNEL_PREFIX}${sessionId}`;
}

export function getViewingSessionEventsHistoryKey(sessionId: string): string {
    return `${HISTORY_PREFIX}${sessionId}`;
}

function parseViewingSessionRealtimeEventEnvelope(raw: string): ViewingSessionRealtimeEventEnvelope | null {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        const id = parsed.id ? String(parsed.id) : "";
        const sessionId = parsed.sessionId ? String(parsed.sessionId) : "";
        const locationId = parsed.locationId ? String(parsed.locationId) : "";
        if (!id || !sessionId || !locationId) return null;

        return {
            id,
            ts: parsed.ts ? String(parsed.ts) : new Date(0).toISOString(),
            sessionId,
            locationId,
            type: parsed.type ? String(parsed.type) : "viewing_session.update",
            payloadVersion: Number(parsed.payloadVersion || 1),
            payload: parsed.payload && typeof parsed.payload === "object" ? parsed.payload : {},
        };
    } catch {
        return null;
    }
}

export function selectViewingSessionRealtimeReplayEvents(
    envelopes: ViewingSessionRealtimeEventEnvelope[],
    lastEventId: string,
    limit: number
): ViewingSessionRealtimeEventEnvelope[] {
    const normalizedLastEventId = String(lastEventId || "").trim();
    if (!normalizedLastEventId) return [];

    const normalizedLimit = Math.min(
        Math.max(Number(limit || 0), 1),
        HISTORY_MAX_EVENTS
    );

    const lastEventIndex = envelopes.findIndex((item) => item.id === normalizedLastEventId);
    if (lastEventIndex < 0) return [];

    return envelopes.slice(lastEventIndex + 1, lastEventIndex + 1 + normalizedLimit);
}

export async function getViewingSessionRealtimeEventsSince(args: {
    sessionId: string;
    lastEventId?: string | null;
    limit?: number;
}): Promise<ViewingSessionRealtimeEventEnvelope[]> {
    const sessionId = String(args.sessionId || "").trim();
    const lastEventId = String(args.lastEventId || "").trim();
    if (!sessionId || !lastEventId) return [];

    const limit = Math.min(
        Math.max(Number(args.limit || 300), 1),
        HISTORY_MAX_EVENTS
    );

    try {
        const publisher = await getPublisher();
        const rows = await publisher.lrange(getViewingSessionEventsHistoryKey(sessionId), -HISTORY_MAX_EVENTS, -1);
        if (!Array.isArray(rows) || rows.length === 0) return [];

        const envelopes: ViewingSessionRealtimeEventEnvelope[] = [];
        for (const raw of rows) {
            if (typeof raw !== "string") continue;
            const parsed = parseViewingSessionRealtimeEventEnvelope(raw);
            if (parsed) envelopes.push(parsed);
        }
        if (envelopes.length === 0) return [];

        return selectViewingSessionRealtimeReplayEvents(envelopes, lastEventId, limit);
    } catch (error) {
        console.warn("[realtime:viewing-sessions] Failed to read event history:", error);
        return [];
    }
}

export async function publishViewingSessionRealtimeEvent(
    input: PublishViewingSessionRealtimeEventInput
): Promise<ViewingSessionRealtimeEventEnvelope | null> {
    const sessionId = String(input.sessionId || "").trim();
    const locationId = String(input.locationId || "").trim();
    if (!sessionId || !locationId) return null;

    const envelope: ViewingSessionRealtimeEventEnvelope = {
        id: randomUUID(),
        ts: new Date().toISOString(),
        sessionId,
        locationId,
        type: String(input.type || "viewing_session.update"),
        payloadVersion: 1,
        payload: input.payload || {},
    };

    try {
        const publisher = await getPublisher();
        const serialized = JSON.stringify(envelope);
        await publisher
            .multi()
            .rpush(getViewingSessionEventsHistoryKey(sessionId), serialized)
            .ltrim(getViewingSessionEventsHistoryKey(sessionId), -HISTORY_MAX_EVENTS, -1)
            .publish(getViewingSessionEventsChannel(sessionId), serialized)
            .exec();
        return envelope;
    } catch (error) {
        console.warn("[realtime:viewing-sessions] Failed to publish event:", error);
        return null;
    }
}
