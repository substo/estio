import type { NormalizedMessage } from "@/lib/whatsapp/sync";
import { isHighConfidenceResolvedPhone, normalizeDigits } from "@/lib/whatsapp/identity";
import { parseWhatsAppWebChatIdentity } from "@/lib/whatsapp/web-bridge";
import { resolveInboundWhatsAppContactIdentity } from "@/lib/whatsapp/web-bridge-message-identity";

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
    if (type === "contacts") {
        const contacts = Array.isArray(message?.contacts)
            ? message.contacts.map((contact: any) => {
                const name = contact?.name || {};
                const phones = Array.isArray(contact?.phones) ? contact.phones : [];
                const emails = Array.isArray(contact?.emails) ? contact.emails : [];
                const org = contact?.org || {};
                return {
                    displayName: String(name.formatted_name || [name.first_name, name.last_name].filter(Boolean).join(" ") || phones[0]?.phone || emails[0]?.email || "Shared contact"),
                    phoneNumber: phones[0]?.phone ? String(phones[0].phone) : null,
                    email: emails[0]?.email ? String(emails[0].email) : null,
                    organization: org.company ? String(org.company) : null,
                };
            }).filter((contact: any) => contact.displayName)
            : [];
        if (contacts.length > 0) {
            return `[Contact]\n---CONTACTS_DATA---\n${JSON.stringify(contacts)}`;
        }
        return "[Contact]";
    }
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
    const identity = resolveInboundWhatsAppContactIdentity({ message, phone: args.phone });
    const { fromMe, remoteJid: remoteId, contactIdentity, ownIdentity } = identity;
    const participantIdentity = identity.isGroup
        ? parseWhatsAppWebChatIdentity(identity.senderJid)
        : null;
    const contactLid = args.resolvedIdentity.lid || contactIdentity.lid || "";
    const ownPhone = ownIdentity.phone || args.locationId;
    const resolvedIdentityDigits = normalizeDigits(args.resolvedIdentity.phone);
    const resolvedIdentityPhone = isHighConfidenceResolvedPhone(resolvedIdentityDigits)
        ? resolvedIdentityDigits
        : "";
    const candidateContactPhone = contactIdentity.phone || resolvedIdentityPhone || "";
    const candidateIsOwnPhone = !!candidateContactPhone
        && normalizeDigits(candidateContactPhone) === normalizeDigits(ownPhone);
    if (candidateIsOwnPhone) {
        console.warn("[WhatsApp Web Bridge] Ignoring resolved contact phone equal to connected account phone", {
            wamId: String(message.id || message.messageId || "").trim(),
            remoteJid: remoteId,
            contactLid: contactLid || undefined,
            direction: fromMe ? "outbound" : "inbound",
            resolvedIdentitySource: args.resolvedIdentity.source,
        });
    }
    const contactPhone = candidateIsOwnPhone ? "" : candidateContactPhone;
    const contactAddress = contactPhone || contactLid;
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
            chatId: identity.isGroup ? remoteId : (contactIdentity.chatId || remoteId),
            isGroup: identity.isGroup,
            participant: identity.isGroup ? identity.senderJid : undefined,
            participantJid: identity.isGroup ? identity.senderJid : undefined,
            participantPhoneJid: participantIdentity?.phone ? `${participantIdentity.phone}@s.whatsapp.net` : undefined,
            participantLidJid: participantIdentity?.lid || undefined,
            participantDisplayName: identity.isGroup ? (args.resolvedIdentity.displayName || message.notifyName || undefined) : undefined,
            webBridgeIdentity: {
                ...args.resolvedIdentity,
                rawContactIdentity: message.contactIdentity || null,
            } as any,
        },
    };
}
