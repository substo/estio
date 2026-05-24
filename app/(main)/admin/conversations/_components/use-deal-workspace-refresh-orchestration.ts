'use client';

import { useCallback, useRef, type RefObject } from 'react';
import { ACTIVE_REFRESH_MESSAGE_LIMIT, THREAD_TARGET_MESSAGE_COUNT } from '@/lib/conversations/thread-hydration';
import { getDealWorkspaceCore } from '../../deals/actions';
import {
    createDealWorkspaceCoreSnapshot,
    createDealWorkspaceHydrationState,
    mergeLatestTimelineWindowIntoCachedEvents,
    type DealWorkspaceCoreSnapshot,
} from './use-deal-workspace-hydration';

type UseDealWorkspaceRefreshOrchestrationArgs = {
    activeDealIdRef: RefObject<string | null>;
    activeIdRef: RefObject<string | null>;
    applyDealWorkspaceCoreSnapshot: (dealId: string, snapshot: DealWorkspaceCoreSnapshot, preferredConversationId?: string | null) => void;
    cacheDealWorkspaceCoreSnapshot: (dealId: string, snapshot: DealWorkspaceCoreSnapshot) => void;
    getCachedDealWorkspaceCoreSnapshot: (dealId: string) => DealWorkspaceCoreSnapshot | null;
    isDealWorkspaceHydrationBusy: (dealId?: string | null) => boolean;
    loadDealWorkspaceSidebar: (dealId: string, options?: { reason?: string }) => Promise<any>;
    trackClientRequest: (kind: string, metadata?: Record<string, unknown>) => void;
};

type RefreshActiveDealWorkspaceOptions = {
    reason?: string;
    take?: number;
    refreshMode?: string;
    refreshSidebar?: boolean;
    hydrationSkipLogKind?: string;
};

export function useDealWorkspaceRefreshOrchestration({
    activeDealIdRef,
    activeIdRef,
    applyDealWorkspaceCoreSnapshot,
    cacheDealWorkspaceCoreSnapshot,
    getCachedDealWorkspaceCoreSnapshot,
    isDealWorkspaceHydrationBusy,
    loadDealWorkspaceSidebar,
    trackClientRequest,
}: UseDealWorkspaceRefreshOrchestrationArgs) {
    const dealWorkspaceRefreshInFlightRef = useRef<Map<string, Promise<any>>>(new Map());

    const refreshActiveDealWorkspace = useCallback((
        dealId: string,
        options?: RefreshActiveDealWorkspaceOptions
    ) => {
        const normalizedDealId = String(dealId || "").trim();
        if (!normalizedDealId) return Promise.resolve(null);

        const requestedTake = Number(options?.take);
        const take = Number.isFinite(requestedTake) && requestedTake > 0
            ? Math.min(Math.max(Math.floor(requestedTake), 1), THREAD_TARGET_MESSAGE_COUNT)
            : THREAD_TARGET_MESSAGE_COUNT;
        const refreshMode = options?.refreshMode || "active_refresh";
        const reason = options?.reason || "manual";

        if (isDealWorkspaceHydrationBusy(normalizedDealId)) {
            trackClientRequest(options?.hydrationSkipLogKind || "deal_active_poll_skipped_hydration", {
                dealId: normalizedDealId,
                refreshMode,
                take,
                requestedTake: take,
                skipReason: "workspace_hydration",
            });
            return Promise.resolve(null);
        }

        const existingRefresh = dealWorkspaceRefreshInFlightRef.current.get(normalizedDealId);
        if (existingRefresh) {
            trackClientRequest("deal_workspace_refresh", {
                dealId: normalizedDealId,
                reason,
                refreshMode,
                take,
                requestedTake: take,
                skipReason: "deal_workspace_refresh_inflight",
            });
            return existingRefresh;
        }

        trackClientRequest("deal_workspace_refresh", {
            dealId: normalizedDealId,
            reason,
            refreshMode,
            take,
            requestedTake: take,
        });

        const refreshPromise = (async () => {
            try {
                const workspace = await getDealWorkspaceCore(normalizedDealId, { take });
                if (!workspace?.success) return workspace;
                if (activeDealIdRef.current !== normalizedDealId) return workspace;

                const latestTimelineEvents = Array.isArray(workspace.timelineEvents) ? workspace.timelineEvents : [];
                const cachedSnapshot = getCachedDealWorkspaceCoreSnapshot(normalizedDealId);
                const cachedTimelineEvents = Array.isArray(cachedSnapshot?.timelineEvents)
                    ? cachedSnapshot.timelineEvents
                    : [];
                const timelineEvents = mergeLatestTimelineWindowIntoCachedEvents(cachedTimelineEvents, latestTimelineEvents);

                trackClientRequest("deal_workspace_refresh_result", {
                    dealId: normalizedDealId,
                    reason,
                    refreshMode,
                    take,
                    requestedTake: take,
                    returnedEventCount: latestTimelineEvents.length,
                });

                const snapshot = createDealWorkspaceCoreSnapshot({
                    dealId: normalizedDealId,
                    title: workspace.deal?.title,
                    stage: workspace.deal?.stage,
                    metadata: workspace.deal?.metadata,
                    participants: Array.isArray(workspace.participants) ? workspace.participants : [],
                    timelineEvents,
                    hydration: createDealWorkspaceHydrationState({
                        status: 'full',
                        timelineEvents,
                        timelineWindow: workspace.timelineWindow,
                        initialCount: timelineEvents.length,
                        targetCount: THREAD_TARGET_MESSAGE_COUNT,
                        requestedLimit: take,
                    }),
                });
                cacheDealWorkspaceCoreSnapshot(normalizedDealId, snapshot);
                applyDealWorkspaceCoreSnapshot(normalizedDealId, snapshot, activeIdRef.current);

                if (options?.refreshSidebar) {
                    void loadDealWorkspaceSidebar(normalizedDealId, { reason });
                }

                return workspace;
            } catch (error) {
                console.error("Failed to refresh deal workspace:", error);
                return null;
            }
        })();

        dealWorkspaceRefreshInFlightRef.current.set(normalizedDealId, refreshPromise);
        void refreshPromise.finally(() => {
            if (dealWorkspaceRefreshInFlightRef.current.get(normalizedDealId) === refreshPromise) {
                dealWorkspaceRefreshInFlightRef.current.delete(normalizedDealId);
            }
        }).catch(() => undefined);

        return refreshPromise;
    }, [
        activeDealIdRef,
        activeIdRef,
        applyDealWorkspaceCoreSnapshot,
        cacheDealWorkspaceCoreSnapshot,
        getCachedDealWorkspaceCoreSnapshot,
        isDealWorkspaceHydrationBusy,
        loadDealWorkspaceSidebar,
        trackClientRequest,
    ]);

    const isDealWorkspaceRefreshBusy = useCallback((dealId?: string | null) => {
        const normalizedDealId = String(dealId || "").trim();
        if (!normalizedDealId) return false;
        return dealWorkspaceRefreshInFlightRef.current.has(normalizedDealId);
    }, []);

    return { refreshActiveDealWorkspace, isDealWorkspaceRefreshBusy };
}

export { ACTIVE_REFRESH_MESSAGE_LIMIT as ACTIVE_DEAL_REFRESH_EVENT_LIMIT };
