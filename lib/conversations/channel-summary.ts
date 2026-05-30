import type { Conversation } from "@/lib/ghl/conversations";

export type ConversationDisplayChannel = "WhatsApp" | "Email" | "SMS" | "SMS_RELAY" | "Unknown";

type ConversationChannelInput = Pick<Conversation,
    "lastMessageType" | "type" | "lastMessageSource" | "lastMessageChannel"
>;

function normalize(value: string | null | undefined): string {
    return String(value || "").trim().toUpperCase();
}

function normalizeSource(value: string | null | undefined): string {
    return String(value || "").trim().toLowerCase();
}

export function deriveConversationDisplayChannel(
    conversation: ConversationChannelInput | null | undefined
): ConversationDisplayChannel {
    if (!conversation) return "Unknown";

    if (conversation.lastMessageChannel) {
        return conversation.lastMessageChannel;
    }

    const latestType = normalize(conversation.lastMessageType);
    const fallbackType = normalize(conversation.type);
    const type = latestType || fallbackType;
    const source = normalizeSource(conversation.lastMessageSource);

    if (type.includes("WHATSAPP")) return "WhatsApp";
    if (type.includes("EMAIL")) return "Email";
    if (type.includes("SMS") || type.includes("PHONE") || type.includes("CALL")) {
        return source === "sms_relay" || source === "sms_relay_manual" ? "SMS_RELAY" : "SMS";
    }

    return type ? "Unknown" : "Unknown";
}

export function getConversationDisplayChannelLabel(channel: ConversationDisplayChannel): string {
    if (channel === "SMS_RELAY") return "Android SMS";
    return channel;
}

export function deriveComposerInitialChannel(
    conversation: ConversationChannelInput | null | undefined,
    options: { smsRelayEnabled?: boolean } = {}
): "SMS" | "Email" | "WhatsApp" | "SMS_RELAY" {
    const channel = deriveConversationDisplayChannel(conversation);
    if (channel === "SMS_RELAY") {
        return options.smsRelayEnabled ? "SMS_RELAY" : "SMS";
    }
    if (channel === "Email" || channel === "WhatsApp") return channel;
    return "SMS";
}
