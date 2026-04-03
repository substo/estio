export type ViewingTranscriptMessageLike = {
    id: string;
    utteranceId?: string | null;
    supersedesMessageId?: string | null;
    timestamp?: string | Date | null;
    createdAt?: string | Date | null;
};

function asDateValue(value: string | Date | null | undefined): number {
    if (!value) return 0;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

export function createSupersededMessageIdSet(messages: ViewingTranscriptMessageLike[]): Set<string> {
    const superseded = new Set<string>();
    for (const message of messages) {
        const target = String(message.supersedesMessageId || "").trim();
        if (target) superseded.add(target);
    }
    return superseded;
}

export function sortViewingTranscriptMessages<T extends ViewingTranscriptMessageLike>(messages: T[]): T[] {
    return [...messages].sort((a, b) => {
        const byTimestamp = asDateValue(a.timestamp || a.createdAt) - asDateValue(b.timestamp || b.createdAt);
        if (byTimestamp !== 0) return byTimestamp;
        return String(a.id).localeCompare(String(b.id));
    });
}

export function selectEffectiveViewingTranscriptMessages<T extends ViewingTranscriptMessageLike>(messages: T[]): T[] {
    const supersededIds = createSupersededMessageIdSet(messages);
    return sortViewingTranscriptMessages(messages).filter((message) => !supersededIds.has(message.id));
}

export function selectViewingTranscriptRevisionHistory<T extends ViewingTranscriptMessageLike>(
    messages: T[],
    rootMessageId: string
): T[] {
    const bySupersedes = new Map<string, T[]>();
    for (const message of messages) {
        const key = String(message.supersedesMessageId || "").trim();
        if (!key) continue;
        if (!bySupersedes.has(key)) bySupersedes.set(key, []);
        bySupersedes.get(key)!.push(message);
    }

    const history: T[] = [];
    const queue: string[] = [String(rootMessageId || "").trim()].filter(Boolean);
    const visited = new Set<string>();
    while (queue.length > 0) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const revisions = bySupersedes.get(id) || [];
        for (const revision of revisions) {
            history.push(revision);
            queue.push(revision.id);
        }
    }

    return sortViewingTranscriptMessages(history);
}

export function selectViewingTranscriptUtteranceMessages<T extends ViewingTranscriptMessageLike>(
    messages: T[],
    utteranceId: string
): T[] {
    const normalizedUtteranceId = String(utteranceId || "").trim();
    if (!normalizedUtteranceId) return [];
    return sortViewingTranscriptMessages(
        messages.filter((message) => String(message.utteranceId || "").trim() === normalizedUtteranceId)
    );
}

export function selectEffectiveViewingTranscriptMessageForUtterance<T extends ViewingTranscriptMessageLike>(
    messages: T[],
    utteranceId: string
): T | null {
    const lineage = selectViewingTranscriptUtteranceMessages(messages, utteranceId);
    if (lineage.length === 0) return null;

    const supersededIds = createSupersededMessageIdSet(lineage);
    const effective = lineage.filter((message) => !supersededIds.has(message.id));
    return effective[effective.length - 1] || lineage[lineage.length - 1] || null;
}
