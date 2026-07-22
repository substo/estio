export const WHATSAPP_WEB_BRIDGE_RECONCILIATION_CHAT_LIMIT = 50;
export const WHATSAPP_WEB_BRIDGE_RECONCILIATION_MESSAGES_PER_CHAT = 20;
export const WHATSAPP_WEB_BRIDGE_RECONCILIATION_MESSAGE_LIMIT = 200;
export const WHATSAPP_WEB_BRIDGE_RECONCILIATION_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

function chatId(chat: any) {
    const serialized = String(chat?.id?._serialized || "").trim();
    if (serialized) return serialized;
    return typeof chat?.id === "string" ? chat.id.trim() : "";
}

export function selectWhatsAppWebBridgeReconciliationChats(
    chats: any[],
    limit = WHATSAPP_WEB_BRIDGE_RECONCILIATION_CHAT_LIMIT,
) {
    return [...(chats || [])]
        .filter((chat) => !chat?.isGroup && chatId(chat))
        .sort((left, right) => Number(right?.timestamp || 0) - Number(left?.timestamp || 0))
        .slice(0, Math.max(0, limit));
}

export function isWhatsAppWebBridgeReconciliationMessageRecent(args: {
    timestampSeconds: number;
    nowMs?: number;
    lookbackMs?: number;
}) {
    const timestampMs = Number(args.timestampSeconds || 0) * 1000;
    const nowMs = args.nowMs ?? Date.now();
    const lookbackMs = args.lookbackMs ?? WHATSAPP_WEB_BRIDGE_RECONCILIATION_LOOKBACK_MS;
    return Number.isFinite(timestampMs)
        && timestampMs > 0
        && timestampMs <= nowMs + 2 * 60_000
        && timestampMs >= nowMs - lookbackMs;
}

export function selectWhatsAppWebBridgeReconciliationMessages(
    messages: any[],
    nowMs = Date.now(),
    limit = WHATSAPP_WEB_BRIDGE_RECONCILIATION_MESSAGE_LIMIT,
) {
    const seen = new Set<string>();
    return [...(messages || [])]
        .filter((message) => isWhatsAppWebBridgeReconciliationMessageRecent({
            timestampSeconds: Number(message?.timestamp || message?.t || 0),
            nowMs,
        }))
        .sort((left, right) => Number(right?.timestamp || right?.t || 0) - Number(left?.timestamp || left?.t || 0))
        .filter((message) => {
            const id = String(message?.id?._serialized || message?.id || "").trim();
            if (!id || seen.has(id)) return false;
            seen.add(id);
            return true;
        })
        .slice(0, Math.max(0, limit))
        .sort((left, right) => Number(left?.timestamp || left?.t || 0) - Number(right?.timestamp || right?.t || 0));
}
