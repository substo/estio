type CacheEnvelope<T> = {
    value: T;
    expiresAt: number | null;
};

function isCacheEnvelope<T>(entry: T | CacheEnvelope<T> | undefined): entry is CacheEnvelope<T> {
    return !!entry
        && typeof entry === "object"
        && "value" in entry
        && "expiresAt" in entry;
}

export function setWorkspaceCoreCacheEntry<T>(
    cache: Map<string, T | CacheEnvelope<T>>,
    conversationId: string,
    snapshot: T,
    limit: number,
    ttlMs?: number | null
): void {
    if (cache.has(conversationId)) {
        cache.delete(conversationId);
    }
    const normalizedTtlMs = Number(ttlMs);
    const expiresAt = Number.isFinite(normalizedTtlMs) && normalizedTtlMs > 0
        ? Date.now() + normalizedTtlMs
        : null;
    cache.set(conversationId, { value: snapshot, expiresAt });

    const normalizedLimit = Math.max(1, Math.floor(Number(limit) || 1));
    while (cache.size > normalizedLimit) {
        const oldest = cache.keys().next().value;
        if (!oldest) break;
        cache.delete(oldest);
    }
}

export function getWorkspaceCoreCacheEntry<T>(
    cache: Map<string, T | CacheEnvelope<T>>,
    conversationId: string
): T | null {
    const cached = cache.get(conversationId);
    if (!cached) return null;

    if (isCacheEnvelope<T>(cached)) {
        if (cached.expiresAt !== null && cached.expiresAt <= Date.now()) {
            cache.delete(conversationId);
            return null;
        }
        cache.delete(conversationId);
        cache.set(conversationId, cached);
        return cached.value;
    }

    cache.delete(conversationId);
    cache.set(conversationId, cached);
    return cached;
}
