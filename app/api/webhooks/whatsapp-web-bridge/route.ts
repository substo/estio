import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { processNormalizedMessage, processStatusUpdate } from "@/lib/whatsapp/sync";
import {
    getWhatsAppWebBridgeSession,
    getWhatsAppWebBridgeSecret,
    upsertWhatsAppWebBridgeSession,
    WHATSAPP_WEB_BRIDGE_PROVIDER,
} from "@/lib/whatsapp/web-bridge";
import { parseWhatsAppWebBridgeWebhookBody } from "@/lib/whatsapp/web-bridge-webhook-parse";
import { resolveWebBridgeIdentity } from "@/lib/whatsapp/web-bridge-identity";
import { resolveInboundWhatsAppContactIdentity } from "@/lib/whatsapp/web-bridge-message-identity";
import {
    normalizeWhatsAppWebBridgeAckStatus,
    normalizeWhatsAppWebBridgeMessage,
} from "@/lib/whatsapp/webhook-normalizers";
import {
    isDeviceTunnelRuntimeLeaseEnforcementActive,
    validateDeviceTunnelRuntimeOwnership,
    validateDeviceTunnelRuntimeOwnershipDescriptor,
} from "@/lib/device-tunnel/runtime-ownership";

function isAuthorized(req: NextRequest) {
    const secret = getWhatsAppWebBridgeSecret();
    if (!secret) return true;
    return req.headers.get("x-whatsapp-web-bridge-secret") === secret;
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

async function markValidBridgeWebhookReceived(locationId: string, sessionId: string) {
    await (db as any).whatsAppWebBridgeSession.updateMany({
        where: { locationId, sessionId },
        data: {
            lastSeenAt: new Date(),
            lastError: null,
        },
    }).catch((error: any) => {
        console.warn(`[WhatsApp Web Bridge Webhook] Failed to mark valid webhook for ${sessionId}:`, error?.message || error);
    });
}

async function markBridgeHeartbeatReceived(locationId: string, sessionId: string) {
    const result = await (db as any).whatsAppWebBridgeSession.updateMany({
        where: { locationId, sessionId },
        data: {
            lastSeenAt: new Date(),
            lastError: null,
        },
    });
    return Number(result?.count || 0) === 1;
}

async function processBridgeStatusUpdateWithAdoptionRetry(wamId: string, status: string) {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const result = await processStatusUpdate(wamId, status);
        if (result.matched || attempt === maxAttempts) return result;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return { matched: false, status };
}

export async function POST(req: NextRequest) {
    if (!isAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const rawBody = await req.text();
        const parsed = parseWhatsAppWebBridgeWebhookBody({
            rawBody,
            contentType: req.headers.get("content-type"),
            contentLength: req.headers.get("content-length"),
        });
        if (!parsed.ok) {
            console.warn("[WhatsApp Web Bridge Webhook] Malformed JSON payload:", parsed.logMetadata);
            return NextResponse.json(parsed.responseBody, { status: parsed.status });
        }

        const body = parsed.body;
        const event = String(body?.event || "").trim();
        const locationId = String(body?.locationId || "").trim();
        const sessionId = String(body?.sessionId || "").trim();
        if (!locationId || !sessionId) {
            return NextResponse.json({ error: "Missing locationId or sessionId" }, { status: 400 });
        }
        if (isDeviceTunnelRuntimeLeaseEnforcementActive()) {
            const currentSession = await (db as any).whatsAppWebBridgeSession.findUnique({
                where: { locationId },
                select: { id: true, sessionId: true, egressMode: true },
            });
            if (!currentSession) {
                return NextResponse.json({ error: "WhatsApp Web session is not registered" }, { status: 409 });
            }
            if (currentSession?.egressMode === "device_tunnel") {
                let ownership;
                try {
                    ownership = validateDeviceTunnelRuntimeOwnershipDescriptor(body?.ownership);
                } catch {
                    return NextResponse.json({ error: "Runtime ownership is required" }, { status: 409 });
                }
                const owned = Boolean(
                    currentSession.id === ownership.sessionId
                    && currentSession.sessionId === sessionId
                    && await validateDeviceTunnelRuntimeOwnership({ db: db as any, ownership })
                );
                if (!owned) return NextResponse.json({ error: "Runtime ownership was fenced" }, { status: 409 });
            }
        }

        if (["qr", "ready", "authenticated", "auth_failure", "disconnected", "loading", "stale", "restarting"].includes(event)) {
            const now = new Date();
            const currentSession = await getWhatsAppWebBridgeSession(locationId);
            const eventStatus = event === "qr"
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
                                    : "disconnected";
            const keepReadyForLateStartupEvent = currentSession?.status === "ready"
                && currentSession.lastReadyAt
                && (event === "loading" || event === "authenticated");
            await upsertWhatsAppWebBridgeSession(locationId, {
                sessionId,
                status: keepReadyForLateStartupEvent ? "ready" : eventStatus,
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

        if (event === "heartbeat") {
            if (!await markBridgeHeartbeatReceived(locationId, sessionId)) {
                return NextResponse.json({ error: "WhatsApp Web session is not registered" }, { status: 409 });
            }
            return NextResponse.json({ status: "processed" });
        }

        if (event === "message_ack") {
            await markValidBridgeWebhookReceived(locationId, sessionId);
            const wamId = String(body?.messageId || body?.wamId || "").trim();
            const status = normalizeWhatsAppWebBridgeAckStatus(body?.ack);
            if (wamId && status) await processBridgeStatusUpdateWithAdoptionRetry(wamId, status);
            return NextResponse.json({ status: "processed" });
        }

        if (event === "message" || event === "message_create") {
            await markValidBridgeWebhookReceived(locationId, sessionId);
            const message = body?.message || {};
            const messageIdentity = resolveInboundWhatsAppContactIdentity({ message, phone: body?.phone });
            const resolvedIdentity = await resolveWebBridgeIdentity({
                locationId,
                remoteJid: messageIdentity.contactJid,
                identity: message.contactIdentity || null,
            });
            const normalizedMessage = normalizeWhatsAppWebBridgeMessage({
                locationId,
                phone: body?.phone,
                message,
                resolvedIdentity,
            });
            const wamId = normalizedMessage.wamId;

            if (!normalizedMessage.normalized) {
                return NextResponse.json({ status: "ignored", reason: normalizedMessage.ignoreReason });
            }

            const result = await processNormalizedMessage(normalizedMessage.normalized);

            if (message.fromMe) {
                const snapshotStatus = normalizeWhatsAppWebBridgeAckStatus(message.ack);
                if (wamId && snapshotStatus) {
                    await processBridgeStatusUpdateWithAdoptionRetry(wamId, snapshotStatus);
                }
            }

            if (message.hasMedia && message.media?.data && result?.status !== "deferred_unresolved_lid") {
                const { ingestWhatsAppWebBridgeMediaAttachment } = await import("@/lib/whatsapp/web-bridge-media");
                try {
                    const ingestResult = await ingestWhatsAppWebBridgeMediaAttachment({
                        wamId,
                        media: message.media,
                        messageType: String(message.type || "text"),
                    });
                    if (ingestResult?.status === "stored") {
                        await updateBridgeMessageMediaMetadata(wamId, {
                            status: "stored",
                            key: ingestResult.key || null,
                            attachmentId: ingestResult.attachmentId || null,
                            meta: message.mediaMeta || null,
                            error: null,
                            reason: null,
                            workerError: null,
                        });
                    } else {
                        await updateBridgeMessageMediaMetadata(wamId, {
                            status: ingestResult?.status || "skipped",
                            reason: ingestResult?.reason || "unknown",
                            meta: message.mediaMeta || null,
                            error: null,
                        });
                    }
                } catch (error: any) {
                    console.error(`[WhatsApp Web Bridge Webhook] Failed to ingest media for ${wamId}:`, error);
                    await updateBridgeMessageMediaMetadata(wamId, {
                        status: "failed",
                        reason: "ingest_exception",
                        meta: message.mediaMeta || null,
                        error: error?.message || "Failed to ingest media.",
                    });
                }
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
