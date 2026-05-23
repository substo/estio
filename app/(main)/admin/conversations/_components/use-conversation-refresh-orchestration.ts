'use client';

import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Conversation, Message } from '@/lib/ghl/conversations';
import type { ConversationFeatureFlags } from '@/lib/feature-flags';
import {
    createWorkspaceCoreSnapshot,
    createWorkspaceHydrationState,
    type WorkspaceCoreSnapshot,
} from '@/lib/conversations/workspace-state';
import {
    fetchConversationActivityLog,
    fetchConversations,
    fetchMessages,
    getConversationListDelta,
    getConversationWorkspaceCore,
    refreshConversation,
} from '../actions';
import { THREAD_TARGET_MESSAGE_COUNT } from '@/lib/conversations/thread-hydration';
import { hasPendingTranscripts, getMessageSignature } from './conversation-transcript-actions';

const ACTIVE_POLL_GRACE_MS = 2500;

export type ConversationRealtimeMode = 'disabled' | 'connecting' | 'connected' | 'fallback';

type UseConversationRefreshOrchestrationArgs = {
    viewMode: 'chats' | 'deals';
    viewFilter: 'active' | 'archived' | 'trash' | 'tasks';
    activeId: string | null;
    searchQuery: string;
    isTabVisible: boolean;
    featureFlags: ConversationFeatureFlags;
    realtimeMode: ConversationRealtimeMode;
    activeIdRef: RefObject<string | null>;
    messagesRef: RefObject<Message[]>;
    messageSignatureRef: RefObject<string>;
    conversationDeltaCursorRef: RefObject<string | null>;
    workspaceMessageMetadataInFlightRef: RefObject<Set<string>>;
    initialWorkspaceLoadedAtRef: RefObject<Record<string, number>>;
    realtimeRefreshTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
    setMessages: Dispatch<SetStateAction<Message[]>>;
    setActivityLog: Dispatch<SetStateAction<any[]>>;
    setConversations: Dispatch<SetStateAction<Conversation[]>>;
    applyConversationDeltaPayload: (deltaPayload: any) => void;
    replaceConversationListFromResponse: (data: any) => void;
    applyWorkspaceCoreSnapshot: (conversationId: string, snapshot: WorkspaceCoreSnapshot) => void;
    cacheWorkspaceCoreSnapshot: (conversationId: string, snapshot: WorkspaceCoreSnapshot) => void;
    isWorkspaceHydrationBusy: (conversationId?: string | null) => boolean;
    markConversationReadInUi: (conversationId: string) => void;
    trackClientRequest: (kind: string, metadata?: Record<string, unknown>) => void;
    workspaceActivityLimit: number;
};

export function useConversationRefreshOrchestration({
    viewMode,
    viewFilter,
    activeId,
    searchQuery,
    isTabVisible,
    featureFlags,
    realtimeMode,
    activeIdRef,
    messagesRef,
    messageSignatureRef,
    conversationDeltaCursorRef,
    workspaceMessageMetadataInFlightRef,
    initialWorkspaceLoadedAtRef,
    realtimeRefreshTimerRef,
    setMessages,
    setActivityLog,
    setConversations,
    applyConversationDeltaPayload,
    replaceConversationListFromResponse,
    applyWorkspaceCoreSnapshot,
    cacheWorkspaceCoreSnapshot,
    isWorkspaceHydrationBusy,
    markConversationReadInUi,
    trackClientRequest,
    workspaceActivityLimit,
}: UseConversationRefreshOrchestrationArgs) {
    const workspaceCoreRefreshInFlightRef = useRef<Map<string, Promise<void>>>(new Map());

    const refreshActiveWorkspaceCore = useCallback((
        conversationId: string,
        args: {
            logKind: string;
            pendingTranscripts?: boolean;
            shouldApply?: () => boolean;
        }
    ) => {
        const targetConversationId = String(conversationId || "").trim();
        if (!targetConversationId || targetConversationId !== activeIdRef.current) {
            return Promise.resolve();
        }

        if (isWorkspaceHydrationBusy(targetConversationId)) {
            trackClientRequest(`${args.logKind}_skipped_hydration`, {
                conversationId: targetConversationId,
                reason: workspaceMessageMetadataInFlightRef.current.has(targetConversationId) ? "message_metadata" : "workspace_hydration",
            });
            return Promise.resolve();
        }

        const existingRefresh = workspaceCoreRefreshInFlightRef.current.get(targetConversationId);
        if (existingRefresh) {
            trackClientRequest(`${args.logKind}_skipped_hydration`, {
                conversationId: targetConversationId,
                reason: "workspace_refresh_inflight",
            });
            return existingRefresh;
        }

        trackClientRequest(args.logKind, {
            conversationId: targetConversationId,
            ...(typeof args.pendingTranscripts === "boolean" ? { pendingTranscripts: args.pendingTranscripts } : {}),
        });

        const refreshPromise = (async () => {
            const workspace = await getConversationWorkspaceCore(targetConversationId, {
                includeMessages: true,
                includeActivity: true,
                messageLimit: THREAD_TARGET_MESSAGE_COUNT,
                activityLimit: workspaceActivityLimit,
            });
            if (!workspace?.success || activeIdRef.current !== targetConversationId || args.shouldApply?.() === false) return;

            const workspaceMessages = Array.isArray(workspace?.messages) ? workspace.messages : [];
            const snapshot = createWorkspaceCoreSnapshot({
                conversationHeader: workspace?.conversationHeader || null,
                messages: workspaceMessages,
                activityTimeline: Array.isArray(workspace?.activityTimeline) ? workspace.activityTimeline : [],
                transcriptEligibility: workspace?.transcriptEligibility,
                hydration: createWorkspaceHydrationState({
                    status: 'full',
                    messages: workspaceMessages,
                    messageWindow: workspace?.messageWindow,
                    initialCount: workspaceMessages.length,
                    targetCount: THREAD_TARGET_MESSAGE_COUNT,
                    requestedLimit: THREAD_TARGET_MESSAGE_COUNT,
                }),
            });
            cacheWorkspaceCoreSnapshot(targetConversationId, snapshot);
            applyWorkspaceCoreSnapshot(targetConversationId, snapshot);
            initialWorkspaceLoadedAtRef.current[targetConversationId] = Date.now();

            if ((workspace?.conversationHeader?.unreadCount || 0) > 0) {
                void markConversationReadInUi(targetConversationId);
            }
        })();

        workspaceCoreRefreshInFlightRef.current.set(targetConversationId, refreshPromise);
        void refreshPromise.finally(() => {
            if (workspaceCoreRefreshInFlightRef.current.get(targetConversationId) === refreshPromise) {
                workspaceCoreRefreshInFlightRef.current.delete(targetConversationId);
            }
        }).catch(() => undefined);

        return refreshPromise;
    }, [
        activeIdRef,
        applyWorkspaceCoreSnapshot,
        cacheWorkspaceCoreSnapshot,
        initialWorkspaceLoadedAtRef,
        isWorkspaceHydrationBusy,
        markConversationReadInUi,
        trackClientRequest,
        workspaceActivityLimit,
        workspaceMessageMetadataInFlightRef,
    ]);

    const runRealtimeRefresh = useCallback((conversationId?: string | null) => {
        if (realtimeRefreshTimerRef.current) return;
        realtimeRefreshTimerRef.current = setTimeout(async () => {
            realtimeRefreshTimerRef.current = null;
            if (viewMode !== 'chats' || viewFilter === 'tasks') return;
            if (!isTabVisible) return;
            if (searchQuery.trim()) return;

            try {
                const selectedConversationId = activeIdRef.current || undefined;
                const delta = await getConversationListDelta(
                    viewFilter,
                    conversationDeltaCursorRef.current,
                    selectedConversationId
                );
                if (delta?.success) {
                    applyConversationDeltaPayload(delta);
                }

                const targetConversationId = String(conversationId || "").trim();
                if (targetConversationId && targetConversationId === activeIdRef.current) {
                    await refreshActiveWorkspaceCore(targetConversationId, {
                        logKind: "realtime_refresh",
                    });
                }
            } catch (error) {
                console.error("Realtime refresh failed:", error);
            }
        }, 250);
    }, [
        activeIdRef,
        applyConversationDeltaPayload,
        conversationDeltaCursorRef,
        isTabVisible,
        refreshActiveWorkspaceCore,
        realtimeRefreshTimerRef,
        searchQuery,
        viewFilter,
        viewMode,
    ]);

    useEffect(() => {
        if (viewMode !== 'chats' || viewFilter === 'tasks') return;
        if (!isTabVisible) return;
        if (searchQuery.trim()) return;
        if (featureFlags.realtimeSse && realtimeMode !== 'fallback') return;

        let cancelled = false;
        const intervalMs = featureFlags.balancedPolling ? 15_000 : 3_000;

        const runListDeltaSync = async () => {
            try {
                const selectedConversationId = activeIdRef.current || undefined;
                if (!featureFlags.workspaceV2) {
                    trackClientRequest("legacy_list_poll", { viewFilter });
                    const snapshot = await fetchConversations(viewFilter, selectedConversationId);
                    if (cancelled) return;
                    replaceConversationListFromResponse(snapshot);
                    return;
                }

                trackClientRequest("list_delta_poll", { viewFilter });
                const delta = await getConversationListDelta(
                    viewFilter,
                    conversationDeltaCursorRef.current,
                    selectedConversationId
                );
                if (cancelled || !delta?.success) return;
                applyConversationDeltaPayload(delta);

                if (selectedConversationId && Array.isArray(delta?.deltas)) {
                    const activeDelta = delta.deltas.find((item: any) => item?.id === selectedConversationId);
                    if (activeDelta && Number(activeDelta.unreadCount || 0) > 0) {
                        void markConversationReadInUi(selectedConversationId);
                    }
                }
            } catch (err) {
                if (!cancelled) {
                    console.error("List delta sync failed:", err);
                }
            }
        };

        runListDeltaSync();
        const intervalId = setInterval(runListDeltaSync, intervalMs);

        return () => {
            cancelled = true;
            clearInterval(intervalId);
        };
    }, [viewMode, viewFilter, isTabVisible, searchQuery, featureFlags.balancedPolling, featureFlags.workspaceV2, featureFlags.realtimeSse, realtimeMode, activeIdRef, conversationDeltaCursorRef, applyConversationDeltaPayload, markConversationReadInUi, replaceConversationListFromResponse, trackClientRequest]);

    useEffect(() => {
        if (viewMode !== 'chats' || !activeId) return;
        if (!isTabVisible) return;
        if (featureFlags.realtimeSse && realtimeMode !== 'fallback') return;

        let cancelled = false;
        const pendingTranscripts = hasPendingTranscripts(messagesRef.current);
        const intervalMs = featureFlags.balancedPolling
            ? (pendingTranscripts ? 8_000 : 20_000)
            : 3_000;

        const runActiveConversationDelta = async () => {
            const selectedConversationId = activeIdRef.current;
            if (!selectedConversationId) return;

            try {
                if (!featureFlags.workspaceV2) {
                    trackClientRequest("legacy_active_poll", { conversationId: selectedConversationId, pendingTranscripts });
                    const [latestMessages, latestActivity, freshConversation] = await Promise.all([
                        fetchMessages(selectedConversationId),
                        fetchConversationActivityLog(selectedConversationId),
                        refreshConversation(selectedConversationId),
                    ]);
                    if (cancelled || activeIdRef.current !== selectedConversationId) return;

                    const latestSignature = getMessageSignature(latestMessages || []);
                    if (latestSignature !== messageSignatureRef.current) {
                        messageSignatureRef.current = latestSignature;
                        setMessages(latestMessages || []);
                    }
                    setActivityLog(latestActivity || []);
                    if (freshConversation) {
                        setConversations((prev) =>
                            prev.map((conversation) =>
                                conversation.id === selectedConversationId
                                    ? { ...conversation, ...(freshConversation as any) }
                                    : conversation
                            )
                        );
                        if (Number((freshConversation as any)?.unreadCount || 0) > 0) {
                            void markConversationReadInUi(selectedConversationId);
                        }
                    }
                    return;
                }

                await refreshActiveWorkspaceCore(selectedConversationId, {
                    logKind: "active_delta_poll",
                    pendingTranscripts,
                    shouldApply: () => !cancelled,
                });
            } catch (err) {
                if (!cancelled) {
                    console.error("Active conversation delta sync failed:", err);
                }
            }
        };

        const loadedAt = initialWorkspaceLoadedAtRef.current[activeId] || 0;
        const elapsedSinceInitialLoad = loadedAt > 0 ? Date.now() - loadedAt : 0;
        const waitMs = loadedAt > 0 ? Math.max(ACTIVE_POLL_GRACE_MS - elapsedSinceInitialLoad, 0) : ACTIVE_POLL_GRACE_MS;

        let intervalId: ReturnType<typeof setInterval> | null = null;
        const startTimer = setTimeout(() => {
            if (cancelled) return;
            void runActiveConversationDelta();
            intervalId = setInterval(runActiveConversationDelta, intervalMs);
        }, waitMs);

        return () => {
            cancelled = true;
            clearTimeout(startTimer);
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [viewMode, activeId, isTabVisible, featureFlags.balancedPolling, featureFlags.workspaceV2, featureFlags.realtimeSse, realtimeMode, activeIdRef, messagesRef, messageSignatureRef, markConversationReadInUi, trackClientRequest, refreshActiveWorkspaceCore, setActivityLog, setConversations, setMessages]);

    return { runRealtimeRefresh };
}
