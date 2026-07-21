export function requireWhatsAppWebBridgeSentMessageId(sent: unknown) {
    if (!sent || typeof sent !== "object") {
        throw new Error("WHATSAPP_SEND_RESULT_MISSING_ID");
    }
    const id = (sent as { id?: { _serialized?: unknown; id?: unknown } }).id;
    const messageId = String(id?._serialized || id?.id || "").trim();
    if (!messageId) throw new Error("WHATSAPP_SEND_RESULT_MISSING_ID");
    return messageId;
}

export const WHATSAPP_WEB_BRIDGE_TEXT_SEND_REQUEST_TIMEOUT_MS = 35_000;
export const WHATSAPP_WEB_BRIDGE_MEDIA_SEND_REQUEST_TIMEOUT_MS = 75_000;

export function getWhatsAppWebBridgeSendRequestTimeoutMs(input: { hasMedia: boolean }) {
    return input.hasMedia
        ? WHATSAPP_WEB_BRIDGE_MEDIA_SEND_REQUEST_TIMEOUT_MS
        : WHATSAPP_WEB_BRIDGE_TEXT_SEND_REQUEST_TIMEOUT_MS;
}

export function getWhatsAppWebBridgeLinkPreviewPolicy(input: { requested: boolean }) {
    return {
        requested: input.requested,
        enabled: false,
        suppressed: input.requested,
    } as const;
}

export class WhatsAppWebBridgeDeliveryUnconfirmedError extends Error {
    readonly code = "WHATSAPP_WEB_BRIDGE_DELIVERY_UNCONFIRMED";

    constructor() {
        super("WhatsApp Web send outcome is unknown; not retrying automatically to avoid duplicate delivery.");
        this.name = "WhatsAppWebBridgeDeliveryUnconfirmedError";
    }
}

export function isWhatsAppWebBridgeDeliveryUnconfirmedError(error: unknown) {
    return error instanceof WhatsAppWebBridgeDeliveryUnconfirmedError
        || String((error as any)?.code || "") === "WHATSAPP_WEB_BRIDGE_DELIVERY_UNCONFIRMED";
}
