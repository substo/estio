import type { Conversation } from '@/lib/ghl/conversations';

function toConversationIdSet(ids: string[]): Set<string> {
    return new Set(ids);
}

export function collectConversationsByIds(
    conversations: Conversation[],
    ids: string[]
): Conversation[] {
    const idSet = toConversationIdSet(ids);
    return conversations.filter((conversation) => idSet.has(conversation.id));
}

export function removeConversationsByIds(
    conversations: Conversation[],
    ids: string[]
): Conversation[] {
    const idSet = toConversationIdSet(ids);
    return conversations.filter((conversation) => !idSet.has(conversation.id));
}

export function shouldExitSelectionModeAfterBulkAction(
    ids: string[],
    conversations: Conversation[]
): boolean {
    return ids.length === conversations.length;
}

export function shouldClearActiveConversation(
    activeId: string | null,
    ids: string[]
): boolean {
    return !!activeId && toConversationIdSet(ids).has(activeId);
}

export function toggleConversationSelection(
    selectedIds: Set<string>,
    id: string,
    checked: boolean
): Set<string> {
    const next = new Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    return next;
}

export function applyVisibleConversationSelection(
    selectedIds: Set<string>,
    visibleIds: string[],
    select: boolean
): Set<string> {
    if (select) {
        return new Set([...Array.from(selectedIds), ...visibleIds]);
    }

    const next = new Set(selectedIds);
    visibleIds.forEach((id) => next.delete(id));
    return next;
}

export function resolveSelectedConversations(
    selectedIds: Set<string>,
    cache: Map<string, Conversation>,
    conversations: Conversation[]
): Conversation[] {
    return Array.from(selectedIds)
        .map((id) => cache.get(id) || conversations.find((conversation) => conversation.id === id))
        .filter((conversation): conversation is Conversation => !!conversation);
}
