import db from "@/lib/db";
import {
    WHATSAPP_CLOUD_PROVIDER,
    extractCloudWamId,
    getDefaultWhatsAppCloudChannel,
    sendWhatsAppCloudMedia,
    sendWhatsAppCloudTemplate,
    sendWhatsAppCloudText,
} from "@/lib/whatsapp/client";
import { createWhatsAppMediaReadUrl } from "@/lib/whatsapp/media-r2";
import {
    isResolvedWhatsAppWebBridgeChatAvailable,
    resolveWhatsAppWebBridgeChatForPhone,
    sendWhatsAppWebBridgeMessage,
    WHATSAPP_WEB_BRIDGE_PROVIDER,
} from "@/lib/whatsapp/web-bridge";
import { sendTwilioMessage } from "@/lib/twilio/client";

export type WhatsAppOutboundDispatchResult = {
    transport: string;
    provider: string;
    providerAccountId: string;
    wamId: string;
};

function normalizePhoneDigits(phone: string | null | undefined): string {
    return String(phone || "").replace(/\D/g, "");
}

function toMediaType(kind: string): "image" | "audio" | "video" | "document" {
    if (kind === "audio") return "audio";
    if (kind === "video") return "video";
    if (kind === "document") return "document";
    return "image";
}

function extractTwilioMessageId(response: any): string | null {
    return response?.sid ? String(response.sid) : null;
}

async function resolveWebBridgeRecipient(row: any, normalizedPhone: string) {
    let webBridgeConversationChatId = "";
    if ((!normalizedPhone || normalizedPhone.length < 7) && row.conversationId) {
        const sync = await (db as any).conversationSync.findFirst({
            where: {
                conversationId: row.conversationId,
                provider: WHATSAPP_WEB_BRIDGE_PROVIDER,
                providerConversationId: { not: null },
            },
            select: { providerConversationId: true },
            orderBy: { updatedAt: "desc" },
        }).catch(() => null);
        webBridgeConversationChatId = String(sync?.providerConversationId || "").trim();
    }
    if (webBridgeConversationChatId) return webBridgeConversationChatId;

    if (normalizedPhone && normalizedPhone.length >= 7) {
        const resolved = await resolveWhatsAppWebBridgeChatForPhone({
            locationId: row.locationId,
            phone: normalizedPhone,
        });
        if (!isResolvedWhatsAppWebBridgeChatAvailable(resolved)) {
            throw new Error("This number is not available on WhatsApp.");
        }
        return String(resolved.chatId || "").trim();
    }

    return "";
}

async function createSignedMediaUrl(payload: any) {
    const objectKey = String(payload?.objectKey || "").trim();
    const contentType = String(payload?.contentType || "").trim();
    const fileName = String(payload?.fileName || "upload");
    if (!objectKey || !contentType) {
        throw new Error("Missing media payload details.");
    }

    const signedMediaUrl = await createWhatsAppMediaReadUrl({
        key: objectKey,
        contentType,
        fileName,
        expiresInSeconds: 300,
    });

    return { signedMediaUrl, contentType, fileName };
}

export async function dispatchWhatsAppOutbound(row: any): Promise<WhatsAppOutboundDispatchResult> {
    const payload = (row.payload || {}) as any;
    const transport = String(row.transport || "web_bridge").trim() || "web_bridge";
    if (transport === "evolution") {
        throw new Error("Evolution API has been retired. Recreate or resend this message through WhatsApp Web Bridge or Cloud API.");
    }

    const normalizedPhone = normalizePhoneDigits(row.contact?.phone);
    if (transport !== "web_bridge" && (!normalizedPhone || normalizedPhone.length < 7)) {
        throw new Error("Contact phone is missing or invalid for WhatsApp send.");
    }

    let wamId: string | null = null;
    let provider = "whatsapp_retired";
    let providerAccountId = "default";

    if (transport === "cloud_api") {
        provider = WHATSAPP_CLOUD_PROVIDER;
        const channel = await getDefaultWhatsAppCloudChannel(row.locationId);
        const channelId = channel?.id || null;
        providerAccountId = String(channel?.phoneNumberId || row.location?.whatsappPhoneNumberId || "default");

        if (row.kind === "text") {
            const text = String(payload?.text || row.message?.body || "");
            if (!text.trim()) {
                throw new Error("Cannot send empty WhatsApp message body.");
            }
            const response = await sendWhatsAppCloudText(row.locationId, normalizedPhone, text, channelId);
            wamId = extractCloudWamId(response);
        } else if (row.kind === "template") {
            const templateName = String(payload?.templateName || "").trim();
            const templateLanguage = String(payload?.templateLanguage || "").trim();
            if (!templateName || !templateLanguage) {
                throw new Error("WhatsApp template payload is missing name or language.");
            }
            const response = await sendWhatsAppCloudTemplate(row.locationId, normalizedPhone, {
                name: templateName,
                language: templateLanguage,
                category: payload?.templateCategory || null,
                components: Array.isArray(payload?.templateComponents) ? payload.templateComponents : [],
            }, channelId);
            wamId = extractCloudWamId(response);
        } else {
            const { signedMediaUrl, contentType, fileName } = await createSignedMediaUrl(payload);
            const caption = String(payload?.caption || "").trim() || undefined;
            const response = await sendWhatsAppCloudMedia(row.locationId, normalizedPhone, {
                mediaType: toMediaType(String(row.kind || "")),
                mediaUrl: signedMediaUrl,
                caption,
                mimetype: contentType,
                fileName,
            }, channelId);
            wamId = extractCloudWamId(response);
        }
    } else if (transport === "web_bridge") {
        provider = WHATSAPP_WEB_BRIDGE_PROVIDER;
        providerAccountId = row.locationId;

        const webBridgeRecipient = await resolveWebBridgeRecipient(row, normalizedPhone);
        if (!webBridgeRecipient) {
            throw new Error("Contact phone is missing and no WhatsApp Web chat id is available for this conversation.");
        }
        if (row.kind === "template") {
            throw new Error("WhatsApp templates require Cloud API transport.");
        }

        if (row.kind === "text") {
            const text = String(payload?.text || row.message?.body || "");
            if (!text.trim()) {
                throw new Error("Cannot send empty WhatsApp message body.");
            }
            const response = await sendWhatsAppWebBridgeMessage({
                locationId: row.locationId,
                to: webBridgeRecipient,
                text,
            });
            wamId = response?.messageId ? String(response.messageId) : null;
        } else {
            const { signedMediaUrl, contentType, fileName } = await createSignedMediaUrl(payload);
            const caption = String(payload?.caption || "").trim() || undefined;
            const response = await sendWhatsAppWebBridgeMessage({
                locationId: row.locationId,
                to: webBridgeRecipient,
                mediaUrl: signedMediaUrl,
                mimetype: contentType,
                fileName,
                caption,
            });
            wamId = response?.messageId ? String(response.messageId) : null;
        }
    } else if (transport === "twilio") {
        provider = "twilio";
        providerAccountId = String(row.location?.twilioAccountSid || "default");
        const text = String(payload?.text || row.message?.body || "");
        if (!text.trim()) {
            throw new Error("Cannot send empty WhatsApp message body.");
        }
        const response = await sendTwilioMessage(row.locationId, `+${normalizedPhone}`, { body: text });
        wamId = extractTwilioMessageId(response);
    } else {
        throw new Error(`Unsupported WhatsApp transport: ${transport}`);
    }

    if (!wamId) {
        throw new Error(`${transport} send did not return provider message id confirmation.`);
    }

    return { transport, provider, providerAccountId, wamId };
}
