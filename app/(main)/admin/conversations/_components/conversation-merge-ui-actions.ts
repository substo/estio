import type { Conversation } from '@/lib/ghl/conversations';

export function removeMergedSourceConversation(
    conversations: Conversation[],
    sourceConversationId: string
): Conversation[] {
    const normalizedSourceConversationId = String(sourceConversationId || "").trim();
    if (!normalizedSourceConversationId) return conversations;

    return conversations.filter((conversation) => conversation.id !== normalizedSourceConversationId);
}

export function shouldRemoveMergedSourceConversation(
    sourceConversationId: string,
    targetConversationId?: string | null
): boolean {
    const normalizedSourceConversationId = String(sourceConversationId || "").trim();
    const normalizedTargetConversationId = targetConversationId ? String(targetConversationId).trim() : "";
    return !!normalizedSourceConversationId
        && !!normalizedTargetConversationId
        && normalizedSourceConversationId !== normalizedTargetConversationId;
}

export function upsertPostMergeTargetConversation<T extends Conversation>(
    conversations: T[],
    targetConversationId: string,
    freshConversation: Conversation,
    options?: { insertIfMissing?: boolean }
): T[] {
    const normalizedTargetConversationId = String(targetConversationId || "").trim();
    if (!normalizedTargetConversationId || !freshConversation?.id) return conversations;

    const hasTargetConversation = conversations.some((conversation) => conversation.id === normalizedTargetConversationId);
    if (hasTargetConversation) {
        return conversations.map((conversation) => (
            conversation.id === normalizedTargetConversationId
                ? { ...conversation, ...freshConversation } as T
                : conversation
        ));
    }

    if (!options?.insertIfMissing) return conversations;

    return [freshConversation as T, ...conversations];
}

export function resolvePostMergeActiveConversationId(targetConversationId?: string | null): string | null {
    const normalizedTargetConversationId = targetConversationId ? String(targetConversationId).trim() : "";
    return normalizedTargetConversationId || null;
}
