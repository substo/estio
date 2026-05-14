import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { processNormalizedMessage, processStatusUpdate } from "@/lib/whatsapp/sync";
import {
    getWhatsAppWebBridgeSecret,
    parseWhatsAppWebChatIdentity,
    upsertWhatsAppWebBridgeSession,
    WHATSAPP_WEB_BRIDGE_PROVIDER,
} from "@/lib/whatsapp/web-bridge";

function isAuthorized(req: NextRequest) {
    const secret = getWhatsAppWebBridgeSecret();
    if (!secret) return true;
    return req.headers.get("x-whatsapp-web-bridge-secret") === secret;
}

function normalizeAckStatus(ack: unknown) {
    const n = Number(ack);
    if (n >= 3) return "READ";
    if (n === 2) return "DELIVERED";
    if (n === 1) return "SERVER_ACK";
    if (n < 0) return "FAILED";
    return "";
}

async function updateBridgeMessageMediaMetadata(wamId: string, mediaState: Record<string, any>) {
    if (!wamId) return;
    const message = await (db as any).message.findUnique({
        where: { wamId },
        select: {
            id: true,
            syncRecords: {
                where: { provider: WHATSAPP_WEB_BRIDGE_PROVIDER },
                select: { metadata: true },
                take: 1,
            },
        },
    }).catch(() => null);
    if (!message?.id) return;

    const current = (message.syncRecords?.[0]?.metadata && typeof message.syncRecords[0].metadata === "object")
        ? message.syncRecords[0].metadata
        : {};
    await (db as any).messageSync.updateMany({
        where: {
            messageId: message.id,
            provider: WHATSAPP_WEB_BRIDGE_PROVIDER,
        },
        data: {
            metadata: {
                ...current,
                webBridgeMedia: {
                    ...((current as any).webBridgeMedia || {}),
                    ...mediaState,
                    updatedAt: new Date().toISOString(),
                },
            },
        },
    }).catch((error: any) => {
        console.warn(`[WhatsApp Web Bridge Webhook] Failed to store media metadata for ${wamId}:`, error?.message || error);
    });
}

export async function POST(req: NextRequest) {
    if (!isAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const event = String(body?.event || "").trim();
        const locationId = String(body?.locationId || "").trim();
        const sessionId = String(body?.sessionId || "").trim();
        if (!locationId || !sessionId) {
            return NextResponse.json({ error: "Missing locationId or sessionId" }, { status: 400 });
        }

        if (["qr", "ready", "authenticated", "auth_failure", "disconnected", "loading", "stale", "restarting"].includes(event)) {
            const now = new Date();
            await upsertWhatsAppWebBridgeSession(locationId, {
                sessionId,
                status: event === "qr"
                    ? "qr"
                    : event === "ready"
                        ? "ready"
                        : event === "authenticated"
                            ? "authenticated"
                            : event === "loading"
                                ? "starting"
                                : event === "stale" || event === "restarting"
                                    ? "restarting"
                                : event === "auth_failure"
                                    ? "failed"
                                    : "disconnected",
                qrCode: event === "qr" ? String(body?.qrCode || "") : null,
                phone: body?.phone ? String(body.phone) : undefined,
                lastReadyAt: event === "ready" ? now : undefined,
                lastSeenAt: now,
                lastError: event === "auth_failure" || event === "stale" || event === "restarting"
                    ? String(body?.error || (event === "auth_failure" ? "Authentication failed." : "WhatsApp Web browser session is restarting."))
                    : null,
                isDefaultOutbound: event === "ready" ? true : undefined,
                metadata: body?.metadata || null,
            } as any);
            return NextResponse.json({ status: "processed" });
        }

        if (event === "message_ack") {
            const wamId = String(body?.messageId || body?.wamId || "").trim();
            const status = normalizeAckStatus(body?.ack);
            if (wamId && status) await processStatusUpdate(wamId, status);
            return NextResponse.json({ status: "processed" });
        }

        if (event === "message" || event === "message_create") {
            const message = body?.message || {};
            const fromMe = Boolean(message.fromMe);
            const fromId = String(message.from || "");
            const toId = String(message.to || "");
            const remoteId = fromMe ? toId : fromId;
            const contactIdentity = parseWhatsAppWebChatIdentity(remoteId);
            const ownIdentity = parseWhatsAppWebChatIdentity(body?.phone || (fromMe ? fromId : toId));
            const contactPhone = contactIdentity.phone;
            const ownPhone = ownIdentity.phone || locationId;
            const wamId = String(message.id || message.messageId || "").trim();

            if (!wamId) {
                return NextResponse.json({ status: "ignored", reason: "missing_message_id" });
            }
            if (!contactIdentity.isSupported || !contactPhone) {
                return NextResponse.json({
                    status: "ignored",
                    reason: contactIdentity.reason || "unsupported_message_identity",
                });
            }

            const result = await processNormalizedMessage({
                locationId,
                from: fromMe ? ownPhone : contactPhone,
                to: fromMe ? contactPhone : ownPhone,
                body: String(message.body || message.caption || ""),
                type: String(message.type || "text") as any,
                wamId,
                timestamp: new Date(Number(message.timestamp || Date.now() / 1000) * 1000),
                direction: fromMe ? "outbound" : "inbound",
                source: "whatsapp_web_bridge" as any,
                contactName: message.contactName || message.notifyName || undefined,
                resolvedPhone: contactPhone,
            });

            if (message.hasMedia && message.media?.data && result?.status !== "deferred_unresolved_lid") {
                const { ingestWhatsAppWebBridgeMediaAttachment } = await import("@/lib/whatsapp/web-bridge-media");
                void ingestWhatsAppWebBridgeMediaAttachment({
                    wamId,
                    media: message.media,
                    messageType: String(message.type || "text"),
                }).then((ingestResult: any) => {
                    if (ingestResult?.status === "stored") {
                        return updateBridgeMessageMediaMetadata(wamId, {
                            status: "stored",
                            key: ingestResult.key || null,
                            meta: message.mediaMeta || null,
                            error: null,
                        });
                    }
                    return updateBridgeMessageMediaMetadata(wamId, {
                        status: ingestResult?.status || "skipped",
                        reason: ingestResult?.reason || "unknown",
                        meta: message.mediaMeta || null,
                        error: null,
                    });
                }).catch((error) => {
                    console.error(`[WhatsApp Web Bridge Webhook] Failed to ingest media for ${wamId}:`, error);
                    void updateBridgeMessageMediaMetadata(wamId, {
                        status: "failed",
                        reason: "ingest_exception",
                        meta: message.mediaMeta || null,
                        error: error?.message || "Failed to ingest media.",
                    });
                });
            } else if (message.hasMedia && message.mediaError) {
                console.warn(
                    `[WhatsApp Web Bridge Webhook] Media not ingested for ${wamId}:`,
                    typeof message.mediaError === "object" ? JSON.stringify(message.mediaError) : message.mediaError
                );
                void updateBridgeMessageMediaMetadata(wamId, {
                    status: "failed",
                    reason: typeof message.mediaError === "object" ? message.mediaError.code || "worker_media_error" : "worker_media_error",
                    meta: message.mediaMeta || null,
                    error: typeof message.mediaError === "object" ? message.mediaError.message || null : String(message.mediaError || ""),
                    workerError: message.mediaError,
                });
            }

            return NextResponse.json({ status: "processed" });
        }

        return NextResponse.json({ status: "ignored", event });
    } catch (error: any) {
        console.error("[WhatsApp Web Bridge Webhook] Error:", error);
        return NextResponse.json({ error: error?.message || "Internal Server Error" }, { status: 500 });
    }
}
