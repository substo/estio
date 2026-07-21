export function requireWhatsAppWebBridgeSentMessageId(sent: unknown) {
    if (!sent || typeof sent !== "object") {
        throw new Error("WHATSAPP_SEND_RESULT_MISSING_ID");
    }
    const id = (sent as { id?: { _serialized?: unknown; id?: unknown } }).id;
    const messageId = String(id?._serialized || id?.id || "").trim();
    if (!messageId) throw new Error("WHATSAPP_SEND_RESULT_MISSING_ID");
    return messageId;
}
