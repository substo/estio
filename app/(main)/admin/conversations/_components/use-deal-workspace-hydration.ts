'use client';

import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { Conversation } from '@/lib/ghl/conversations';
import type { WorkspaceHydrationStatus } from '@/lib/conversations/workspace-state';
import {
    THREAD_INITIAL_FALLBACK_MESSAGES,
    THREAD_TARGET_MESSAGE_COUNT,
    computeInitialMessageLimitFromViewport,
} from '@/lib/conversations/thread-hydration';
import { buildTimelineCursorFromEvent } from '@/lib/conversations/timeline-events';
import {
    fetchDealTimeline,
    getDealWorkspaceCore,
    getDealWorkspaceSidebar,
} from '../../deals/actions';
import { toast } from '@/components/ui/use-toast';
import type { DealContactOption } from './conversation-contact-identity-actions';

export type DealWorkspaceHydrationState = {
    status: WorkspaceHydrationStatus;
    oldestCursor: string | null;
    newestCursor: string | null;
    initialCount: number;
    targetCount: number;
    requestedLimit: number;
};

export type DealWorkspaceCoreSnapshot = {
    dealId: string;
    title: string;
    stage: string;
    metadata: any;
    participants: Conversation[];
    timelineEvents: any[];
    hydration: DealWorkspaceHydrationState;
};

type DealTimelineWindowLike = {
    oldestCursor?: string | null;
    newestCursor?: string | null;
    count?: number;
    requestedLimit?: number;
} | null | undefined;

export function createDealWorkspaceHydrationState(args: {
    status?: WorkspaceHydrationStatus;
    timelineEvents: any[];
    timelineWindow?: DealTimelineWindowLike;
    initialCount?: number;
    targetCount?: number;
    requestedLimit?: number;
}): DealWorkspaceHydrationState {
    const timelineEvents = Array.isArray(args.timelineEvents) ? args.timelineEvents : [];
    const timelineWindow = args.timelineWindow;
    const derivedInitialCount = Number(args.initialCount);
    const derivedTargetCount = Number(args.targetCount);
    const derivedRequestedLimit = Number(args.requestedLimit);
    const resolvedCount = Number(timelineWindow?.count);
    const resolvedRequestedLimit = Number(timelineWindow?.requestedLimit);

    return {
        status: args.status || 'full',
        oldestCursor: timelineWindow?.oldestCursor || buildTimelineCursorFromEvent(timelineEvents[0]) || null,
        newestCursor: timelineWindow?.newestCursor || buildTimelineCursorFromEvent(timelineEvents[timelineEvents.length - 1]) || null,
        initialCount: Number.isFinite(derivedInitialCount)
            ? Math.max(0, Math.floor(derivedInitialCount))
            : (Number.isFinite(resolvedCount) ? Math.max(0, Math.floor(resolvedCount)) : timelineEvents.length),
        targetCount: Number.isFinite(derivedTargetCount)
            ? Math.max(1, Math.floor(derivedTargetCount))
            : THREAD_TARGET_MESSAGE_COUNT,
        requestedLimit: Number.isFinite(derivedRequestedLimit)
            ? Math.max(1, Math.floor(derivedRequestedLimit))
            : (Number.isFinite(resolvedRequestedLimit)
                ? Math.max(1, Math.floor(resolvedRequestedLimit))
                : Math.max(timelineEvents.length || 0, THREAD_INITIAL_FALLBACK_MESSAGES)),
    };
}

export function createDealWorkspaceCoreSnapshot(args: {
    dealId: string;
    title?: string | null;
    stage?: string | null;
    metadata?: any;
    participants?: Conversation[];
    timelineEvents?: any[];
    hydration: DealWorkspaceHydrationState;
}): DealWorkspaceCoreSnapshot {
    return {
        dealId: args.dealId,
        title: String(args.title || "Untitled Deal"),
        stage: String(args.stage || "ACTIVE"),
        metadata: args.metadata || null,
        participants: Array.isArray(args.participants) ? args.participants : [],
        timelineEvents: Array.isArray(args.timelineEvents) ? args.timelineEvents : [],
        hydration: args.hydration,
    };
}

function mergePrependTimelineEventsDedupe(existing: any[], older: any[]): any[] {
    if (!Array.isArray(existing) || existing.length === 0) {
        return Array.isArray(older) ? [...older] : [];
    }
    if (!Array.isArray(older) || older.length === 0) {
        return [...existing];
    }

    const seen = new Set(existing.map((event) => String(event?.id || "")));
    const prepend: any[] = [];
    for (const event of older) {
        const eventId = String(event?.id || "");
        if (!eventId || seen.has(eventId)) continue;
        seen.add(eventId);
        prepend.push(event);
    }

    return prepend.length > 0 ? [...prepend, ...existing] : [...existing];
}

type UseDealWorkspaceHydrationParams = {
    viewMode: 'chats' | 'deals';
    activeDealId: string | null;
    realtimeMode: 'disabled' | 'connecting' | 'connected' | 'fallback';
    activeDealIdRef: MutableRefObject<string | null>;
    activeIdRef: MutableRefObject<string | null>;
    dealWorkspaceCoreInFlightRef: MutableRefObject<Set<string>>;
    dealWorkspaceInitialHydrationInFlightRef: MutableRefObject<Set<string>>;
    dealWorkspaceBackfillInFlightRef: MutableRefObject<Set<string>>;
    dealWorkspaceSidebarInFlightRef: MutableRefObject<Set<string>>;
    dealTimelineInitialPainted: boolean;
    setActiveDealParticipants: Dispatch<SetStateAction<Conversation[]>>;
    setDealContacts: Dispatch<SetStateAction<DealContactOption[]>>;
    setDealTimelineEvents: Dispatch<SetStateAction<any[]>>;
    setActiveDealMetadata: Dispatch<SetStateAction<any>>;
    setDealTimelineHydrationStatus: Dispatch<SetStateAction<WorkspaceHydrationStatus>>;
    setDealTimelineInitialPainted: Dispatch<SetStateAction<boolean>>;
    setLoadingDealContext: Dispatch<SetStateAction<boolean>>;
    setDeals: Dispatch<SetStateAction<any[]>>;
    applyDealParticipants: (participants: Conversation[], preferredConversationId?: string | null) => void;
    applyDealWorkspaceCoreSnapshot: (dealId: string, snapshot: DealWorkspaceCoreSnapshot, preferredConversationId?: string | null) => void;
    cacheDealWorkspaceCoreSnapshot: (dealId: string, snapshot: DealWorkspaceCoreSnapshot) => void;
    getCachedDealWorkspaceCoreSnapshot: (dealId: string) => DealWorkspaceCoreSnapshot | null;
    trackClientRequest: (kind: string, metadata?: Record<string, unknown>) => void;
    estimateThreadViewportHeightPx: () => number | null;
};

export function useDealWorkspaceHydration({
    viewMode,
    activeDealId,
    realtimeMode,
    activeDealIdRef,
    activeIdRef,
    dealWorkspaceCoreInFlightRef,
    dealWorkspaceInitialHydrationInFlightRef,
    dealWorkspaceBackfillInFlightRef,
    dealWorkspaceSidebarInFlightRef,
    dealTimelineInitialPainted,
    setActiveDealParticipants,
    setDealContacts,
    setDealTimelineEvents,
    setActiveDealMetadata,
    setDealTimelineHydrationStatus,
    setDealTimelineInitialPainted,
    setLoadingDealContext,
    setDeals,
    applyDealParticipants,
    applyDealWorkspaceCoreSnapshot,
    cacheDealWorkspaceCoreSnapshot,
    getCachedDealWorkspaceCoreSnapshot,
    trackClientRequest,
    estimateThreadViewportHeightPx,
}: UseDealWorkspaceHydrationParams) {
    const loadDealWorkspaceSidebar = useCallback(async (
        dealId: string,
        options?: { reason?: string }
    ) => {
        const normalizedDealId = String(dealId || "").trim();
        if (!normalizedDealId) return null;
        if (dealWorkspaceSidebarInFlightRef.current.has(normalizedDealId)) return null;

        dealWorkspaceSidebarInFlightRef.current.add(normalizedDealId);
        trackClientRequest("deal_workspace_sidebar_load", {
            dealId: normalizedDealId,
            reason: options?.reason || "deferred",
        });

        try {
            const sidebar = await getDealWorkspaceSidebar(normalizedDealId);
            if (!sidebar?.success) return sidebar;
            if (activeDealIdRef.current !== normalizedDealId) return sidebar;

            if (Array.isArray(sidebar.participants) && sidebar.participants.length > 0) {
                applyDealParticipants(sidebar.participants, activeIdRef.current);
            }
            setActiveDealMetadata(sidebar.metadata ?? sidebar.deal?.metadata ?? null);
            setDeals((prev) => prev.map((deal) => (
                deal.id === normalizedDealId
                    ? {
                        ...deal,
                        title: sidebar.deal?.title || deal.title,
                        stage: sidebar.deal?.stage || deal.stage,
                        propertyIds: Array.isArray(sidebar.deal?.propertyIds) ? sidebar.deal.propertyIds : deal.propertyIds,
                        metadata: sidebar.metadata ?? deal.metadata,
                    }
                    : deal
            )));
            return sidebar;
        } catch (error) {
            console.error("Failed to load deal workspace sidebar:", error);
            return null;
        } finally {
            dealWorkspaceSidebarInFlightRef.current.delete(normalizedDealId);
        }
    }, [
        activeDealIdRef,
        activeIdRef,
        applyDealParticipants,
        dealWorkspaceSidebarInFlightRef,
        setActiveDealMetadata,
        setDeals,
        trackClientRequest,
    ]);

    useEffect(() => {
        if (viewMode !== 'deals' || !activeDealId) {
            setActiveDealParticipants([]);
            setDealContacts([]);
            setDealTimelineEvents([]);
            setActiveDealMetadata(null);
            setDealTimelineHydrationStatus('full');
            setDealTimelineInitialPainted(false);
            setLoadingDealContext(false);
            return;
        }

        let cancelled = false;
        let deferredHydrationTimeout: ReturnType<typeof setTimeout> | null = null;
        let deferredHydrationIdleHandle: number | null = null;
        const selectedDealId = activeDealId;
        const preferredConversationId = activeIdRef.current;

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

        const cachedSnapshot = getCachedDealWorkspaceCoreSnapshot(selectedDealId);
        setDealTimelineInitialPainted(false);
        if (cachedSnapshot) {
            applyDealWorkspaceCoreSnapshot(selectedDealId, cachedSnapshot, preferredConversationId);
            const shouldKeepLoading = (
                cachedSnapshot.hydration?.status !== 'full'
                && (cachedSnapshot.timelineEvents?.length || 0) === 0
                && Number(cachedSnapshot.hydration?.initialCount || 0) === 0
            );
            setLoadingDealContext(shouldKeepLoading);
        } else {
            setActiveDealParticipants([]);
            setDealContacts([]);
            setDealTimelineEvents([]);
            setActiveDealMetadata(null);
            setDealTimelineHydrationStatus('full');
            setLoadingDealContext(true);
        }

        const loadDealWorkspaceCore = async () => {
            const dealOpenStartedAtMs = Date.now();
            const initialTimelineLimit = computeInitialMessageLimitFromViewport(estimateThreadViewportHeightPx());
            dealWorkspaceCoreInFlightRef.current.add(selectedDealId);
            dealWorkspaceInitialHydrationInFlightRef.current.add(selectedDealId);
            trackClientRequest("deal_workspace_core_load", {
                dealId: selectedDealId,
                mode: "initial_hydration",
                take: initialTimelineLimit,
            });

            try {
                const workspace = await getDealWorkspaceCore(selectedDealId, { take: initialTimelineLimit });
                if (cancelled || activeDealIdRef.current !== selectedDealId) return;
                if (!workspace?.success) {
                    throw new Error(workspace?.error || "Failed to load deal workspace core");
                }

                const initialTimelineEvents = Array.isArray(workspace.timelineEvents) ? workspace.timelineEvents : [];
                const cachedTimelineEvents = Array.isArray(cachedSnapshot?.timelineEvents) ? cachedSnapshot.timelineEvents : [];
                const mergedInitialTimelineEvents = (() => {
                    if (cachedTimelineEvents.length === 0) return initialTimelineEvents;
                    const byId = new Map<string, any>();
                    for (const event of [...cachedTimelineEvents, ...initialTimelineEvents]) {
                        const eventId = String(event?.id || "");
                        if (!eventId) continue;
                        byId.set(eventId, event);
                    }
                    const sorted = Array.from(byId.values()).sort((a, b) => {
                        const aTs = Number(new Date(a?.createdAt || 0).getTime());
                        const bTs = Number(new Date(b?.createdAt || 0).getTime());
                        if (aTs !== bTs) return aTs - bTs;
                        return String(a?.id || "").localeCompare(String(b?.id || ""));
                    });
                    const preserveCount = Math.min(
                        THREAD_TARGET_MESSAGE_COUNT,
                        Math.max(cachedTimelineEvents.length, initialTimelineEvents.length)
                    );
                    return preserveCount > 0 ? sorted.slice(-preserveCount) : sorted;
                })();

                const initialSnapshot = createDealWorkspaceCoreSnapshot({
                    dealId: selectedDealId,
                    title: workspace.deal?.title,
                    stage: workspace.deal?.stage,
                    metadata: workspace.deal?.metadata,
                    participants: Array.isArray(workspace.participants) ? workspace.participants : [],
                    timelineEvents: mergedInitialTimelineEvents,
                    hydration: createDealWorkspaceHydrationState({
                        status: mergedInitialTimelineEvents.length >= THREAD_TARGET_MESSAGE_COUNT ? 'full' : 'partial',
                        timelineEvents: mergedInitialTimelineEvents,
                        timelineWindow: workspace.timelineWindow,
                        initialCount: initialTimelineEvents.length,
                        targetCount: THREAD_TARGET_MESSAGE_COUNT,
                        requestedLimit: initialTimelineLimit,
                    }),
                });

                cacheDealWorkspaceCoreSnapshot(selectedDealId, initialSnapshot);
                applyDealWorkspaceCoreSnapshot(selectedDealId, initialSnapshot, preferredConversationId);
                setLoadingDealContext(false);

                trackClientRequest("deal_thread_open_initial", {
                    dealId: selectedDealId,
                    deal_thread_open_initial_ms: Date.now() - dealOpenStartedAtMs,
                    initial_event_count: initialTimelineEvents.length,
                    rendered_event_count: mergedInitialTimelineEvents.length,
                    requested_initial_limit: initialTimelineLimit,
                });

                const runDeferredHydration = async () => {
                    if (cancelled || activeDealIdRef.current !== selectedDealId) return;
                    if (dealWorkspaceBackfillInFlightRef.current.has(selectedDealId)) return;

                    dealWorkspaceBackfillInFlightRef.current.add(selectedDealId);
                    trackClientRequest("deal_workspace_backfill_start", { dealId: selectedDealId });
                    try {
                        let totalAdded = 0;
                        let latestSnapshot = getCachedDealWorkspaceCoreSnapshot(selectedDealId) || initialSnapshot;
                        let workingEvents = Array.isArray(latestSnapshot.timelineEvents) ? latestSnapshot.timelineEvents : [];
                        let oldestCursor = latestSnapshot.hydration?.oldestCursor || buildTimelineCursorFromEvent(workingEvents[0]);

                        while (!cancelled && activeDealIdRef.current === selectedDealId && workingEvents.length < THREAD_TARGET_MESSAGE_COUNT && oldestCursor) {
                            const needed = THREAD_TARGET_MESSAGE_COUNT - workingEvents.length;
                            const olderTimeline = await fetchDealTimeline(selectedDealId, {
                                take: needed,
                                beforeCursor: oldestCursor,
                            });
                            if (cancelled || activeDealIdRef.current !== selectedDealId) break;

                            const olderEvents = Array.isArray(olderTimeline?.events) ? olderTimeline.events : [];
                            if (olderEvents.length === 0) break;

                            const mergedEvents = mergePrependTimelineEventsDedupe(workingEvents, olderEvents);
                            const addedCount = Math.max(mergedEvents.length - workingEvents.length, 0);
                            if (addedCount <= 0) break;

                            totalAdded += addedCount;
                            workingEvents = mergedEvents;
                            oldestCursor = buildTimelineCursorFromEvent(workingEvents[0]) || oldestCursor;

                            const currentSnapshot = getCachedDealWorkspaceCoreSnapshot(selectedDealId) || latestSnapshot;
                            const nextSnapshot = createDealWorkspaceCoreSnapshot({
                                dealId: selectedDealId,
                                title: currentSnapshot.title,
                                stage: currentSnapshot.stage,
                                metadata: currentSnapshot.metadata,
                                participants: currentSnapshot.participants,
                                timelineEvents: workingEvents,
                                hydration: createDealWorkspaceHydrationState({
                                    status: workingEvents.length >= THREAD_TARGET_MESSAGE_COUNT ? 'full' : 'partial',
                                    timelineEvents: workingEvents,
                                    initialCount: currentSnapshot.hydration?.initialCount || initialSnapshot.hydration.initialCount,
                                    targetCount: THREAD_TARGET_MESSAGE_COUNT,
                                    requestedLimit: currentSnapshot.hydration?.requestedLimit || initialTimelineLimit,
                                }),
                            });
                            latestSnapshot = nextSnapshot;
                            cacheDealWorkspaceCoreSnapshot(selectedDealId, nextSnapshot);
                            applyDealWorkspaceCoreSnapshot(selectedDealId, nextSnapshot, preferredConversationId);

                            if (olderEvents.length < needed) break;
                        }

                        if (!cancelled && activeDealIdRef.current === selectedDealId) {
                            const currentSnapshot = getCachedDealWorkspaceCoreSnapshot(selectedDealId) || latestSnapshot;
                            if (currentSnapshot.hydration.status !== 'full') {
                                const finalizedSnapshot = createDealWorkspaceCoreSnapshot({
                                    dealId: selectedDealId,
                                    title: currentSnapshot.title,
                                    stage: currentSnapshot.stage,
                                    metadata: currentSnapshot.metadata,
                                    participants: currentSnapshot.participants,
                                    timelineEvents: currentSnapshot.timelineEvents,
                                    hydration: createDealWorkspaceHydrationState({
                                        status: 'full',
                                        timelineEvents: currentSnapshot.timelineEvents,
                                        initialCount: currentSnapshot.hydration.initialCount,
                                        targetCount: THREAD_TARGET_MESSAGE_COUNT,
                                        requestedLimit: currentSnapshot.hydration.requestedLimit,
                                    }),
                                });
                                cacheDealWorkspaceCoreSnapshot(selectedDealId, finalizedSnapshot);
                                applyDealWorkspaceCoreSnapshot(selectedDealId, finalizedSnapshot, preferredConversationId);
                            }
                        }

                        if (!cancelled && activeDealIdRef.current === selectedDealId) {
                            trackClientRequest("deal_thread_open_full", {
                                dealId: selectedDealId,
                                deal_thread_open_full_ms: Date.now() - dealOpenStartedAtMs,
                                initial_event_count: initialTimelineEvents.length,
                                backfill_count: totalAdded,
                            });
                        }
                    } catch (error) {
                        if (!cancelled) {
                            console.error("Deferred deal backfill failed:", error);
                        }
                    } finally {
                        dealWorkspaceBackfillInFlightRef.current.delete(selectedDealId);
                    }
                };

                scheduleDeferredHydration(() => {
                    void runDeferredHydration();
                });
            } catch (error) {
                if (cancelled) return;
                console.error("Failed to load deal workspace core:", error);
                toast({ title: "Error", description: "Failed to load deal timeline.", variant: "destructive" });
            } finally {
                dealWorkspaceCoreInFlightRef.current.delete(selectedDealId);
                dealWorkspaceInitialHydrationInFlightRef.current.delete(selectedDealId);
                if (!cancelled) {
                    setLoadingDealContext(false);
                }
            }
        };

        void loadDealWorkspaceCore();

        const dealInitialHydrationInFlight = dealWorkspaceInitialHydrationInFlightRef.current;
        const dealBackfillInFlight = dealWorkspaceBackfillInFlightRef.current;

        return () => {
            cancelled = true;
            clearDeferredHydrationTimer();
            dealInitialHydrationInFlight.delete(selectedDealId);
            dealBackfillInFlight.delete(selectedDealId);
        };
    }, [
        activeDealId,
        activeDealIdRef,
        activeIdRef,
        applyDealWorkspaceCoreSnapshot,
        cacheDealWorkspaceCoreSnapshot,
        dealWorkspaceBackfillInFlightRef,
        dealWorkspaceCoreInFlightRef,
        dealWorkspaceInitialHydrationInFlightRef,
        estimateThreadViewportHeightPx,
        getCachedDealWorkspaceCoreSnapshot,
        setActiveDealMetadata,
        setActiveDealParticipants,
        setDealContacts,
        setDealTimelineEvents,
        setDealTimelineHydrationStatus,
        setDealTimelineInitialPainted,
        setLoadingDealContext,
        trackClientRequest,
        viewMode,
    ]);

    useEffect(() => {
        if (viewMode !== 'deals' || !activeDealId || !dealTimelineInitialPainted) return;

        let cancelled = false;
        let idleHandle: number | null = null;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

        const runSidebarLoad = async () => {
            const sidebar = await loadDealWorkspaceSidebar(activeDealId, { reason: "after_initial_paint" });
            if (cancelled) return;

            const enrichmentStatus = String((sidebar as any)?.metadata?.enrichment?.status || "").trim().toLowerCase();
            const shouldPollPendingEnrichment = (
                (realtimeMode === 'disabled' || realtimeMode === 'fallback')
                && (enrichmentStatus === 'pending' || enrichmentStatus === 'processing')
            );

            if (!shouldPollPendingEnrichment) return;

            const intervalId = setInterval(() => {
                if (cancelled) return;
                void loadDealWorkspaceSidebar(activeDealId, { reason: "pending_enrichment_poll" });
            }, 5000);

            return () => clearInterval(intervalId);
        };

        let cleanupInterval: (() => void) | null = null;
        const scheduleSidebarLoad = () => {
            void runSidebarLoad().then((cleanup) => {
                cleanupInterval = cleanup || null;
            });
        };

        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
            idleHandle = (window as any).requestIdleCallback(scheduleSidebarLoad, { timeout: 1200 });
        } else {
            timeoutHandle = setTimeout(scheduleSidebarLoad, 250);
        }

        return () => {
            cancelled = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (idleHandle !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
                (window as any).cancelIdleCallback(idleHandle);
            }
            cleanupInterval?.();
        };
    }, [activeDealId, dealTimelineInitialPainted, loadDealWorkspaceSidebar, realtimeMode, viewMode]);

    return { loadDealWorkspaceSidebar };
}
