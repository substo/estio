import db from "@/lib/db";
import { publishConversationRealtimeEvent } from "@/lib/realtime/conversation-events";
import { WHATSAPP_CLOUD_PROVIDER, mapWhatsAppCloudStatus } from "@/lib/whatsapp/client";
import { parseWhatsAppWebhookTimestamp } from "@/lib/whatsapp/webhook-normalizers";

function logWhatsAppSendLifecycle(event: string, payload: Record<string, unknown>) {
    console.info(JSON.stringify({
        scope: "whatsapp_send_lifecycle",
        event,
        at: new Date().toISOString(),
        ...payload,
    }));
}

export function mapWhatsAppDeliveryStatus(rawStatus: string) {
    const s = rawStatus.toUpperCase();

    if (s === 'DELIVERY_ACK' || s === 'DELIVERED') {
        return 'delivered';
    }
    if (s === 'READ' || s === 'PLAYED') return 'read';
    if (s === 'SERVER_ACK') return 'sent';
    if (s === 'ERROR' || s === 'FAILED') return 'failed';
    if (!rawStatus) return "";
    return rawStatus.toLowerCase();
}

function isProviderConfirmedStatus(status: string) {
    return status === "sent" || status === "delivered" || status === "read";
}

async function applyOutboundOutboxStatusFromProviderAck(args: {
    messageId: string;
    status: string;
    rawStatus: string;
}) {
    const messageId = String(args.messageId || "").trim();
    if (!messageId) return null;

    if (args.status === "failed") {
        return (db as any).whatsAppOutboundOutbox.updateMany({
            where: {
                messageId,
                status: { in: ["processing", "dispatch_accepted", "delivery_unconfirmed"] },
            },
            data: {
                status: "failed",
                scheduledAt: new Date(),
                lockedAt: null,
                lockedBy: null,
                lastError: `Provider status webhook reported ${args.rawStatus || args.status}.`,
            },
        });
    }

    if (isProviderConfirmedStatus(args.status)) {
        return (db as any).whatsAppOutboundOutbox.updateMany({
            where: {
                messageId,
                status: { in: ["processing", "dispatch_accepted", "delivery_unconfirmed", "failed"] },
            },
            data: {
                status: "completed",
                processedAt: new Date(),
                lockedAt: null,
                lockedBy: null,
                lastError: null,
            },
        });
    }

    return null;
}

export async function processStatusUpdate(wamId: string, rawStatus: string) {
    const status = mapWhatsAppDeliveryStatus(rawStatus);
    if (!status) return;

    console.log(`[WhatsApp Sync] Updating status for ${wamId}: ${rawStatus} -> ${status}`);

    const updateResult = await db.message.updateMany({
        where: { wamId },
        data: { status: status }
    });

    if (updateResult.count > 0) {
        const messageWithConversation = await (db as any).message.findFirst({
            where: { wamId },
            select: {
                id: true,
                wamId: true,
                clientMessageId: true,
                createdAt: true,
                outboundWhatsAppOutbox: {
                    select: {
                        id: true,
                        status: true,
                    },
                },
                conversation: {
                    select: {
                        ghlConversationId: true,
                        locationId: true,
                    },
                },
            },
        });

        const conversationId = (messageWithConversation as any)?.conversation?.ghlConversationId;
        const locationId = (messageWithConversation as any)?.conversation?.locationId;
        const createdAtMs = Date.parse(String((messageWithConversation as any)?.createdAt || ""));
        const outboxUpdateResult = await applyOutboundOutboxStatusFromProviderAck({
            messageId: String((messageWithConversation as any)?.id || ""),
            status,
            rawStatus,
        }).catch((error: any) => {
            console.warn("[WhatsApp Sync] Failed to update outbound outbox from provider ack:", error?.message || error);
            return null;
        });
        const outboxUpdated = Number((outboxUpdateResult as any)?.count || 0);
        const nextOutboxStatus = outboxUpdated > 0
            ? (status === "failed" ? "failed" : "completed")
            : String((messageWithConversation as any)?.outboundWhatsAppOutbox?.status || "");
        logWhatsAppSendLifecycle("status_webhook_received", {
            messageId: (messageWithConversation as any)?.id || null,
            clientMessageId: (messageWithConversation as any)?.clientMessageId || null,
            wamId,
            rawStatus,
            status,
            outboxStatus: nextOutboxStatus || null,
            status_webhook_lag_ms: Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : null,
            total_to_delivered_ms: status === "delivered" && Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : null,
        });
        if (conversationId && locationId) {
            void publishConversationRealtimeEvent({
                locationId,
                conversationId,
                type: "message.status",
                payload: {
                    messageId: (messageWithConversation as any).id,
                    wamId: (messageWithConversation as any).wamId || wamId,
                    clientMessageId: (messageWithConversation as any).clientMessageId || null,
                    status,
                    rawStatus,
                    outboxStatus: nextOutboxStatus || undefined,
                },
            });
        }
    }
}

export async function updateWhatsAppCloudStatus(location: any, statusEvent: any) {
    const wamId = String(statusEvent?.id || "").trim();
    if (!wamId) return;

    const messageStatus = mapWhatsAppCloudStatus(statusEvent?.status);
    const remoteUpdatedAt = parseWhatsAppWebhookTimestamp(statusEvent?.timestamp);

    let message = await db.message.findUnique({
        where: { wamId },
        select: { id: true, conversationId: true, clientMessageId: true, createdAt: true },
    });

    if (!message) {
        const sync = await (db as any).messageSync.findFirst({
            where: {
                provider: WHATSAPP_CLOUD_PROVIDER,
                providerMessageId: wamId,
            },
            select: { messageId: true, conversationId: true },
        });
        if (sync?.messageId) {
            message = await db.message.findUnique({
                where: { id: sync.messageId },
                select: { id: true, conversationId: true, clientMessageId: true, createdAt: true },
            });
        }
    }

    if (!message?.id) {
        console.warn(`[WhatsApp Webhook] Status for unknown Cloud WAM ID: ${wamId}`);
        return;
    }

    await db.message.update({
        where: { id: message.id },
        data: {
            status: messageStatus,
            ...(messageStatus === "failed" ? {} : { wamId }),
            updatedAt: new Date(),
        } as any,
    }).catch(async (error) => {
        console.warn("[WhatsApp Webhook] Failed to update message status:", error);
        await db.message.update({
            where: { id: message!.id },
            data: { status: messageStatus, updatedAt: new Date() },
        }).catch(() => undefined);
    });

    await (db as any).messageSync.upsert({
        where: {
            messageId_provider_providerAccountId: {
                messageId: message.id,
                provider: WHATSAPP_CLOUD_PROVIDER,
                providerAccountId: location.whatsappPhoneNumberId || "default",
            },
        },
        create: {
            messageId: message.id,
            conversationId: message.conversationId,
            locationId: location.id,
            provider: WHATSAPP_CLOUD_PROVIDER,
            providerAccountId: location.whatsappPhoneNumberId || "default",
            providerMessageId: wamId,
            status: "synced",
            remoteUpdatedAt,
            lastSyncedAt: new Date(),
            metadata: {
                cloudStatus: statusEvent?.status || null,
                pricing: statusEvent?.pricing || null,
                conversation: statusEvent?.conversation || null,
                errors: statusEvent?.errors || null,
            },
        },
        update: {
            providerMessageId: wamId,
            status: "synced",
            remoteUpdatedAt,
            lastSyncedAt: new Date(),
            lastError: messageStatus === "failed" ? JSON.stringify(statusEvent?.errors || statusEvent) : null,
            metadata: {
                cloudStatus: statusEvent?.status || null,
                pricing: statusEvent?.pricing || null,
                conversation: statusEvent?.conversation || null,
                errors: statusEvent?.errors || null,
            },
        },
    }).catch((error: any) => {
        console.warn("[WhatsApp Webhook] Failed to upsert Cloud message sync:", error?.message || error);
    });

    void publishConversationRealtimeEvent({
        locationId: location.id,
        conversationId: message.conversationId,
        type: "message.status",
        payload: {
            channel: "whatsapp",
            mode: "cloud_api",
            messageId: message.id,
            clientMessageId: message.clientMessageId || null,
            wamId,
            status: messageStatus,
            pricing: statusEvent?.pricing || null,
        },
    });
    const createdAtMs = Date.parse(String((message as any).createdAt || ""));
    logWhatsAppSendLifecycle("status_webhook_received", {
        messageId: message.id,
        clientMessageId: message.clientMessageId || null,
        wamId,
        rawStatus: statusEvent?.status || null,
        status: messageStatus,
        status_webhook_lag_ms: Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : null,
        total_to_delivered_ms: messageStatus === "delivered" && Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : null,
    });
}
