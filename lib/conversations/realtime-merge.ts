export type RealtimeEventMergeState = {
    seenEventIds: Set<string>;
    lastTsByConversationId: Record<string, number>;
};

export type RealtimeEnvelopeIdentity = {
    id?: string | null;
    conversationId?: string | null;
    ts?: string | null;
};

export type RealtimeMergeOptions = {
    maxTrackedEventIds?: number;
};

export function shouldApplyRealtimeEnvelope(
    state: RealtimeEventMergeState,
    envelope: RealtimeEnvelopeIdentity,
    options?: RealtimeMergeOptions
): boolean {
    const maxTrackedEventIds = Math.min(
        Math.max(Number(options?.maxTrackedEventIds || 1000), 1),
        10_000
    );

    const envelopeId = envelope.id ? String(envelope.id) : "";
    if (envelopeId) {
        if (state.seenEventIds.has(envelopeId)) {
            return false;
        }
        state.seenEventIds.add(envelopeId);
        if (state.seenEventIds.size > maxTrackedEventIds) {
            const oldest = state.seenEventIds.values().next().value;
            if (oldest) state.seenEventIds.delete(oldest);
        }
    }

    const conversationId = envelope.conversationId ? String(envelope.conversationId) : "";
    const eventTsMs = Number(new Date(envelope.ts || 0).getTime());
    if (conversationId && Number.isFinite(eventTsMs) && eventTsMs > 0) {
        const previousTsMs = state.lastTsByConversationId[conversationId] || 0;
        if (eventTsMs < previousTsMs) {
            return false;
        }
        state.lastTsByConversationId[conversationId] = eventTsMs;
    }

    return true;
}
