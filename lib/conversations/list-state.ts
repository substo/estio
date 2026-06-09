type ConversationListItem = {
    id?: string | null;
    lastMessageDate?: number | null;
    unreadCount?: number | null;
};

export type ConversationReadResetGuard = ReadonlySet<string> | ReadonlyMap<string, number>;

export type ConversationListPageInfo = {
    hasMore: boolean;
    nextCursor: string | null;
    deltaCursor?: string | null;
};

export type ConversationListResponseState<T extends ConversationListItem> = {
    conversations: T[];
    pageInfo: ConversationListPageInfo;
};

export type ConversationDeltaListState<T extends ConversationListItem> = {
    conversations: T[];
    deltaCursor?: string | null;
};

type ConversationListResponseLike = {
    conversations?: unknown;
    hasMore?: unknown;
    nextCursor?: unknown;
    deltaCursor?: unknown;
};

type ConversationDeltaPayloadLike = {
    deltas?: unknown;
    cursor?: unknown;
};

export function mergeConversationLists<T extends ConversationListItem>(existing: T[], incoming: T[]): T[] {
    const seen = new Set<string>();
    const merged: T[] = [];
    for (const item of [...existing, ...incoming]) {
        if (!item?.id || seen.has(item.id)) continue;
        seen.add(item.id);
        merged.push(item);
    }
    return merged;
}

export function mergeConversationListsWithIncomingFirst<T extends ConversationListItem>(existing: T[], incoming: T[]): T[] {
    const seen = new Set<string>();
    const merged: T[] = [];
    for (const item of [...incoming, ...existing]) {
        if (!item?.id || seen.has(item.id)) continue;
        seen.add(item.id);
        merged.push(item);
    }
    return merged;
}

export function normalizeFetchedConversations<T extends ConversationListItem>(
    conversations: unknown,
    readResetGuard: ConversationReadResetGuard
): T[] {
    if (!Array.isArray(conversations)) return [];
    return conversations.map((conversation: T) => preserveOptimisticUnreadReset(conversation, readResetGuard));
}

export function deriveConversationListPageInfo(data: ConversationListResponseLike): ConversationListPageInfo {
    const pageInfo: ConversationListPageInfo = {
        hasMore: !!data?.hasMore,
        nextCursor: typeof data?.nextCursor === "string" ? data.nextCursor : null,
    };

    if (typeof data?.deltaCursor === "string" || data?.deltaCursor === null) {
        pageInfo.deltaCursor = data?.deltaCursor || null;
    }

    return pageInfo;
}

export function replaceConversationListFromResponse<T extends ConversationListItem>(
    data: ConversationListResponseLike,
    readResetGuard: ConversationReadResetGuard
): ConversationListResponseState<T> {
    return {
        conversations: normalizeFetchedConversations<T>(data?.conversations, readResetGuard),
        pageInfo: deriveConversationListPageInfo(data),
    };
}

export function appendConversationPageFromResponse<T extends ConversationListItem>(
    existing: T[],
    data: ConversationListResponseLike,
    readResetGuard: ConversationReadResetGuard
): ConversationListResponseState<T> {
    return {
        conversations: mergeConversationLists(
            existing,
            normalizeFetchedConversations<T>(data?.conversations, readResetGuard)
        ),
        pageInfo: deriveConversationListPageInfo(data),
    };
}

export function applyConversationDeltaPayload<T extends ConversationListItem>(
    existing: T[],
    deltaPayload: ConversationDeltaPayloadLike,
    readResetGuard: ConversationReadResetGuard
): ConversationDeltaListState<T> {
    const deltas = Array.isArray(deltaPayload?.deltas) ? deltaPayload.deltas : [];
    const cursor = deriveConversationDeltaCursor(deltaPayload);

    if (deltas.length === 0) {
        return {
            conversations: existing,
            ...(cursor.shouldUpdate ? { deltaCursor: cursor.value } : {}),
        };
    }

    const incoming = deltas
        .filter((item: any) => !!item?.matchesFilter && !!item?.conversation)
        .map((item: any) => preserveOptimisticUnreadReset({ ...item.conversation } as T, readResetGuard));
    const removedIds = new Set(
        deltas
            .filter((item: any) => item && item.matchesFilter === false && item.id)
            .map((item: any) => item.id)
    );

    const withoutRemoved = removedIds.size > 0
        ? existing.filter((conversation) => !removedIds.has(conversation.id))
        : existing;

    return {
        conversations: incoming.length === 0
            ? withoutRemoved
            : mergeConversationListsWithIncomingFirst(withoutRemoved, incoming),
        ...(cursor.shouldUpdate ? { deltaCursor: cursor.value } : {}),
    };
}

function preserveOptimisticUnreadReset<T extends ConversationListItem>(
    conversation: T,
    readResetGuard: ConversationReadResetGuard
): T {
    if (!conversation.id) return conversation;

    if (readResetGuard instanceof Map) {
        const resetLastMessageDate = readResetGuard.get(conversation.id);
        if (
            typeof resetLastMessageDate === "number"
            && Number(conversation.unreadCount || 0) > 0
            && Number(conversation.lastMessageDate || 0) <= resetLastMessageDate
        ) {
            return { ...conversation, unreadCount: 0 };
        }
        return conversation;
    }

    if (readResetGuard.has(conversation.id)) {
        return { ...conversation, unreadCount: 0 };
    }
    return conversation;
}

function deriveConversationDeltaCursor(deltaPayload: ConversationDeltaPayloadLike): {
    shouldUpdate: boolean;
    value: string | null;
} {
    if (typeof deltaPayload?.cursor === "string" || deltaPayload?.cursor === null) {
        return { shouldUpdate: true, value: deltaPayload?.cursor || null };
    }
    return { shouldUpdate: false, value: null };
}
