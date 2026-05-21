import type { Conversation } from '@/lib/ghl/conversations';

export function removeMergedSourceConversation(
    conversations: Conversation[],
    sourceConversationId: string
): Conversation[] {
    const normalizedSourceConversationId = String(sourceConversationId || "").trim();
    if (!normalizedSourceConversationId) return conversations;

    return conversations.filter((conversation) => conversation.id !== normalizedSourceConversationId);
}

export function resolvePostMergeActiveConversationId(targetConversationId?: string | null): string | null {
    const normalizedTargetConversationId = targetConversationId ? String(targetConversationId).trim() : "";
    return normalizedTargetConversationId || null;
}
