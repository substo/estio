export function setWorkspaceCoreCacheEntry<T>(
    cache: Map<string, T>,
    conversationId: string,
    snapshot: T,
    limit: number
): void {
    if (cache.has(conversationId)) {
        cache.delete(conversationId);
    }
    cache.set(conversationId, snapshot);

    const normalizedLimit = Math.max(1, Math.floor(Number(limit) || 1));
    while (cache.size > normalizedLimit) {
        const oldest = cache.keys().next().value;
        if (!oldest) break;
        cache.delete(oldest);
    }
}

export function getWorkspaceCoreCacheEntry<T>(
    cache: Map<string, T>,
    conversationId: string
): T | null {
    const cached = cache.get(conversationId);
    if (!cached) return null;
    cache.delete(conversationId);
    cache.set(conversationId, cached);
    return cached;
}
