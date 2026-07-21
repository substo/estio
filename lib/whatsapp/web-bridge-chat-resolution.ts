export type WhatsAppWebBridgeResolvedChatCandidate<TIdentity = unknown> = {
    chatId: string;
    timestamp?: number | null;
    contactIdentity?: TIdentity;
};

function normalizeChatTimestamp(value: unknown) {
    const timestamp = Number(value || 0);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

export function sortWhatsAppWebBridgeChatsByMostRecent<T extends { timestamp?: unknown; t?: unknown }>(chats: T[]) {
    return chats
        .map((chat, index) => ({ chat, index }))
        .sort((left, right) => {
            const timestampDifference = normalizeChatTimestamp(right.chat.timestamp ?? right.chat.t)
                - normalizeChatTimestamp(left.chat.timestamp ?? left.chat.t);
            return timestampDifference || left.index - right.index;
        })
        .map(({ chat }) => chat);
}

export function selectMostRecentWhatsAppWebBridgeChat<TIdentity>(
    candidates: WhatsAppWebBridgeResolvedChatCandidate<TIdentity>[],
) {
    let selected: WhatsAppWebBridgeResolvedChatCandidate<TIdentity> | null = null;
    let selectedTimestamp = -1;

    for (const candidate of candidates) {
        const chatId = String(candidate?.chatId || "").trim();
        if (!chatId) continue;
        const timestamp = normalizeChatTimestamp(candidate.timestamp);
        if (!selected || timestamp > selectedTimestamp) {
            selected = { ...candidate, chatId, timestamp };
            selectedTimestamp = timestamp;
        }
    }

    return selected;
}
