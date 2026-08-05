import { NextRequest, NextResponse } from 'next/server';
import { getNotificationFeatureFlags } from '@/lib/notifications/feature-flags';
import { getActiveContactsAccess } from '@/lib/contacts/active-location-access';
import {
  getNotificationEventsChannel,
  getNotificationRealtimeEventsSince,
} from '@/lib/realtime/notification-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REDIS_CONNECTION = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
};

const HEARTBEAT_INTERVAL_MS = 20_000;

export async function GET(req: NextRequest) {
  const access = await getActiveContactsAccess();
  if (!access) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const flags = getNotificationFeatureFlags();
  if (!flags.notificationSse) {
    return NextResponse.json({ success: false, error: 'Realtime notifications disabled by feature flag' }, { status: 503 });
  }

  const channel = getNotificationEventsChannel(access.internalUserId, access.locationId);
  const encoder = new TextEncoder();
  let cancelCleanup: (() => Promise<void>) | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      let subscriber: any | null = null;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let closed = false;

      const sendEvent = (event: string, data: unknown, id?: string) => {
        if (closed) return;
        if (id) {
          controller.enqueue(encoder.encode(`id: ${id}\n`));
        }
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const sendComment = (comment: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`:${comment}\n\n`));
      };

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        cancelCleanup = null;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (subscriber) {
          try {
            await subscriber.unsubscribe(channel);
          } catch {
            // Ignore teardown errors
          }
          try {
            await subscriber.quit();
          } catch {
            // Ignore teardown errors
          }
          subscriber = null;
        }
        try {
          controller.close();
        } catch {
          // Ignore close errors on aborted streams
        }
      };

      cancelCleanup = cleanup;

      const onAbort = () => {
        void cleanup();
      };

      req.signal.addEventListener('abort', onAbort);

      try {
        const Redis = (await import('ioredis')).default;
        subscriber = new Redis(REDIS_CONNECTION);

        subscriber.on('message', (incomingChannel: string, rawMessage: string) => {
          if (incomingChannel !== channel) return;

          try {
            const parsed = JSON.parse(rawMessage);
            const eventId = parsed?.id ? String(parsed.id) : undefined;
            sendEvent('notification', parsed, eventId);
          } catch {
            sendEvent('notification', { raw: rawMessage });
          }
        });

        subscriber.on('error', (error: unknown) => {
          sendEvent('error', {
            message: String((error as any)?.message || 'Subscription error'),
          });
        });

        await subscriber.subscribe(channel);

        const lastEventId = req.headers.get('last-event-id');
        if (lastEventId) {
          const replay = await getNotificationRealtimeEventsSince({
            userId: access.internalUserId,
            locationId: access.locationId,
            lastEventId,
            limit: 200,
          });
          for (const event of replay) {
            sendEvent('notification', event, event.id);
          }
        }

        sendEvent('connected', {
          userId: access.internalUserId,
          locationId: access.locationId,
          channel,
          lastEventId: lastEventId || null,
          ts: new Date().toISOString(),
        });

        heartbeatTimer = setInterval(() => {
          sendComment(`heartbeat ${Date.now()}`);
        }, HEARTBEAT_INTERVAL_MS);
      } catch (error) {
        sendEvent('error', {
          message: String((error as any)?.message || 'Failed to start notification stream'),
        });
        await cleanup();
      }
    },
    cancel() {
      if (cancelCleanup) {
        void cancelCleanup();
        cancelCleanup = null;
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
