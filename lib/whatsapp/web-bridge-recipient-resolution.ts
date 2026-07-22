export type WhatsAppWebBridgeRecipientVerification = "verified" | "unavailable" | "unknown";

export type WhatsAppWebBridgeResolvedChat = {
    chatId?: string | null;
    source?: string | null;
    available?: boolean | null;
    reason?: string | null;
    verification?: WhatsAppWebBridgeRecipientVerification | null;
    retryable?: boolean | null;
    contactIdentity?: any;
};

export function buildWhatsAppWebBridgePhoneChatId(value: unknown) {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length >= 7 ? `${digits}@c.us` : "";
}

export function buildWhatsAppWebBridgeRecipientResolution(input: {
    phone: unknown;
    registration: "verified" | "unavailable" | "unknown";
    registeredChatId?: unknown;
    existingChatId?: unknown;
}): WhatsAppWebBridgeResolvedChat {
    const registeredChatId = String(input.registeredChatId || "").trim();
    if (registeredChatId) {
        return {
            chatId: registeredChatId,
            source: "getNumberId",
            available: true,
            verification: "verified",
            retryable: false,
        };
    }

    const existingChatId = String(input.existingChatId || "").trim();
    if (existingChatId) {
        return {
            chatId: existingChatId,
            source: "chat_scan_latest",
            available: true,
            verification: "verified",
            retryable: false,
        };
    }

    if (input.registration === "unavailable") {
        return {
            chatId: null,
            source: "not_found",
            available: false,
            reason: "number_not_found",
            verification: "unavailable",
            retryable: false,
        };
    }

    const candidateChatId = buildWhatsAppWebBridgePhoneChatId(input.phone);
    return {
        chatId: candidateChatId || null,
        source: "registration_check_unavailable",
        available: null,
        reason: "registration_check_unavailable",
        verification: "unknown",
        retryable: true,
    };
}

export function isWhatsAppWebBridgeRecipientVerified(result: WhatsAppWebBridgeResolvedChat | null | undefined) {
    if (result?.verification === "verified" || result?.available === true) return true;
    const source = String(result?.source || "").trim();
    return source === "preferred" || source === "getNumberId" || source === "chat_scan_latest";
}

export function isWhatsAppWebBridgeRecipientVerificationUnknown(result: WhatsAppWebBridgeResolvedChat | null | undefined) {
    return result?.verification === "unknown"
        || result?.source === "registration_check_unavailable"
        || result?.reason === "registration_check_unavailable";
}

export function isWhatsAppWebBridgeRecipientCandidateUsable(result: WhatsAppWebBridgeResolvedChat | null | undefined) {
    const chatId = String(result?.chatId || "").trim();
    if (!/^\d{7,15}@c\.us$/i.test(chatId)) return false;
    return isWhatsAppWebBridgeRecipientVerified(result)
        || isWhatsAppWebBridgeRecipientVerificationUnknown(result);
}
