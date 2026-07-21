const SERIALIZED_MESSAGE_ID_PREFIX = /^(?:true|false)_/i;

export function getWhatsAppWebBridgeLocalMessageId(value: unknown): string | null {
    const messageId = String(value || "").trim();
    if (!SERIALIZED_MESSAGE_ID_PREFIX.test(messageId)) return null;

    const separatorIndex = messageId.lastIndexOf("_");
    if (separatorIndex <= 0 || separatorIndex === messageId.length - 1) return null;
    return messageId.slice(separatorIndex + 1);
}

export function isWhatsAppWebBridgeSerializedMessageId(value: unknown): boolean {
    return getWhatsAppWebBridgeLocalMessageId(value) !== null;
}

export function areWhatsAppWebBridgeMessageIdAliases(leftValue: unknown, rightValue: unknown): boolean {
    const left = String(leftValue || "").trim();
    const right = String(rightValue || "").trim();
    if (!left || !right || left === right) return false;

    return getWhatsAppWebBridgeLocalMessageId(left) === right
        || getWhatsAppWebBridgeLocalMessageId(right) === left;
}

function normalizeMessageBody(value: unknown) {
    return String(value || "").trim().replace(/\s+/g, " ");
}

export function selectCanonicalizableWhatsAppWebBridgeAlias<T extends Record<string, any>>(args: {
    canonicalMessageId: string;
    body: unknown;
    timestamp: Date;
    candidates: T[];
}): T | null {
    if (!isWhatsAppWebBridgeSerializedMessageId(args.canonicalMessageId)) return null;
    const body = normalizeMessageBody(args.body);
    const timestampMs = args.timestamp instanceof Date ? args.timestamp.getTime() : Number.NaN;
    if (!body || !Number.isFinite(timestampMs)) return null;

    const aliases = (args.candidates || []).filter((candidate) => {
        const candidateTimestamp = candidate.createdAt instanceof Date
            ? candidate.createdAt.getTime()
            : new Date(candidate.createdAt || 0).getTime();
        return String(candidate.direction || "") === "outbound"
            && String(candidate.source || "") === "whatsapp_web_bridge"
            && !candidate.clientMessageId
            && !candidate.outboundWhatsAppOutbox
            && candidateTimestamp === timestampMs
            && normalizeMessageBody(candidate.body) === body
            && areWhatsAppWebBridgeMessageIdAliases(candidate.wamId, args.canonicalMessageId);
    });

    return aliases.length === 1 ? aliases[0] : null;
}
