import { NextRequest, NextResponse } from "next/server";
import {
    getViewingSessionEventsChannel,
    getViewingSessionRealtimeEventsSince,
} from "@/lib/realtime/viewing-session-events";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
};

const HEARTBEAT_INTERVAL_MS = 20_000;

export async function GET(req: NextRequest) {
    const sessionId = String(req.nextUrl.searchParams.get("sessionId") || "").trim();
    if (!sessionId) {
        return NextResponse.json({ success: false, error: "Missing sessionId." }, { status: 400 });
    }

    const tokenOverride = String(req.nextUrl.searchParams.get("accessToken") || "").trim() || null;
    const context = await resolveViewingSessionRequestContext({
        request: req,
        sessionId,
        allowClientToken: true,
        allowAgentToken: true,
        tokenOverride,
    });
    if (!context) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const channel = getViewingSessionEventsChannel(context.sessionId);
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
                        // Ignore unsubscribe errors during teardown.
                    }
                    try {
                        await subscriber.quit();
                    } catch {
                        // Ignore quit errors during teardown.
                    }
                    subscriber = null;
                }
                try {
                    controller.close();
                } catch {
                    // Ignore close errors on aborted streams.
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
                        sendEvent("viewing_session", parsed, eventId);
                    } catch {
                        sendEvent("viewing_session", { raw: rawMessage });
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
                    const replay = await getViewingSessionRealtimeEventsSince({
                        sessionId: context.sessionId,
                        lastEventId,
                        limit: 300,
                    });
                    for (const event of replay) {
                        sendEvent("viewing_session", event, event.id);
                    }
                }

                sendEvent("connected", {
                    sessionId: context.sessionId,
                    locationId: context.locationId,
                    role: context.role,
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
