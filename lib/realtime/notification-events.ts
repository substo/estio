import { randomUUID } from 'crypto';

const REDIS_CONNECTION = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
};

const CHANNEL_PREFIX = 'notifications:user:';
const HISTORY_PREFIX = 'notifications:history:user:';
const HISTORY_MAX_EVENTS = Math.min(
  Math.max(Number(process.env.NOTIFICATIONS_REALTIME_HISTORY_MAX || 1000), 100),
  10_000
);

export type NotificationRealtimeEventEnvelope = {
  id: string;
  ts: string;
  userId: string;
  type: string;
  payloadVersion: number;
  payload: Record<string, unknown>;
};

type PublishNotificationRealtimeEventInput = {
  userId: string;
  type: string;
  payload?: Record<string, unknown>;
};

let publisherPromise: Promise<any> | null = null;

async function getPublisher() {
  if (!publisherPromise) {
    publisherPromise = (async () => {
      const Redis = (await import('ioredis')).default;
      return new Redis(REDIS_CONNECTION);
    })();
  }

  try {
    return await publisherPromise;
  } catch (error) {
    publisherPromise = null;
    throw error;
  }
}

export function getNotificationEventsChannel(userId: string) {
  return `${CHANNEL_PREFIX}${userId}`;
}

export function getNotificationEventsHistoryKey(userId: string) {
  return `${HISTORY_PREFIX}${userId}`;
}

function parseNotificationRealtimeEventEnvelope(raw: string): NotificationRealtimeEventEnvelope | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const id = parsed.id ? String(parsed.id) : '';
    if (!id) return null;

    return {
      id,
      ts: parsed.ts ? String(parsed.ts) : new Date(0).toISOString(),
      userId: parsed.userId ? String(parsed.userId) : '',
      type: parsed.type ? String(parsed.type) : 'notification.created',
      payloadVersion: Number(parsed.payloadVersion || 1),
      payload: parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : {},
    };
  } catch {
    return null;
  }
}

export function selectNotificationRealtimeReplayEvents(
  envelopes: NotificationRealtimeEventEnvelope[],
  lastEventId: string,
  limit: number
) {
  const normalizedLastEventId = String(lastEventId || '').trim();
  if (!normalizedLastEventId) return [];

  const normalizedLimit = Math.min(
    Math.max(Number(limit || 0), 1),
    HISTORY_MAX_EVENTS
  );

  const lastEventIndex = envelopes.findIndex((item) => item.id === normalizedLastEventId);
  if (lastEventIndex < 0) return [];

  return envelopes.slice(lastEventIndex + 1, lastEventIndex + 1 + normalizedLimit);
}

export async function getNotificationRealtimeEventsSince(args: {
  userId: string;
  lastEventId?: string | null;
  limit?: number;
}) {
  const userId = String(args.userId || '').trim();
  const lastEventId = String(args.lastEventId || '').trim();
  if (!userId || !lastEventId) return [];

  const limit = Math.min(Math.max(Number(args.limit || 200), 1), HISTORY_MAX_EVENTS);

  try {
    const publisher = await getPublisher();
    const rows = await publisher.lrange(getNotificationEventsHistoryKey(userId), -HISTORY_MAX_EVENTS, -1);
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const envelopes: NotificationRealtimeEventEnvelope[] = [];
    for (const raw of rows) {
      if (typeof raw !== 'string') continue;
      const parsed = parseNotificationRealtimeEventEnvelope(raw);
      if (parsed) envelopes.push(parsed);
    }
    if (envelopes.length === 0) return [];

    return selectNotificationRealtimeReplayEvents(envelopes, lastEventId, limit);
  } catch (error) {
    console.warn('[realtime:notifications] Failed to read event history:', error);
    return [];
  }
}

export async function publishNotificationRealtimeEvent(input: PublishNotificationRealtimeEventInput) {
  const userId = String(input.userId || '').trim();
  if (!userId) return null;

  const envelope: NotificationRealtimeEventEnvelope = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    userId,
    type: String(input.type || 'notification.created'),
    payloadVersion: 1,
    payload: input.payload || {},
  };

  try {
    const publisher = await getPublisher();
    const serialized = JSON.stringify(envelope);
    await publisher
      .multi()
      .rpush(getNotificationEventsHistoryKey(userId), serialized)
      .ltrim(getNotificationEventsHistoryKey(userId), -HISTORY_MAX_EVENTS, -1)
      .publish(getNotificationEventsChannel(userId), serialized)
      .exec();
    return envelope;
  } catch (error) {
    console.warn('[realtime:notifications] Failed to publish event:', error);
    return null;
  }
}
