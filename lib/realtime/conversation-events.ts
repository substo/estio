import { randomUUID } from "crypto";

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
};

const CHANNEL_PREFIX = "conversations:location:";
const HISTORY_PREFIX = "conversations:history:location:";
const HISTORY_MAX_EVENTS = Math.min(
    Math.max(Number(process.env.CONVERSATIONS_REALTIME_HISTORY_MAX || 2000), 100),
    10_000
);

export type ConversationRealtimeEventEnvelope = {
    id: string;
    ts: string;
    locationId: string;
    conversationId: string | null;
    type: string;
    payloadVersion: number;
    payload: Record<string, unknown>;
};

type PublishConversationRealtimeEventInput = {
    locationId: string;
    conversationId?: string | null;
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

export function getConversationEventsChannel(locationId: string): string {
    return `${CHANNEL_PREFIX}${locationId}`;
}

export function getConversationEventsHistoryKey(locationId: string): string {
    return `${HISTORY_PREFIX}${locationId}`;
}

function parseConversationRealtimeEventEnvelope(raw: string): ConversationRealtimeEventEnvelope | null {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return null;
        const id = parsed.id ? String(parsed.id) : "";
        if (!id) return null;
        return {
            id,
            ts: parsed.ts ? String(parsed.ts) : new Date(0).toISOString(),
            locationId: parsed.locationId ? String(parsed.locationId) : "",
            conversationId: parsed.conversationId ? String(parsed.conversationId) : null,
            type: parsed.type ? String(parsed.type) : "conversation.update",
            payloadVersion: Number(parsed.payloadVersion || 1),
            payload: parsed.payload && typeof parsed.payload === "object" ? parsed.payload : {},
        };
    } catch {
        return null;
    }
}

export function selectConversationRealtimeReplayEvents(
    envelopes: ConversationRealtimeEventEnvelope[],
    lastEventId: string,
    limit: number
): ConversationRealtimeEventEnvelope[] {
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

export async function getConversationRealtimeEventsSince(args: {
    locationId: string;
    lastEventId?: string | null;
    limit?: number;
}): Promise<ConversationRealtimeEventEnvelope[]> {
    const locationId = String(args.locationId || "").trim();
    const lastEventId = String(args.lastEventId || "").trim();
    if (!locationId || !lastEventId) return [];

    const limit = Math.min(
        Math.max(Number(args.limit || 200), 1),
        HISTORY_MAX_EVENTS
    );

    try {
        const publisher = await getPublisher();
        const rows = await publisher.lrange(getConversationEventsHistoryKey(locationId), -HISTORY_MAX_EVENTS, -1);
        if (!Array.isArray(rows) || rows.length === 0) return [];

        const envelopes: ConversationRealtimeEventEnvelope[] = [];
        for (const raw of rows) {
            if (typeof raw !== "string") continue;
            const parsed = parseConversationRealtimeEventEnvelope(raw);
            if (parsed) envelopes.push(parsed);
        }
        if (envelopes.length === 0) return [];

        return selectConversationRealtimeReplayEvents(envelopes, lastEventId, limit);
    } catch (error) {
        console.warn("[realtime:conversations] Failed to read event history:", error);
        return [];
    }
}

export async function publishConversationRealtimeEvent(
    input: PublishConversationRealtimeEventInput
): Promise<ConversationRealtimeEventEnvelope | null> {
    const locationId = String(input.locationId || "").trim();
    if (!locationId) return null;

    const envelope: ConversationRealtimeEventEnvelope = {
        id: randomUUID(),
        ts: new Date().toISOString(),
        locationId,
        conversationId: input.conversationId ? String(input.conversationId) : null,
        type: String(input.type || "conversation.update"),
        payloadVersion: 1,
        payload: input.payload || {},
    };

    try {
        const publisher = await getPublisher();
        const serialized = JSON.stringify(envelope);
        await publisher
            .multi()
            .rpush(getConversationEventsHistoryKey(locationId), serialized)
            .ltrim(getConversationEventsHistoryKey(locationId), -HISTORY_MAX_EVENTS, -1)
            .publish(getConversationEventsChannel(locationId), serialized)
            .exec();
        return envelope;
    } catch (error) {
        console.warn("[realtime:conversations] Failed to publish event:", error);
        return null;
    }
}
