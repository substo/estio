'use client';

import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Message } from '@/lib/ghl/conversations';
import {
    shouldApplyRealtimeEnvelope,
    type RealtimeEventMergeState,
} from '@/lib/conversations/realtime-merge';
import { ACTIVE_DEAL_REFRESH_EVENT_LIMIT } from './use-deal-workspace-refresh-orchestration';
import type { ActivityTimelineItem } from './conversation-workspace-ui-actions';

export type ConversationRealtimeMode = 'disabled' | 'connecting' | 'connected' | 'fallback';

type ViewMode = 'chats' | 'deals';

type RealtimeEnvelopeRoutingArgs = {
    rawData: string;
    viewMode: ViewMode;
    activeIdRef: RefObject<string | null>;
    activeDealIdRef: RefObject<string | null>;
    mergeState: RealtimeEventMergeState;
    setMessages: Dispatch<SetStateAction<Message[]>>;
    runRealtimeRefresh: (conversationId?: string | null) => void;
    refreshActiveDealWorkspace: (dealId: string, options?: {
        reason?: string;
        take?: number;
        refreshSidebar?: boolean;
        hydrationSkipLogKind?: string;
    }) => Promise<any>;
    applyRealtimeMessagePatch: (conversationId: string | null | undefined, payload: Record<string, unknown>) => boolean;
    upsertActivityEntryInWorkspace: (conversationId: string | null | undefined, activityEntry: ActivityTimelineItem | null | undefined) => void;
    prefetchWorkspaceCore: (conversationId: string) => Promise<void>;
    getCachedWorkspaceCoreSnapshot: (conversationId: string) => any | null;
    cacheWorkspaceCoreSnapshot: (conversationId: string, snapshot: any) => void;
    workspaceCoreInFlightRef: RefObject<Set<string>>;
};

type UseConversationRealtimeEventsArgs = Omit<RealtimeEnvelopeRoutingArgs, 'rawData' | 'mergeState'> & {
    featureRealtimeSse: boolean;
    isTabVisible: boolean;
    searchQuery: string;
    viewFilter: 'active' | 'archived' | 'trash' | 'tasks';
    activeDealId: string | null;
    setRealtimeMode: Dispatch<SetStateAction<ConversationRealtimeMode>>;
};

function parseRealtimePayload(event: any): Record<string, unknown> {
    return event?.payload && typeof event.payload === "object"
        ? event.payload as Record<string, unknown>
        : {};
}

export function routeConversationRealtimeEnvelope({
    rawData,
    viewMode,
    activeIdRef,
    activeDealIdRef,
    mergeState,
    setMessages,
    runRealtimeRefresh,
    refreshActiveDealWorkspace,
    applyRealtimeMessagePatch,
    upsertActivityEntryInWorkspace,
    prefetchWorkspaceCore,
    getCachedWorkspaceCoreSnapshot,
    cacheWorkspaceCoreSnapshot,
    workspaceCoreInFlightRef,
}: RealtimeEnvelopeRoutingArgs): void {
    const event = JSON.parse(rawData || "{}");
    const conversationId = event?.conversationId ? String(event.conversationId) : null;
    const eventType = String(event?.type || "");
    const shouldApply = shouldApplyRealtimeEnvelope(
        mergeState,
        {
            id: event?.id ? String(event.id) : null,
            conversationId,
            ts: event?.ts ? String(event.ts) : null,
        },
        { maxTrackedEventIds: 1000 }
    );
    if (!shouldApply) return;

    if (viewMode === 'deals') {
        const payloadDealId = String(event?.payload?.dealId || "").trim();
        if (eventType === "deal.update" && payloadDealId && payloadDealId === activeDealIdRef.current) {
            void refreshActiveDealWorkspace(payloadDealId, {
                reason: "realtime",
                take: ACTIVE_DEAL_REFRESH_EVENT_LIMIT,
                refreshSidebar: true,
                hydrationSkipLogKind: "deal_realtime_refresh_skipped_hydration",
            });
        }
        return;
    }

    if (viewMode === "chats" && conversationId && (eventType === "message.status" || eventType === "message.outbound")) {
        const patched = applyRealtimeMessagePatch(conversationId, parseRealtimePayload(event));
        if (patched) return;

        // Fallback consistency repair for unknown message ids.
        runRealtimeRefresh(conversationId);
        return;
    }

    if (viewMode === "chats" && conversationId && eventType === "activity.created") {
        const payload = parseRealtimePayload(event);
        const activityEntry = payload?.activityEntry && typeof payload.activityEntry === "object"
            ? payload.activityEntry as ActivityTimelineItem
            : null;

        if (activityEntry?.id) {
            upsertActivityEntryInWorkspace(conversationId, activityEntry);
            return;
        }

        runRealtimeRefresh(conversationId);
        return;
    }

    if (viewMode === "chats" && conversationId && eventType === "message.inbound") {
        const payload = parseRealtimePayload(event);
        const messageId = String(payload?.messageId || "").trim();
        const body = String(payload?.body ?? "");
        const createdAt = String(payload?.createdAt || new Date().toISOString());
        const wamId = String(payload?.wamId || "");

        if (conversationId === activeIdRef.current && messageId) {
            const optimisticMessage: Message = {
                id: messageId,
                wamId: wamId || undefined,
                clientMessageId: String(payload?.clientMessageId || "") || undefined,
                conversationId: "",
                contactId: "",
                body,
                type: "WhatsApp",
                direction: "inbound" as const,
                status: "received",
                sendState: "sent",
                dateAdded: createdAt,
                attachments: [],
            } as Message;

            setMessages((prev) => {
                if (prev.some((m) => m.id === messageId || (wamId && (m as any).wamId === wamId))) {
                    return prev;
                }
                return [...prev, optimisticMessage];
            });

            const cached = getCachedWorkspaceCoreSnapshot(conversationId);
            if (cached) {
                const cachedMessages = Array.isArray(cached.messages) ? cached.messages : [];
                const alreadyInCache = cachedMessages.some(
                    (m: Message) => m.id === messageId || (wamId && (m as any).wamId === wamId)
                );
                if (!alreadyInCache) {
                    cacheWorkspaceCoreSnapshot(conversationId, {
                        ...cached,
                        messages: [...cachedMessages, optimisticMessage],
                    });
                }
            }

            runRealtimeRefresh(conversationId);
            return;
        }

        const existingCache = getCachedWorkspaceCoreSnapshot(conversationId);
        if (existingCache) {
            workspaceCoreInFlightRef.current.delete(conversationId);
        }
        void prefetchWorkspaceCore(conversationId);
        runRealtimeRefresh(conversationId);
        return;
    }

    runRealtimeRefresh(conversationId);
}

export function useConversationRealtimeEvents({
    featureRealtimeSse,
    isTabVisible,
    searchQuery,
    viewFilter,
    activeDealId,
    viewMode,
    activeIdRef,
    activeDealIdRef,
    workspaceCoreInFlightRef,
    setMessages,
    setRealtimeMode,
    runRealtimeRefresh,
    refreshActiveDealWorkspace,
    applyRealtimeMessagePatch,
    upsertActivityEntryInWorkspace,
    prefetchWorkspaceCore,
    getCachedWorkspaceCoreSnapshot,
    cacheWorkspaceCoreSnapshot,
}: UseConversationRealtimeEventsArgs) {
    const realtimeEventIdsRef = useRef<Set<string>>(new Set());
    const realtimeEventLastTsByConversationRef = useRef<Record<string, number>>({});

    useEffect(() => {
        setRealtimeMode(featureRealtimeSse ? 'connecting' : 'disabled');
    }, [featureRealtimeSse, setRealtimeMode]);

    useEffect(() => {
        if (!featureRealtimeSse) {
            setRealtimeMode('disabled');
            return;
        }

        const shouldDisableRealtime = (
            !isTabVisible
            || (viewMode === 'chats' && searchQuery.trim().length > 0)
            || (viewMode === 'chats' && viewFilter === 'tasks')
            || (viewMode !== 'chats' && viewMode !== 'deals')
        );

        if (shouldDisableRealtime) {
            setRealtimeMode('fallback');
            return;
        }

        let closed = false;
        let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
        let eventSource: EventSource | null = null;

        const clearFallbackTimer = () => {
            if (fallbackTimer) {
                clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }
        };

        const scheduleFallback = () => {
            clearFallbackTimer();
            fallbackTimer = setTimeout(() => {
                if (closed) return;
                setRealtimeMode('fallback');
            }, 10_000);
        };

        const handleIncomingEnvelope = (rawData: string) => {
            try {
                routeConversationRealtimeEnvelope({
                    rawData,
                    viewMode,
                    activeIdRef,
                    activeDealIdRef,
                    mergeState: {
                        seenEventIds: realtimeEventIdsRef.current,
                        lastTsByConversationId: realtimeEventLastTsByConversationRef.current,
                    },
                    setMessages,
                    runRealtimeRefresh,
                    refreshActiveDealWorkspace,
                    applyRealtimeMessagePatch,
                    upsertActivityEntryInWorkspace,
                    prefetchWorkspaceCore,
                    getCachedWorkspaceCoreSnapshot,
                    cacheWorkspaceCoreSnapshot,
                    workspaceCoreInFlightRef,
                });
            } catch (error) {
                console.error("Failed to parse realtime conversation event:", error);
            }
        };

        setRealtimeMode('connecting');
        eventSource = new EventSource('/api/conversations/events');
        eventSource.onopen = () => {
            if (closed) return;
            clearFallbackTimer();
            setRealtimeMode('connected');
            if (viewMode === 'deals') {
                if (activeDealIdRef.current) {
                    void refreshActiveDealWorkspace(activeDealIdRef.current, {
                        reason: "reconnect",
                        take: ACTIVE_DEAL_REFRESH_EVENT_LIMIT,
                        refreshSidebar: true,
                        hydrationSkipLogKind: "deal_realtime_refresh_skipped_hydration",
                    });
                }
                return;
            }
            runRealtimeRefresh(activeIdRef.current);
        };
        eventSource.addEventListener('conversation', (evt) => {
            if (closed) return;
            handleIncomingEnvelope((evt as MessageEvent).data);
        });
        eventSource.onmessage = (evt) => {
            if (closed) return;
            handleIncomingEnvelope(evt.data);
        };
        eventSource.onerror = () => {
            if (closed) return;
            setRealtimeMode('connecting');
            scheduleFallback();
        };

        return () => {
            closed = true;
            clearFallbackTimer();
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
        };
    }, [
        activeDealIdRef,
        activeDealId,
        activeIdRef,
        applyRealtimeMessagePatch,
        cacheWorkspaceCoreSnapshot,
        searchQuery,
        featureRealtimeSse,
        getCachedWorkspaceCoreSnapshot,
        isTabVisible,
        prefetchWorkspaceCore,
        refreshActiveDealWorkspace,
        runRealtimeRefresh,
        setMessages,
        setRealtimeMode,
        upsertActivityEntryInWorkspace,
        viewFilter,
        viewMode,
        workspaceCoreInFlightRef,
    ]);
}
