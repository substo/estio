export type CorrelatableMessage = {
    id?: string | null;
    clientMessageId?: string | null;
    wamId?: string | null;
    dateAdded?: string | null;
    direction?: string | null;
    status?: string | null;
    sendState?: string | null;
    outboxState?: {
        status?: string | null;
    } | null;
    attachments?: unknown;
};

function normalizeValue(value: unknown): string {
    const normalized = String(value || "").trim();
    return normalized;
}

export function buildMessageCorrelationKeys(message: CorrelatableMessage): string[] {
    const keys: string[] = [];
    const id = normalizeValue(message.id);
    const clientMessageId = normalizeValue(message.clientMessageId);
    const wamId = normalizeValue(message.wamId);

    if (id) keys.push(`id:${id}`);
    if (clientMessageId) keys.push(`client:${clientMessageId}`);
    if (wamId) keys.push(`wam:${wamId}`);

    return keys;
}

export function matchesByCorrelation(
    message: CorrelatableMessage,
    reference: { messageId?: string | null; clientMessageId?: string | null; wamId?: string | null }
): boolean {
    const messageKeys = new Set(buildMessageCorrelationKeys(message));
    const referenceKeys = [
        normalizeValue(reference.messageId) ? `id:${normalizeValue(reference.messageId)}` : "",
        normalizeValue(reference.clientMessageId) ? `client:${normalizeValue(reference.clientMessageId)}` : "",
        normalizeValue(reference.wamId) ? `wam:${normalizeValue(reference.wamId)}` : "",
    ].filter(Boolean);

    if (referenceKeys.length === 0) return false;
    return referenceKeys.some((key) => messageKeys.has(key));
}

function resolveSortTimestampMs(message: CorrelatableMessage): number {
    const parsed = Date.parse(String(message.dateAdded || ""));
    if (!Number.isFinite(parsed)) return 0;
    return parsed;
}

function dedupeByCorrelation<T extends CorrelatableMessage>(messages: T[]): T[] {
    const seen = new Set<string>();
    const output: T[] = [];

    for (const message of messages) {
        const keys = buildMessageCorrelationKeys(message);
        const dedupeKey = keys[0] || `fallback:${output.length}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        output.push(message);
    }

    return output;
}

export function mergeSnapshotWithPendingMessages<T extends CorrelatableMessage>(
    snapshotMessages: T[],
    pendingMessages: T[]
): T[] {
    const merged: T[] = dedupeByCorrelation(Array.isArray(snapshotMessages) ? snapshotMessages : []);

    for (const pending of Array.isArray(pendingMessages) ? pendingMessages : []) {
        const pendingKeys = new Set(buildMessageCorrelationKeys(pending));
        if (pendingKeys.size === 0) continue;

        const existingIndex = merged.findIndex((item) => {
            const itemKeys = buildMessageCorrelationKeys(item);
            return itemKeys.some((key) => pendingKeys.has(key));
        });

        if (existingIndex >= 0) {
            const existing = merged[existingIndex];
            const mergedMessage: T = {
                ...pending,
                ...existing,
            } as T;
            if (!Array.isArray((existing as any).attachments) && Array.isArray((pending as any).attachments)) {
                mergedMessage.attachments = (pending as any).attachments;
            }
            merged[existingIndex] = mergedMessage;
        } else {
            merged.push(pending);
        }
    }

    return dedupeByCorrelation(merged)
        .sort((left, right) => {
            const leftTs = resolveSortTimestampMs(left);
            const rightTs = resolveSortTimestampMs(right);
            if (leftTs !== rightTs) return leftTs - rightTs;
            return normalizeValue(left.id).localeCompare(normalizeValue(right.id));
        });
}

export function isPendingOutboundMessage(message: CorrelatableMessage): boolean {
    if (normalizeValue(message.direction).toLowerCase() !== "outbound") return false;

    const status = normalizeValue(message.status).toLowerCase();
    const sendState = normalizeValue(message.sendState).toLowerCase();
    const outboxState = normalizeValue(message.outboxState?.status).toLowerCase();

    if (status === "failed") return false;
    if (["pending", "processing", "failed"].includes(outboxState)) return true;
    if (["queued", "sending", "retrying"].includes(sendState)) return true;
    return status === "sending";
}
