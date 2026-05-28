export type OutboundSendFailureCode =
    | "WHATSAPP_NUMBER_NOT_FOUND"
    | "WHATSAPP_AUTH"
    | "WHATSAPP_PROVIDER_DOWN"
    | "SMS_UNAVAILABLE"
    | "UNKNOWN";

export type OutboundFallbackChannel = "SMS_RELAY";

export type OutboundSendFailureClassification = {
    code: OutboundSendFailureCode;
    label: string;
    retryable: boolean;
    fallbackChannels: OutboundFallbackChannel[];
    rawError: string | null;
};

type SmsFallbackAvailabilityInput = {
    smsRelayEnabled?: boolean | null;
    contactPhone?: string | null;
    smsRelayDevice?: {
        paired?: boolean | null;
        status?: string | null;
    } | null;
};

export function extractOutboundFailureText(input: unknown): string {
    if (input == null) return "";
    if (typeof input === "string") return input;
    if (input instanceof Error) {
        return [
            input.message,
            extractOutboundFailureText((input as any).cause),
            extractOutboundFailureText((input as any).response?.data),
        ].filter(Boolean).join(" ");
    }
    if (typeof input === "object") {
        const value = input as Record<string, unknown>;
        const candidates = [
            value.lastError,
            value.error,
            value.message,
            value.code,
            value.reason,
            value.status,
            value.providerError,
            value.provider_error,
            value.metadata,
            value.response,
            value.data,
            value.cause,
        ];
        return candidates.map(extractOutboundFailureText).filter(Boolean).join(" ");
    }
    return String(input || "");
}

function normalizeFailureText(input: unknown): string {
    return extractOutboundFailureText(input)
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

export function classifyOutboundSendFailure(input: unknown): OutboundSendFailureClassification {
    const rawError = extractOutboundFailureText(input).replace(/\s+/g, " ").trim() || null;
    const normalized = normalizeFailureText(input);

    if (
        normalized.includes("no lid for user")
        || normalized.includes("not on whatsapp")
        || normalized.includes("not available on whatsapp")
        || normalized.includes("not registered")
        || normalized.includes("not a whatsapp user")
        || normalized.includes("recipient is not a whatsapp")
        || normalized.includes("phone number is not registered")
        || (normalized.includes("wa_id") && normalized.includes("not found"))
    ) {
        return {
            code: "WHATSAPP_NUMBER_NOT_FOUND",
            label: "This number is not available on WhatsApp.",
            retryable: false,
            fallbackChannels: ["SMS_RELAY"],
            rawError,
        };
    }

    if (
        normalized.includes("not connected")
        || normalized.includes("scan the qr")
        || normalized.includes("session is ready")
        || normalized.includes("authentication")
        || normalized.includes("unauthorized")
        || normalized.includes("forbidden")
    ) {
        return {
            code: "WHATSAPP_AUTH",
            label: "WhatsApp is not authenticated.",
            retryable: true,
            fallbackChannels: ["SMS_RELAY"],
            rawError,
        };
    }

    if (
        normalized.includes("timed out")
        || normalized.includes("timeout")
        || normalized.includes("econnreset")
        || normalized.includes("econnrefused")
        || normalized.includes("provider down")
        || normalized.includes("server error")
    ) {
        return {
            code: "WHATSAPP_PROVIDER_DOWN",
            label: "WhatsApp delivery is temporarily unavailable.",
            retryable: true,
            fallbackChannels: ["SMS_RELAY"],
            rawError,
        };
    }

    if (normalized.includes("sms") && normalized.includes("unavailable")) {
        return {
            code: "SMS_UNAVAILABLE",
            label: "SMS fallback unavailable.",
            retryable: false,
            fallbackChannels: [],
            rawError,
        };
    }

    return {
        code: "UNKNOWN",
        label: "Message delivery failed.",
        retryable: true,
        fallbackChannels: [],
        rawError,
    };
}

export function getSmsFallbackAvailability(input: SmsFallbackAvailabilityInput) {
    const digits = String(input.contactPhone || "").replace(/\D/g, "");
    const hasPhone = digits.length >= 7;
    const device = input.smsRelayDevice || null;
    const hasAuthenticatedRelay = !!input.smsRelayEnabled && !!device?.paired && String(device.status || "").toLowerCase() === "online";

    return {
        available: hasPhone && hasAuthenticatedRelay,
        channel: hasPhone && hasAuthenticatedRelay ? "SMS_RELAY" as const : null,
        reason: !hasPhone
            ? "missing_phone"
            : !input.smsRelayEnabled
                ? "sms_relay_disabled"
                : !device?.paired
                    ? "sms_relay_not_paired"
                    : String(device.status || "").toLowerCase() !== "online"
                        ? "sms_relay_offline"
                        : null,
    };
}
