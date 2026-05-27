'use client';

export async function fetchConversationMessageWindow(
    conversationId: string,
    args: {
        take: number;
        signal?: AbortSignal;
    }
) {
    const url = `/api/admin/conversations/${encodeURIComponent(conversationId)}/message-window?take=${encodeURIComponent(String(args.take))}`;
    const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: args.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || `Failed to load message window (${response.status})`);
    }
    return payload;
}
