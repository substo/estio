import { NextRequest, NextResponse } from "next/server";
import { getLocationContext } from "@/lib/auth/location-context";
import { getConversationFeatureFlags } from "@/lib/feature-flags";
import {
    getConversationEventsChannel,
    getConversationRealtimeEventsSince,
} from "@/lib/realtime/conversation-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
};

const HEARTBEAT_INTERVAL_MS = 20_000;

export async function GET(req: NextRequest) {
    const location = await getLocationContext();
    if (!location?.id) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const flags = getConversationFeatureFlags(location.id);
    if (!flags.realtimeSse) {
        return NextResponse.json({ success: false, error: "Realtime disabled by feature flag" }, { status: 503 });
    }

    const channel = getConversationEventsChannel(location.id);
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
                        // Ignore unsubscribe errors during teardown
                    }
                    try {
                        await subscriber.quit();
                    } catch {
                        // Ignore quit errors during teardown
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

            req.signal.addEventListener("abort", onAbort);

            try {
                const Redis = (await import("ioredis")).default;
                subscriber = new Redis(REDIS_CONNECTION);

                subscriber.on("message", (incomingChannel: string, rawMessage: string) => {
                    if (incomingChannel !== channel) return;

                    try {
                        const parsed = JSON.parse(rawMessage);
                        const eventId = parsed?.id ? String(parsed.id) : undefined;
                        sendEvent("conversation", parsed, eventId);
                    } catch {
                        // Fallback for malformed payloads.
                        sendEvent("conversation", { raw: rawMessage });
                    }
                });

                subscriber.on("error", (error: unknown) => {
                    sendEvent("error", {
                        message: String((error as any)?.message || "Subscription error"),
                    });
                });

                await subscriber.subscribe(channel);

                const lastEventId = req.headers.get("last-event-id");
                if (lastEventId) {
                    const replay = await getConversationRealtimeEventsSince({
                        locationId: location.id,
                        lastEventId,
                        limit: 300,
                    });
                    for (const event of replay) {
                        sendEvent("conversation", event, event.id);
                    }
                }

                sendEvent("connected", {
                    locationId: location.id,
                    channel,
                    lastEventId: lastEventId || null,
                    ts: new Date().toISOString(),
                });

                heartbeatTimer = setInterval(() => {
                    sendComment(`heartbeat ${Date.now()}`);
                }, HEARTBEAT_INTERVAL_MS);
            } catch (error) {
                sendEvent("error", {
                    message: String((error as any)?.message || "Failed to start realtime stream"),
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
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
        },
    });
}
