import type { Conversation } from "@/lib/ghl/conversations";

export type ConversationComposerChannel = "SMS" | "Email" | "WhatsApp" | "SMS_RELAY";
export type ChannelCapabilityStatus = "available" | "unavailable" | "checking" | "unknown";
export type ChannelUnavailableReason =
    | "missing_phone"
    | "missing_email"
    | "masked_phone"
    | "invalid_phone"
    | "ghl_sms_not_configured"
    | "sms_relay_disabled"
    | "sms_relay_not_paired"
    | "sms_relay_offline"
    | "sms_blocked_by_policy"
    | "whatsapp_not_connected"
    | "whatsapp_number_not_found"
    | "unknown";

export type ConversationChannelCapability = {
    status: ChannelCapabilityStatus;
    available: boolean;
    reason: ChannelUnavailableReason | null;
    label: string | null;
};

export type ConversationChannelCapabilities = Record<ConversationComposerChannel, ConversationChannelCapability>;

const DEFAULT_UNAVAILABLE_LABELS: Record<Exclude<ChannelUnavailableReason, "unknown">, string> = {
    missing_phone: "Contact does not have a phone number.",
    missing_email: "Contact does not have an email address.",
    masked_phone: "Contact phone number is masked.",
    invalid_phone: "Contact phone number is invalid.",
    ghl_sms_not_configured: "SMS is not configured for this location.",
    sms_relay_disabled: "Android SMS is disabled for this location.",
    sms_relay_not_paired: "No paired Android SMS device is available.",
    sms_relay_offline: "Android SMS device is offline.",
    sms_blocked_by_policy: "SMS is unavailable because location SMS is not configured.",
    whatsapp_not_connected: "WhatsApp is not connected.",
    whatsapp_number_not_found: "This number is not available on WhatsApp.",
};

export function availableChannel(label?: string | null): ConversationChannelCapability {
    return { status: "available", available: true, reason: null, label: label || null };
}

export function unverifiedAvailableChannel(label = "Channel availability will be confirmed when sending."): ConversationChannelCapability {
    return { status: "unknown", available: true, reason: "unknown", label };
}

export function unavailableChannel(reason: ChannelUnavailableReason, label?: string | null): ConversationChannelCapability {
    return {
        status: "unavailable",
        available: false,
        reason,
        label: label || (reason === "unknown" ? "Channel is unavailable." : DEFAULT_UNAVAILABLE_LABELS[reason]),
    };
}

export function checkingChannel(label = "Checking channel availability."): ConversationChannelCapability {
    return { status: "checking", available: false, reason: null, label };
}

export function unknownChannel(label = "Could not verify channel availability."): ConversationChannelCapability {
    return { status: "unknown", available: false, reason: "unknown", label };
}

export function createDefaultChannelCapabilities(): ConversationChannelCapabilities {
    return {
        SMS: checkingChannel("Checking SMS availability."),
        SMS_RELAY: checkingChannel("Checking Android SMS availability."),
        Email: checkingChannel("Checking email availability."),
        WhatsApp: checkingChannel("Checking WhatsApp availability."),
    };
}

export function getFirstAvailableChannel(
    preferred: ConversationComposerChannel,
    capabilities: ConversationChannelCapabilities
): ConversationComposerChannel | null {
    if (capabilities[preferred]?.available) return preferred;
    for (const channel of ["WhatsApp", "SMS_RELAY", "SMS", "Email"] as ConversationComposerChannel[]) {
        if (capabilities[channel]?.available) return channel;
    }
    return null;
}

export function getBestAvailableDefaultChannel(
    capabilities: ConversationChannelCapabilities
): ConversationComposerChannel | null {
    for (const channel of ["WhatsApp", "SMS_RELAY", "SMS", "Email"] as ConversationComposerChannel[]) {
        if (capabilities[channel]?.available) return channel;
    }
    return null;
}

export function getConversationContactIdentity(conversation: Conversation | null | undefined) {
    return {
        hasPhone: String(conversation?.contactPhone || "").replace(/\D/g, "").length >= 7,
        hasEmail: String(conversation?.contactEmail || "").trim().length > 0,
    };
}
