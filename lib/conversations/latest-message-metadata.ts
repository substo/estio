export type ConversationLatestMessageMetadata = {
    id: string;
    conversationId: string;
    type: string | null;
    source: string | null;
    direction: "inbound" | "outbound" | string | null;
    createdAt: Date | string;
};

export const LATEST_MESSAGE_METADATA_SELECT = {
    id: true,
    conversationId: true,
    type: true,
    source: true,
    direction: true,
    createdAt: true,
} as const;

export function buildLatestMessageMetadataMap(
    messages: ConversationLatestMessageMetadata[]
): Map<string, ConversationLatestMessageMetadata> {
    return new Map(messages.map((message) => [message.conversationId, message]));
}

export function resolveCurrentLatestMessageMetadata(
    rowLastMessageAt: Date | string | null | undefined,
    candidateLatestMessage: ConversationLatestMessageMetadata | null | undefined,
): ConversationLatestMessageMetadata | null {
    if (!candidateLatestMessage) return null;

    const rowLastMessageAtMs = rowLastMessageAt ? new Date(rowLastMessageAt).getTime() : NaN;
    const candidateCreatedAtMs = new Date(candidateLatestMessage.createdAt).getTime();

    if (
        !Number.isFinite(rowLastMessageAtMs)
        || !Number.isFinite(candidateCreatedAtMs)
        || candidateCreatedAtMs >= rowLastMessageAtMs - 1000
    ) {
        return candidateLatestMessage;
    }

    return null;
}
