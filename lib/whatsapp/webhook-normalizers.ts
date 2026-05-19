import type { NormalizedMessage } from "@/lib/whatsapp/sync";
import { parseWhatsAppWebChatIdentity } from "@/lib/whatsapp/web-bridge";

export function getWhatsAppCloudInboundBody(message: any) {
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

export function normalizeWhatsAppCloudInboundType(type: string): NormalizedMessage["type"] {
    if (["text", "image", "document", "audio", "video", "sticker", "reaction", "contact"].includes(type)) {
        return type as NormalizedMessage["type"];
    }
    if (type === "contacts") return "contact";
    return "other";
}

export function parseWhatsAppWebhookTimestamp(value: any) {
    const seconds = Number(value || 0);
    if (seconds > 0) return new Date(seconds * 1000);
    return new Date();
}

export function normalizeWhatsAppWebBridgeAckStatus(ack: unknown) {
    const n = Number(ack);
    if (n >= 3) return "READ";
    if (n === 2) return "DELIVERED";
    if (n === 1) return "SERVER_ACK";
    if (n < 0) return "FAILED";
    return "";
}

export function normalizeWhatsAppCloudInboundMessage(args: {
    locationId: string;
    phoneNumberId: string;
    contacts: any[];
    message: any;
}): NormalizedMessage | null {
    const from = String(args.message?.from || "").trim();
    const wamId = String(args.message?.id || "").trim();
    if (!from || !wamId) return null;

    const contact = args.contacts.find((candidate: any) => String(candidate?.wa_id || "") === from);
    const type = String(args.message?.type || "other");
    return {
        locationId: args.locationId,
        from,
        to: args.phoneNumberId,
        type: normalizeWhatsAppCloudInboundType(type),
        body: getWhatsAppCloudInboundBody(args.message),
        wamId,
        timestamp: parseWhatsAppWebhookTimestamp(args.message?.timestamp),
        contactName: contact?.profile?.name,
        source: "whatsapp_native",
        direction: "inbound",
    };
}

export function normalizeWhatsAppWebBridgeMessage(args: {
    locationId: string;
    phone?: any;
    message: any;
    resolvedIdentity: any;
}): { normalized: NormalizedMessage | null; wamId: string; rawMessage: any; ignoreReason?: string } {
    const message = args.message || {};
    const fromMe = Boolean(message.fromMe);
    const fromId = String(message.from || "");
    const toId = String(message.to || "");
    const remoteId = fromMe ? toId : fromId;
    const contactIdentity = parseWhatsAppWebChatIdentity(remoteId);
    const ownIdentity = parseWhatsAppWebChatIdentity(args.phone || (fromMe ? fromId : toId));
    const contactLid = args.resolvedIdentity.lid || contactIdentity.lid || "";
    const contactPhone = contactIdentity.phone || args.resolvedIdentity.phone || "";
    const contactAddress = contactPhone || contactLid;
    const ownPhone = ownIdentity.phone || args.locationId;
    const wamId = String(message.id || message.messageId || "").trim();

    if (!wamId) {
        return { normalized: null, wamId, rawMessage: message, ignoreReason: "missing_message_id" };
    }
    if (!contactIdentity.isSupported || !contactAddress) {
        return {
            normalized: null,
            wamId,
            rawMessage: message,
            ignoreReason: contactIdentity.reason || "unsupported_message_identity",
        };
    }

    return {
        wamId,
        rawMessage: message,
        normalized: {
            locationId: args.locationId,
            from: fromMe ? ownPhone : contactAddress,
            to: fromMe ? contactAddress : ownPhone,
            body: String(message.body || message.caption || ""),
            type: String(message.type || "text") as any,
            wamId,
            timestamp: new Date(Number(message.timestamp || Date.now() / 1000) * 1000),
            direction: fromMe ? "outbound" : "inbound",
            source: "whatsapp_web_bridge" as any,
            contactName: args.resolvedIdentity.displayName || message.contactName || message.notifyName || undefined,
            lid: contactLid || undefined,
            resolvedPhone: contactPhone || undefined,
            remoteJid: remoteId,
            chatId: contactIdentity.chatId || remoteId,
            webBridgeIdentity: {
                ...args.resolvedIdentity,
                rawContactIdentity: message.contactIdentity || null,
            } as any,
        },
    };
}
