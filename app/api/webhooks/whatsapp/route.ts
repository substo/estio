import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { publishConversationRealtimeEvent } from "@/lib/realtime/conversation-events";
import { processNormalizedMessage, NormalizedMessage } from "@/lib/whatsapp/sync";
import {
    WHATSAPP_CLOUD_PROVIDER,
    mapWhatsAppCloudStatus,
    verifyWhatsAppWebhookSignature,
} from "@/lib/whatsapp/client";

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const mode = searchParams.get("hub.mode");
    const token = searchParams.get("hub.verify_token");
    const challenge = searchParams.get("hub.challenge");

    if (mode && token) {
        const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

        if (mode === "subscribe" && token === verifyToken) {
            console.log("WEBHOOK_VERIFIED");
            return new NextResponse(challenge, { status: 200 });
        }
        return new NextResponse("Forbidden", { status: 403 });
    }

    return new NextResponse("Bad Request", { status: 400 });
}

function getInboundBody(message: any) {
    const type = String(message?.type || "other");
    if (type === "text") return String(message?.text?.body || "");
    if (type === "image") return String(message?.image?.caption || "[Image]");
    if (type === "audio") return "[Audio]";
    if (type === "document") return String(message?.document?.caption || message?.document?.filename || "[Document]");
    if (type === "video") return String(message?.video?.caption || "[Video]");
    if (type === "sticker") return "[Sticker]";
    if (type === "button") return String(message?.button?.text || "[Button]");
    if (type === "interactive") return String(message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.title || "[Interactive]");
    if (type === "contacts") return "[Contact]";
    if (type === "location") return "[Location]";
    return `[${type}]`;
}

function normalizeInboundType(type: string): NormalizedMessage["type"] {
    if (["text", "image", "document", "audio", "video", "sticker", "reaction", "contact"].includes(type)) {
        return type as NormalizedMessage["type"];
    }
    if (type === "contacts") return "contact";
    return "other";
}

function parseWebhookTimestamp(value: any) {
    const seconds = Number(value || 0);
    if (seconds > 0) return new Date(seconds * 1000);
    return new Date();
}

async function updateCloudStatus(location: any, statusEvent: any) {
    const wamId = String(statusEvent?.id || "").trim();
    if (!wamId) return;

    const messageStatus = mapWhatsAppCloudStatus(statusEvent?.status);
    const remoteUpdatedAt = parseWebhookTimestamp(statusEvent?.timestamp);

    let message = await db.message.findUnique({
        where: { wamId },
        select: { id: true, conversationId: true, clientMessageId: true },
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
                select: { id: true, conversationId: true, clientMessageId: true },
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
}

async function processMessagesValue(value: any) {
    const phoneNumberId = String(value?.metadata?.phone_number_id || "").trim();
    if (!phoneNumberId) {
        console.warn("[WhatsApp Webhook] Missing phone_number_id in metadata");
        return;
    }

    const location = await db.location.findFirst({
        where: { whatsappPhoneNumberId: phoneNumberId },
    });

    if (!location) {
        console.warn(`Received WhatsApp webhook for unknown Phone Number ID: ${phoneNumberId}`);
        return;
    }

    for (const status of value?.statuses || []) {
        await updateCloudStatus(location, status);
    }

    const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
    for (const message of value?.messages || []) {
        const from = String(message?.from || "").trim();
        const wamId = String(message?.id || "").trim();
        if (!from || !wamId) continue;

        const contact = contacts.find((candidate: any) => String(candidate?.wa_id || "") === from);
        const type = String(message?.type || "other");
        const normalized: NormalizedMessage = {
            locationId: location.id,
            from,
            to: phoneNumberId,
            type: normalizeInboundType(type),
            body: getInboundBody(message),
            wamId,
            timestamp: parseWebhookTimestamp(message?.timestamp),
            contactName: contact?.profile?.name,
            source: "whatsapp_native",
            direction: "inbound",
        };

        await processNormalizedMessage(normalized);
    }
}

export async function POST(req: NextRequest) {
    try {
        const rawBody = await req.text();
        const signature = req.headers.get("x-hub-signature-256");
        if (!verifyWhatsAppWebhookSignature(rawBody, signature)) {
            console.warn("[WhatsApp Webhook] Invalid x-hub-signature-256");
            return new NextResponse("Forbidden", { status: 403 });
        }

        const body = JSON.parse(rawBody || "{}");
        for (const entry of body?.entry || []) {
            for (const change of entry?.changes || []) {
                if (change?.field !== "messages") continue;
                await processMessagesValue(change?.value || {});
            }
        }

        return new NextResponse("OK", { status: 200 });
    } catch (error) {
        console.error("Error processing WhatsApp webhook:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
