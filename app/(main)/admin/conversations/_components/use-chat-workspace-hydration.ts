'use client';

import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Conversation, Message } from '@/lib/ghl/conversations';
import type { ConversationFeatureFlags } from '@/lib/feature-flags';
import {
    THREAD_INITIAL_FALLBACK_MESSAGES,
    THREAD_TARGET_MESSAGE_COUNT,
    buildMessageCursorFromMessage,
    computeInitialMessageLimitFromViewport,
    mergePrependMessagesDedupe,
} from '@/lib/conversations/thread-hydration';
import {
    createWorkspaceCoreSnapshot,
    createWorkspaceHydrationState,
    type WorkspaceCoreSnapshot,
} from '@/lib/conversations/workspace-state';
import {
    fetchConversationActivityLog,
    fetchMessages,
    getConversationWorkspaceCore,
    getConversationWorkspaceSidebar,
    refreshConversation,
    refreshConversationOnDemand,
} from '../actions';
import { toast } from '@/components/ui/use-toast';
import { buildContactContextShell } from './conversation-workspace-ui-actions';
import { getMessageSignature } from './conversation-transcript-actions';

export type WorkspaceSidebarSnapshot = {
    contactContext: any;
    taskSummary: any;
    viewingSummary: any;
    agentSummary: any;
};

type UseChatWorkspaceHydrationParams = {
    viewMode: 'chats' | 'deals';
    activeId: string | null;
    locationId: string;
    featureFlags: Pick<ConversationFeatureFlags, 'workspaceV2'>;
    activeIdRef: MutableRefObject<string | null>;
    conversationsRef: MutableRefObject<Conversation[]>;
    selectedConversationCacheRef: MutableRefObject<Map<string, Conversation>>;
    initialWorkspaceLoadedAtRef: MutableRefObject<Record<string, number>>;
    backgroundSyncByConversationRef: MutableRefObject<Record<string, number>>;
    workspaceCoreInFlightRef: MutableRefObject<Set<string>>;
    workspaceSidebarInFlightRef: MutableRefObject<Set<string>>;
    workspaceInitialHydrationInFlightRef: MutableRefObject<Set<string>>;
    workspaceBackfillInFlightRef: MutableRefObject<Set<string>>;
    workspaceActivityHydrationInFlightRef: MutableRefObject<Set<string>>;
    workspaceMessageMetadataInFlightRef: MutableRefObject<Set<string>>;
    messageSignatureRef: MutableRefObject<string>;
    setMessages: Dispatch<SetStateAction<Message[]>>;
    setActivityLog: Dispatch<SetStateAction<any[]>>;
    setTranscriptOnDemandEnabled: Dispatch<SetStateAction<boolean>>;
    setWorkspaceContactContext: Dispatch<SetStateAction<any>>;
    setWorkspaceTaskSummary: Dispatch<SetStateAction<any>>;
    setWorkspaceViewingSummary: Dispatch<SetStateAction<any>>;
    setWorkspaceAgentSummary: Dispatch<SetStateAction<any>>;
    setLoadingMessages: Dispatch<SetStateAction<boolean>>;
    setConversations: Dispatch<SetStateAction<Conversation[]>>;
    getCachedWorkspaceCoreSnapshot: (conversationId: string) => WorkspaceCoreSnapshot | null;
    getCachedWorkspaceSidebarSnapshot: (conversationId: string) => WorkspaceSidebarSnapshot | null;
    applyWorkspaceCoreSnapshot: (conversationId: string, snapshot: WorkspaceCoreSnapshot) => void;
    cacheWorkspaceCoreSnapshot: (conversationId: string, snapshot: WorkspaceCoreSnapshot) => void;
    cacheWorkspaceSidebarSnapshot: (conversationId: string, snapshot: WorkspaceSidebarSnapshot) => void;
    markConversationReadInUi: (conversationId: string) => void;
    trackClientRequest: (kind: string, metadata?: Record<string, unknown>) => void;
    trackClientMetric: (kind: string, valueMs: number, metadata?: Record<string, unknown>) => void;
    estimateThreadViewportHeightPx: () => number | null;
    workspaceActivityLimit: number;
};

export function useChatWorkspaceHydration({
    viewMode,
    activeId,
    locationId,
    featureFlags,
    activeIdRef,
    conversationsRef,
    selectedConversationCacheRef,
    initialWorkspaceLoadedAtRef,
    backgroundSyncByConversationRef,
    workspaceCoreInFlightRef,
    workspaceSidebarInFlightRef,
    workspaceInitialHydrationInFlightRef,
    workspaceBackfillInFlightRef,
    workspaceActivityHydrationInFlightRef,
    workspaceMessageMetadataInFlightRef,
    messageSignatureRef,
    setMessages,
    setActivityLog,
    setTranscriptOnDemandEnabled,
    setWorkspaceContactContext,
    setWorkspaceTaskSummary,
    setWorkspaceViewingSummary,
    setWorkspaceAgentSummary,
    setLoadingMessages,
    setConversations,
    getCachedWorkspaceCoreSnapshot,
    getCachedWorkspaceSidebarSnapshot,
    applyWorkspaceCoreSnapshot,
    cacheWorkspaceCoreSnapshot,
    cacheWorkspaceSidebarSnapshot,
    markConversationReadInUi,
    trackClientRequest,
    trackClientMetric,
    estimateThreadViewportHeightPx,
    workspaceActivityLimit,
}: UseChatWorkspaceHydrationParams) {
    useEffect(() => {
        if (viewMode !== 'chats') return;
        if (!activeId) {
            setMessages([]);
            setActivityLog([]);
            setTranscriptOnDemandEnabled(false);
            setWorkspaceContactContext(null);
            setWorkspaceTaskSummary(null);
            setWorkspaceViewingSummary(null);
            setWorkspaceAgentSummary(null);
            return;
        }

        let cancelled = false;
        const selectedConversationId = activeId;
        initialWorkspaceLoadedAtRef.current[selectedConversationId] = 0;

        const cachedSnapshot = getCachedWorkspaceCoreSnapshot(selectedConversationId);
        const cachedSidebarSnapshot = getCachedWorkspaceSidebarSnapshot(selectedConversationId);
        if (cachedSidebarSnapshot) {
            setWorkspaceContactContext(cachedSidebarSnapshot.contactContext || null);
            setWorkspaceTaskSummary(cachedSidebarSnapshot.taskSummary || null);
            setWorkspaceViewingSummary(cachedSidebarSnapshot.viewingSummary || null);
            setWorkspaceAgentSummary(cachedSidebarSnapshot.agentSummary || null);
        } else {
            const shellConversation =
                selectedConversationCacheRef.current.get(selectedConversationId)
                || conversationsRef.current.find((conversation) => conversation.id === selectedConversationId)
                || null;
            setWorkspaceContactContext(buildContactContextShell(shellConversation, locationId));
            setWorkspaceTaskSummary(null);
            setWorkspaceViewingSummary(null);
            setWorkspaceAgentSummary(null);
        }
        if (cachedSnapshot) {
            applyWorkspaceCoreSnapshot(selectedConversationId, cachedSnapshot);
            initialWorkspaceLoadedAtRef.current[selectedConversationId] = Date.now();
            setLoadingMessages(false);
        } else {
            setMessages([]);
            setActivityLog([]);
            setTranscriptOnDemandEnabled(false);
            setLoadingMessages(true);
        }

        if (!featureFlags.workspaceV2) {
            // Debounce network requests to prevent request stampede during rapid
            // conversation switching. Cached conversations render instantly above;
            // only the network fetch is delayed so intermediate clicks never fire.
            const LEGACY_DEBOUNCE_MS = cachedSnapshot ? 0 : 150;
            const legacyDebounceTimer = setTimeout(() => {
                if (cancelled || activeIdRef.current !== selectedConversationId) return;
                trackClientRequest("legacy_selection_load", { conversationId: selectedConversationId });
                Promise.all([
                    fetchMessages(selectedConversationId, { take: THREAD_TARGET_MESSAGE_COUNT }),
                    fetchConversationActivityLog(selectedConversationId),
                    refreshConversation(selectedConversationId),
                ])
                    .then(([nextMessages, nextActivity, freshConversation]) => {
                        if (cancelled || activeIdRef.current !== selectedConversationId) return;
                        setMessages(nextMessages || []);
                        messageSignatureRef.current = getMessageSignature(nextMessages || []);
                        setActivityLog(nextActivity || []);
                        cacheWorkspaceCoreSnapshot(selectedConversationId, createWorkspaceCoreSnapshot({
                            conversationHeader: freshConversation as Conversation | null,
                            messages: nextMessages || [],
                            activityTimeline: nextActivity || [],
                            transcriptOnDemandEnabled: false,
                            hydration: createWorkspaceHydrationState({
                                status: 'full',
                                messages: nextMessages || [],
                                initialCount: (nextMessages || []).length,
                                targetCount: THREAD_TARGET_MESSAGE_COUNT,
                                requestedLimit: (nextMessages || []).length || THREAD_INITIAL_FALLBACK_MESSAGES,
                            }),
                        }));
                        initialWorkspaceLoadedAtRef.current[selectedConversationId] = Date.now();
                        if (freshConversation) {
                            setConversations((prev) => prev.map((item) =>
                                item.id === selectedConversationId ? { ...item, ...(freshConversation as any) } : item
                            ));
                        }
                        void markConversationReadInUi(selectedConversationId);
                    })
                    .catch((err) => {
                        if (cancelled) return;
                        console.error("Legacy selection load failed:", err);
                        toast({ title: "Error", description: "Failed to load conversation.", variant: "destructive" });
                    })
                    .finally(() => {
                        if (!cancelled) setLoadingMessages(false);
                    });
            }, LEGACY_DEBOUNCE_MS);

            return () => {
                cancelled = true;
                clearTimeout(legacyDebounceTimer);
            };
        }

        let deferredHydrationTimeout: ReturnType<typeof setTimeout> | null = null;
        let deferredHydrationIdleHandle: number | null = null;

        const clearDeferredHydrationTimer = () => {
            if (deferredHydrationTimeout) {
                clearTimeout(deferredHydrationTimeout);
                deferredHydrationTimeout = null;
            }
            if (deferredHydrationIdleHandle !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
                (window as any).cancelIdleCallback(deferredHydrationIdleHandle);
                deferredHydrationIdleHandle = null;
            }
        };

        const scheduleDeferredHydration = (task: () => void) => {
            clearDeferredHydrationTimer();
            if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                deferredHydrationIdleHandle = (window as any).requestIdleCallback(() => {
                    deferredHydrationIdleHandle = null;
                    task();
                }, { timeout: 1200 });
                return;
            }
            deferredHydrationTimeout = setTimeout(() => {
                deferredHydrationTimeout = null;
                task();
            }, 300);
        };

        const runThreadStaleBackgroundSync = (baseSnapshot: WorkspaceCoreSnapshot, threadStale: boolean | undefined) => {
            if (!featureFlags.workspaceV2 || !threadStale) return;
            const nowMs = Date.now();
            const lastSyncedMs = backgroundSyncByConversationRef.current[selectedConversationId] || 0;
            if (nowMs - lastSyncedMs < 5 * 60 * 1000) return;

            backgroundSyncByConversationRef.current[selectedConversationId] = nowMs;
            void refreshConversationOnDemand(selectedConversationId, "full_sync")
                .then(async (syncRes: any) => {
                    if (!syncRes?.success || Number(syncRes?.syncedCount || 0) <= 0) return;
                    const refreshed = await fetchMessages(selectedConversationId, { take: THREAD_TARGET_MESSAGE_COUNT });
                    if (activeIdRef.current !== selectedConversationId) return;
                    const currentSnapshot = getCachedWorkspaceCoreSnapshot(selectedConversationId) || baseSnapshot;
                    const refreshedSnapshot: WorkspaceCoreSnapshot = {
                        ...currentSnapshot,
                        messages: refreshed,
                        hydration: createWorkspaceHydrationState({
                            status: 'full',
                            messages: refreshed,
                            initialCount: currentSnapshot.hydration?.initialCount || refreshed.length,
                            targetCount: THREAD_TARGET_MESSAGE_COUNT,
                            requestedLimit: currentSnapshot.hydration?.requestedLimit || THREAD_TARGET_MESSAGE_COUNT,
                        }),
                    };
                    cacheWorkspaceCoreSnapshot(selectedConversationId, refreshedSnapshot);
                    applyWorkspaceCoreSnapshot(selectedConversationId, refreshedSnapshot);
                    initialWorkspaceLoadedAtRef.current[selectedConversationId] = Date.now();
                    void markConversationReadInUi(selectedConversationId);
                })
                .catch((err) => console.error("[Workspace Background Sync] Error:", err));
        };

        const loadWorkspaceCore = async () => {
            const threadOpenStartedAtMs = Date.now();
            const initialMessageLimit = computeInitialMessageLimitFromViewport(estimateThreadViewportHeightPx());
            workspaceCoreInFlightRef.current.add(selectedConversationId);
            workspaceInitialHydrationInFlightRef.current.add(selectedConversationId);
            trackClientRequest("workspace_core_load", {
                conversationId: selectedConversationId,
                mode: "initial_hydration",
                messageLimit: initialMessageLimit,
            });
            try {
                const workspace = await getConversationWorkspaceCore(selectedConversationId, {
                    includeMessages: true,
                    includeActivity: false,
                    messageLimit: initialMessageLimit,
                    activityLimit: workspaceActivityLimit,
                    messageMetadataMode: "firstPaint",
                    refreshMode: "initial_hydration",
                });

                if (cancelled || activeIdRef.current !== selectedConversationId) return;
                if (!workspace?.success) {
                    throw new Error(workspace?.error || "Failed to load conversation workspace core");
                }

                const initialMessages = Array.isArray(workspace?.messages) ? workspace.messages : [];
                const cachedMessages = Array.isArray(cachedSnapshot?.messages) ? cachedSnapshot.messages : [];
                const mergedInitialMessages = (() => {
                    if (cachedMessages.length === 0) return initialMessages;
                    const byId = new Map<string, Message>();
                    for (const message of [...cachedMessages, ...initialMessages]) {
                        if (!message?.id) continue;
                        byId.set(message.id, message);
                    }
                    const sorted = Array.from(byId.values()).sort((a, b) => {
                        const aTs = Number(new Date(a.dateAdded).getTime());
                        const bTs = Number(new Date(b.dateAdded).getTime());
                        if (aTs !== bTs) return aTs - bTs;
                        return String(a.id).localeCompare(String(b.id));
                    });
                    const preserveCount = Math.min(
                        THREAD_TARGET_MESSAGE_COUNT,
                        Math.max(cachedMessages.length, initialMessages.length)
                    );
                    return preserveCount > 0 ? sorted.slice(-preserveCount) : sorted;
                })();
                const initialHydration = createWorkspaceHydrationState({
                    status: mergedInitialMessages.length >= THREAD_TARGET_MESSAGE_COUNT ? 'full' : 'partial',
                    messages: mergedInitialMessages,
                    initialCount: initialMessages.length,
                    targetCount: THREAD_TARGET_MESSAGE_COUNT,
                    requestedLimit: initialMessageLimit,
                });
                const initialSnapshot = createWorkspaceCoreSnapshot({
                    conversationHeader: workspace?.conversationHeader || null,
                    messages: mergedInitialMessages,
                    activityTimeline: cachedSnapshot?.activityTimeline || [],
                    transcriptEligibility: workspace?.transcriptEligibility,
                    hydration: initialHydration,
                });

                cacheWorkspaceCoreSnapshot(selectedConversationId, initialSnapshot);
                applyWorkspaceCoreSnapshot(selectedConversationId, initialSnapshot);
                initialWorkspaceLoadedAtRef.current[selectedConversationId] = Date.now();
                setLoadingMessages(false);

                const initialOpenMs = Date.now() - threadOpenStartedAtMs;
                trackClientRequest("thread_open_initial", {
                    conversationId: selectedConversationId,
                    selectedConversationId,
                    thread_open_initial_ms: initialOpenMs,
                    initial_message_count: initialMessages.length,
                    rendered_message_count: mergedInitialMessages.length,
                    requested_initial_limit: initialMessageLimit,
                    requestedInitialLimit: initialMessageLimit,
                    transcriptEligibilityDeferred: !!workspace?.transcriptEligibilityDeferred,
                });

                void markConversationReadInUi(selectedConversationId);
                runThreadStaleBackgroundSync(initialSnapshot, !!workspace?.freshness?.threadStale);

                const runDeferredHydration = async () => {
                    if (cancelled || activeIdRef.current !== selectedConversationId) return;

                    let backfillCount = 0;
                    const runBackfillHydration = async (): Promise<number> => {
                        if (workspaceBackfillInFlightRef.current.has(selectedConversationId)) return 0;
                        workspaceBackfillInFlightRef.current.add(selectedConversationId);
                        trackClientRequest("workspace_backfill_start", { conversationId: selectedConversationId });
                        try {
                            let totalAdded = 0;
                            let latestSnapshot = getCachedWorkspaceCoreSnapshot(selectedConversationId) || initialSnapshot;
                            let workingMessages = Array.isArray(latestSnapshot.messages) ? latestSnapshot.messages : [];
                            let oldestCursor = latestSnapshot.hydration?.oldestCursor || buildMessageCursorFromMessage(workingMessages[0]);

                            while (!cancelled && activeIdRef.current === selectedConversationId && workingMessages.length < THREAD_TARGET_MESSAGE_COUNT && oldestCursor) {
                                const needed = THREAD_TARGET_MESSAGE_COUNT - workingMessages.length;
                                const olderMessages = await fetchMessages(selectedConversationId, {
                                    take: needed,
                                    beforeCursor: oldestCursor,
                                    metadataMode: "firstPaint",
                                });
                                if (cancelled || activeIdRef.current !== selectedConversationId) break;
                                if (!Array.isArray(olderMessages) || olderMessages.length === 0) break;

                                const mergedMessages = mergePrependMessagesDedupe(workingMessages, olderMessages);
                                const addedCount = Math.max(mergedMessages.length - workingMessages.length, 0);
                                if (addedCount <= 0) break;

                                totalAdded += addedCount;
                                workingMessages = mergedMessages;
                                oldestCursor = buildMessageCursorFromMessage(workingMessages[0]) || oldestCursor;

                                const currentSnapshot = getCachedWorkspaceCoreSnapshot(selectedConversationId) || latestSnapshot;
                                const nextSnapshot: WorkspaceCoreSnapshot = {
                                    ...currentSnapshot,
                                    messages: workingMessages,
                                    hydration: createWorkspaceHydrationState({
                                        status: workingMessages.length >= THREAD_TARGET_MESSAGE_COUNT ? 'full' : 'partial',
                                        messages: workingMessages,
                                        initialCount: currentSnapshot.hydration?.initialCount || initialSnapshot.hydration.initialCount,
                                        targetCount: THREAD_TARGET_MESSAGE_COUNT,
                                        requestedLimit: currentSnapshot.hydration?.requestedLimit || initialMessageLimit,
                                    }),
                                };
                                latestSnapshot = nextSnapshot;
                                cacheWorkspaceCoreSnapshot(selectedConversationId, nextSnapshot);
                                applyWorkspaceCoreSnapshot(selectedConversationId, nextSnapshot);

                                if (olderMessages.length < needed) break;
                            }

                            if (!cancelled && activeIdRef.current === selectedConversationId) {
                                const currentSnapshot = getCachedWorkspaceCoreSnapshot(selectedConversationId) || latestSnapshot;
                                if (currentSnapshot.hydration.status !== 'full') {
                                    const finalizedSnapshot: WorkspaceCoreSnapshot = {
                                        ...currentSnapshot,
                                        hydration: createWorkspaceHydrationState({
                                            status: 'full',
                                            messages: currentSnapshot.messages,
                                            initialCount: currentSnapshot.hydration.initialCount,
                                            targetCount: THREAD_TARGET_MESSAGE_COUNT,
                                            requestedLimit: currentSnapshot.hydration.requestedLimit,
                                        }),
                                    };
                                    cacheWorkspaceCoreSnapshot(selectedConversationId, finalizedSnapshot);
                                    applyWorkspaceCoreSnapshot(selectedConversationId, finalizedSnapshot);
                                }
                            }

                            return totalAdded;
                        } finally {
                            workspaceBackfillInFlightRef.current.delete(selectedConversationId);
                        }
                    };

                    const runDeferredActivityHydration = async () => {
                        if (workspaceActivityHydrationInFlightRef.current.has(selectedConversationId)) return;
                        workspaceActivityHydrationInFlightRef.current.add(selectedConversationId);
                        trackClientRequest("workspace_activity_deferred_load", { conversationId: selectedConversationId });
                        try {
                            const activityWorkspace = await getConversationWorkspaceCore(selectedConversationId, {
                                includeMessages: false,
                                includeActivity: true,
                                messageLimit: initialMessageLimit,
                                activityLimit: workspaceActivityLimit,
                                refreshMode: "deferred_activity",
                            });
                            if (cancelled || activeIdRef.current !== selectedConversationId) return;
                            if (!activityWorkspace?.success) return;

                            const currentSnapshot = getCachedWorkspaceCoreSnapshot(selectedConversationId) || initialSnapshot;
                            const refreshedSnapshot: WorkspaceCoreSnapshot = {
                                ...currentSnapshot,
                                conversationHeader: activityWorkspace?.conversationHeader || currentSnapshot.conversationHeader,
                                activityTimeline: Array.isArray(activityWorkspace?.activityTimeline)
                                    ? activityWorkspace.activityTimeline
                                    : currentSnapshot.activityTimeline,
                                transcriptOnDemandEnabled: !!activityWorkspace?.transcriptEligibility?.success
                                    ? !!activityWorkspace?.transcriptEligibility?.enabled
                                    : currentSnapshot.transcriptOnDemandEnabled,
                            };
                            cacheWorkspaceCoreSnapshot(selectedConversationId, refreshedSnapshot);
                            applyWorkspaceCoreSnapshot(selectedConversationId, refreshedSnapshot);
                        } catch (err) {
                            if (!cancelled) {
                                console.error("Deferred workspace activity load failed:", err);
                            }
                        } finally {
                            workspaceActivityHydrationInFlightRef.current.delete(selectedConversationId);
                        }
                    };

                    const [resolvedBackfillCount] = await Promise.all([
                        runBackfillHydration(),
                        runDeferredActivityHydration(),
                    ]);
                    backfillCount = resolvedBackfillCount;

                    if (cancelled || activeIdRef.current !== selectedConversationId) return;

                    const currentSnapshot = getCachedWorkspaceCoreSnapshot(selectedConversationId) || initialSnapshot;
                    if (Array.isArray(currentSnapshot.messages) && currentSnapshot.messages.length > 0) {
                        if (workspaceMessageMetadataInFlightRef.current.has(selectedConversationId)) {
                            trackClientRequest("workspace_message_metadata_deferred_skip_inflight", { conversationId: selectedConversationId });
                        } else {
                            workspaceMessageMetadataInFlightRef.current.add(selectedConversationId);
                            trackClientRequest("workspace_message_metadata_deferred_load", { conversationId: selectedConversationId });
                            try {
                                const enrichedMessages = await fetchMessages(selectedConversationId, {
                                    take: Math.min(THREAD_TARGET_MESSAGE_COUNT, Math.max(currentSnapshot.messages.length, initialMessageLimit)),
                                    metadataMode: "full",
                                });
                                if (!cancelled && activeIdRef.current === selectedConversationId && Array.isArray(enrichedMessages) && enrichedMessages.length > 0) {
                                    const latestSnapshot = getCachedWorkspaceCoreSnapshot(selectedConversationId) || currentSnapshot;
                                    const enrichedSnapshot: WorkspaceCoreSnapshot = {
                                        ...latestSnapshot,
                                        messages: enrichedMessages,
                                        hydration: createWorkspaceHydrationState({
                                            status: latestSnapshot.hydration?.status || 'full',
                                            messages: enrichedMessages,
                                            messageWindow: latestSnapshot.hydration,
                                            initialCount: latestSnapshot.hydration?.initialCount || initialMessages.length,
                                            targetCount: THREAD_TARGET_MESSAGE_COUNT,
                                            requestedLimit: latestSnapshot.hydration?.requestedLimit || initialMessageLimit,
                                        }),
                                    };
                                    cacheWorkspaceCoreSnapshot(selectedConversationId, enrichedSnapshot);
                                    applyWorkspaceCoreSnapshot(selectedConversationId, enrichedSnapshot);
                                }
                            } finally {
                                workspaceMessageMetadataInFlightRef.current.delete(selectedConversationId);
                            }
                        }
                    }

                    if (cancelled || activeIdRef.current !== selectedConversationId) return;
                    trackClientRequest("thread_open_full", {
                        conversationId: selectedConversationId,
                        thread_open_full_ms: Date.now() - threadOpenStartedAtMs,
                        initial_message_count: initialMessages.length,
                        backfill_count: backfillCount,
                    });
                };

                scheduleDeferredHydration(() => {
                    void runDeferredHydration();
                });
            } catch (err) {
                if (cancelled) return;
                console.error("Failed to load conversation workspace core:", err);
                toast({ title: "Error", description: "Failed to load conversation workspace.", variant: "destructive" });
            } finally {
                workspaceCoreInFlightRef.current.delete(selectedConversationId);
                workspaceInitialHydrationInFlightRef.current.delete(selectedConversationId);
                if (!cancelled) {
                    setLoadingMessages(false);
                }
            }
        };

        const loadWorkspaceSidebar = async () => {
            if (workspaceSidebarInFlightRef.current.has(selectedConversationId)) return;
            const sidebarStartedAtMs = Date.now();
            workspaceSidebarInFlightRef.current.add(selectedConversationId);
            trackClientRequest("workspace_sidebar_load", { conversationId: selectedConversationId });
            try {
                const sidebar = await getConversationWorkspaceSidebar(selectedConversationId);
                if (cancelled || activeIdRef.current !== selectedConversationId) return;
                if (!sidebar?.success) return;

                const sidebarSnapshot: WorkspaceSidebarSnapshot = {
                    contactContext: sidebar?.contactContext || null,
                    taskSummary: sidebar?.taskSummary || null,
                    viewingSummary: sidebar?.viewingSummary || null,
                    agentSummary: sidebar?.agentSummary || null,
                };
                cacheWorkspaceSidebarSnapshot(selectedConversationId, sidebarSnapshot);
                setWorkspaceContactContext(sidebar?.contactContext || null);
                setWorkspaceTaskSummary(sidebar?.taskSummary || null);
                setWorkspaceViewingSummary(sidebar?.viewingSummary || null);
                setWorkspaceAgentSummary(sidebar?.agentSummary || null);
                trackClientMetric("sidebar_contact_ready_ms", Date.now() - sidebarStartedAtMs, {
                    conversationId: selectedConversationId,
                    cache_hit: false,
                });
            } catch (err) {
                if (!cancelled) {
                    console.error("Failed to load conversation workspace sidebar:", err);
                }
            } finally {
                workspaceSidebarInFlightRef.current.delete(selectedConversationId);
            }
        };

        // Debounce network requests to prevent request stampede during rapid
        // conversation switching. When clicking through 5 conversations in
        // quick succession, only the final one fires server requests.
        // Cached conversations already rendered above; do not run another
        // initial hydration load on selection because it can contend with
        // focus-return polling and make previously opened threads look blocked.
        const WORKSPACE_NETWORK_DEBOUNCE_MS = cachedSnapshot ? 0 : 150;
        const networkDebounceTimer = setTimeout(() => {
            if (cancelled || activeIdRef.current !== selectedConversationId) return;
            if (!cachedSnapshot) {
                void loadWorkspaceCore();
            } else {
                trackClientRequest("workspace_core_cache_reuse", {
                    conversationId: selectedConversationId,
                    requestedInitialLimit: cachedSnapshot.hydration?.requestedLimit || null,
                    message_count: Array.isArray(cachedSnapshot.messages) ? cachedSnapshot.messages.length : 0,
                });
            }
            if (cachedSidebarSnapshot) {
                trackClientMetric("sidebar_contact_ready_ms", 0, {
                    conversationId: selectedConversationId,
                    cache_hit: true,
                });
            } else {
                void loadWorkspaceSidebar();
            }
        }, WORKSPACE_NETWORK_DEBOUNCE_MS);

        const workspaceInitialHydrationInFlight = workspaceInitialHydrationInFlightRef.current;
        const workspaceBackfillInFlight = workspaceBackfillInFlightRef.current;
        const workspaceActivityHydrationInFlight = workspaceActivityHydrationInFlightRef.current;
        const workspaceMessageMetadataInFlight = workspaceMessageMetadataInFlightRef.current;
        const workspaceSidebarInFlight = workspaceSidebarInFlightRef.current;

        return () => {
            cancelled = true;
            clearTimeout(networkDebounceTimer);
            clearDeferredHydrationTimer();
            workspaceInitialHydrationInFlight.delete(selectedConversationId);
            workspaceBackfillInFlight.delete(selectedConversationId);
            workspaceActivityHydrationInFlight.delete(selectedConversationId);
            workspaceMessageMetadataInFlight.delete(selectedConversationId);
            workspaceSidebarInFlight.delete(selectedConversationId);
        };
    }, [
        viewMode,
        activeId,
        markConversationReadInUi,
        featureFlags.workspaceV2,
        trackClientRequest,
        trackClientMetric,
        getCachedWorkspaceCoreSnapshot,
        getCachedWorkspaceSidebarSnapshot,
        applyWorkspaceCoreSnapshot,
        cacheWorkspaceCoreSnapshot,
        cacheWorkspaceSidebarSnapshot,
        locationId,
        activeIdRef,
        conversationsRef,
        selectedConversationCacheRef,
        initialWorkspaceLoadedAtRef,
        backgroundSyncByConversationRef,
        workspaceCoreInFlightRef,
        workspaceSidebarInFlightRef,
        workspaceInitialHydrationInFlightRef,
        workspaceBackfillInFlightRef,
        workspaceActivityHydrationInFlightRef,
        workspaceMessageMetadataInFlightRef,
        messageSignatureRef,
        setMessages,
        setActivityLog,
        setTranscriptOnDemandEnabled,
        setWorkspaceContactContext,
        setWorkspaceTaskSummary,
        setWorkspaceViewingSummary,
        setWorkspaceAgentSummary,
        setLoadingMessages,
        setConversations,
        estimateThreadViewportHeightPx,
        workspaceActivityLimit,
    ]);
}
