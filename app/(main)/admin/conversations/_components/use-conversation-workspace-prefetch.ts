'use client';

import { useCallback, useEffect, type RefObject } from 'react';
import type { Conversation } from '@/lib/ghl/conversations';
import { getConversationWorkspaceCore, getConversationWorkspaceSidebar } from '../actions';
import { getDealWorkspaceCore } from '../../deals/actions';
import { THREAD_TARGET_MESSAGE_COUNT, computeInitialMessageLimitFromViewport } from '@/lib/conversations/thread-hydration';
import { createWorkspaceCoreSnapshot, createWorkspaceHydrationState, type WorkspaceCoreSnapshot } from '@/lib/conversations/workspace-state';
import { createDealWorkspaceCoreSnapshot, createDealWorkspaceHydrationState, type DealWorkspaceCoreSnapshot } from './use-deal-workspace-hydration';
import type { WorkspaceSidebarSnapshot } from './use-chat-workspace-hydration';

const BACKGROUND_PREFETCH_LIMIT = 1;

type UseConversationWorkspacePrefetchArgs = {
    viewMode: 'chats' | 'deals';
    activeId: string | null;
    activeDealId: string | null;
    conversations: Conversation[];
    deals: any[];
    activeIdRef: RefObject<string | null>;
    activeDealIdRef: RefObject<string | null>;
    workspaceCoreInFlightRef: RefObject<Set<string>>;
    workspaceSidebarInFlightRef: RefObject<Set<string>>;
    dealWorkspaceCoreInFlightRef: RefObject<Set<string>>;
    isWorkspaceHydrationBusy: (conversationId?: string | null) => boolean;
    isConversationWorkspaceRefreshBusy: (conversationId?: string | null) => boolean;
    isDealWorkspaceHydrationBusy: (dealId?: string | null) => boolean;
    isDealWorkspaceRefreshBusy: (dealId?: string | null) => boolean;
    cacheWorkspaceCoreSnapshot: (conversationId: string, snapshot: WorkspaceCoreSnapshot) => void;
    getCachedWorkspaceCoreSnapshot: (conversationId: string) => WorkspaceCoreSnapshot | null;
    cacheWorkspaceSidebarSnapshot: (conversationId: string, snapshot: WorkspaceSidebarSnapshot) => void;
    getCachedWorkspaceSidebarSnapshot: (conversationId: string) => WorkspaceSidebarSnapshot | null;
    cacheDealWorkspaceCoreSnapshot: (dealId: string, snapshot: DealWorkspaceCoreSnapshot) => void;
    getCachedDealWorkspaceCoreSnapshot: (dealId: string) => DealWorkspaceCoreSnapshot | null;
    trackClientRequest: (kind: string, metadata?: Record<string, unknown>) => void;
    estimateThreadViewportHeightPx: () => number | null;
    workspaceActivityLimit: number;
};

export function useConversationWorkspacePrefetch({
    viewMode,
    activeId,
    activeDealId,
    conversations,
    deals,
    activeIdRef,
    activeDealIdRef,
    workspaceCoreInFlightRef,
    workspaceSidebarInFlightRef,
    dealWorkspaceCoreInFlightRef,
    isWorkspaceHydrationBusy,
    isConversationWorkspaceRefreshBusy,
    isDealWorkspaceHydrationBusy,
    isDealWorkspaceRefreshBusy,
    cacheWorkspaceCoreSnapshot,
    getCachedWorkspaceCoreSnapshot,
    cacheWorkspaceSidebarSnapshot,
    getCachedWorkspaceSidebarSnapshot,
    cacheDealWorkspaceCoreSnapshot,
    getCachedDealWorkspaceCoreSnapshot,
    trackClientRequest,
    estimateThreadViewportHeightPx,
    workspaceActivityLimit,
}: UseConversationWorkspacePrefetchArgs) {
    const isActiveChatWorkspaceBusy = useCallback(() => {
        const selectedConversationId = activeIdRef.current;
        return !!selectedConversationId && (
            isWorkspaceHydrationBusy(selectedConversationId)
            || isConversationWorkspaceRefreshBusy(selectedConversationId)
        );
    }, [activeIdRef, isConversationWorkspaceRefreshBusy, isWorkspaceHydrationBusy]);

    const isActiveDealWorkspaceBusy = useCallback(() => {
        const selectedDealId = activeDealIdRef.current;
        return !!selectedDealId && (
            isDealWorkspaceHydrationBusy(selectedDealId)
            || isDealWorkspaceRefreshBusy(selectedDealId)
        );
    }, [activeDealIdRef, isDealWorkspaceHydrationBusy, isDealWorkspaceRefreshBusy]);

    const prefetchWorkspaceCore = useCallback(async (conversationId: string) => {
        const normalizedConversationId = String(conversationId || "").trim();
        if (!normalizedConversationId) return;
        if (isActiveChatWorkspaceBusy()) {
            trackClientRequest("workspace_core_prefetch", { conversationId: normalizedConversationId, reason: "active_workspace_busy" });
            return;
        }
        if (getCachedWorkspaceCoreSnapshot(normalizedConversationId)) {
            trackClientRequest("workspace_core_prefetch", { conversationId: normalizedConversationId, reason: "cache_hit" });
            return;
        }
        if (workspaceCoreInFlightRef.current.has(normalizedConversationId)) {
            trackClientRequest("workspace_core_prefetch", { conversationId: normalizedConversationId, reason: "prefetch_inflight" });
            return;
        }

        workspaceCoreInFlightRef.current.add(normalizedConversationId);
        try {
            trackClientRequest("workspace_core_prefetch", { conversationId: normalizedConversationId });
            const prefetchedLimit = computeInitialMessageLimitFromViewport(estimateThreadViewportHeightPx());
            const workspace = await getConversationWorkspaceCore(normalizedConversationId, {
                includeMessages: true,
                includeActivity: false,
                messageLimit: prefetchedLimit,
                activityLimit: workspaceActivityLimit,
                messageMetadataMode: "firstPaint",
                refreshMode: "prefetch",
            });
            if (!workspace?.success) return;

            const prefetchedMessages = Array.isArray(workspace?.messages) ? workspace.messages : [];
            const hydration = createWorkspaceHydrationState({
                status: prefetchedMessages.length >= THREAD_TARGET_MESSAGE_COUNT ? 'full' : 'partial',
                messages: prefetchedMessages,
                messageWindow: workspace?.messageWindow,
                initialCount: prefetchedMessages.length,
                targetCount: THREAD_TARGET_MESSAGE_COUNT,
                requestedLimit: prefetchedLimit,
            });
            cacheWorkspaceCoreSnapshot(normalizedConversationId, createWorkspaceCoreSnapshot({
                conversationHeader: workspace?.conversationHeader || null,
                messages: prefetchedMessages,
                activityTimeline: [],
                transcriptEligibility: workspace?.transcriptEligibility,
                hydration,
            }));
        } catch (error) {
            console.error("Workspace prefetch failed:", error);
        } finally {
            workspaceCoreInFlightRef.current.delete(normalizedConversationId);
        }
    }, [cacheWorkspaceCoreSnapshot, estimateThreadViewportHeightPx, getCachedWorkspaceCoreSnapshot, isActiveChatWorkspaceBusy, trackClientRequest, workspaceActivityLimit, workspaceCoreInFlightRef]);

    const prefetchWorkspaceSidebar = useCallback(async (conversationId: string) => {
        const normalizedConversationId = String(conversationId || "").trim();
        if (!normalizedConversationId) return;
        if (isActiveChatWorkspaceBusy()) {
            trackClientRequest("workspace_sidebar_prefetch", { conversationId: normalizedConversationId, reason: "active_workspace_busy" });
            return;
        }
        if (getCachedWorkspaceSidebarSnapshot(normalizedConversationId)) {
            trackClientRequest("workspace_sidebar_prefetch", { conversationId: normalizedConversationId, reason: "cache_hit" });
            return;
        }
        if (workspaceSidebarInFlightRef.current.has(normalizedConversationId)) {
            trackClientRequest("workspace_sidebar_prefetch", { conversationId: normalizedConversationId, reason: "prefetch_inflight" });
            return;
        }

        workspaceSidebarInFlightRef.current.add(normalizedConversationId);
        try {
            trackClientRequest("workspace_sidebar_prefetch", { conversationId: normalizedConversationId });
            const sidebar = await getConversationWorkspaceSidebar(normalizedConversationId);
            if (!sidebar?.success) return;
            cacheWorkspaceSidebarSnapshot(normalizedConversationId, {
                contactContext: sidebar.contactContext || null,
                taskSummary: sidebar.taskSummary || null,
                viewingSummary: sidebar.viewingSummary || null,
                agentSummary: sidebar.agentSummary || null,
            });
        } catch (error) {
            console.error("Workspace sidebar prefetch failed:", error);
        } finally {
            workspaceSidebarInFlightRef.current.delete(normalizedConversationId);
        }
    }, [cacheWorkspaceSidebarSnapshot, getCachedWorkspaceSidebarSnapshot, isActiveChatWorkspaceBusy, trackClientRequest, workspaceSidebarInFlightRef]);

    const prefetchDealWorkspaceCore = useCallback(async (dealId: string) => {
        const normalizedDealId = String(dealId || "").trim();
        if (!normalizedDealId) return;
        if (isActiveDealWorkspaceBusy()) {
            trackClientRequest("deal_workspace_core_prefetch", { dealId: normalizedDealId, reason: "active_workspace_busy" });
            return;
        }
        if (getCachedDealWorkspaceCoreSnapshot(normalizedDealId)) {
            trackClientRequest("deal_workspace_core_prefetch", { dealId: normalizedDealId, reason: "cache_hit" });
            return;
        }
        if (dealWorkspaceCoreInFlightRef.current.has(normalizedDealId)) {
            trackClientRequest("deal_workspace_core_prefetch", { dealId: normalizedDealId, reason: "prefetch_inflight" });
            return;
        }

        dealWorkspaceCoreInFlightRef.current.add(normalizedDealId);
        try {
            trackClientRequest("deal_workspace_core_prefetch", { dealId: normalizedDealId });
            const prefetchedLimit = computeInitialMessageLimitFromViewport(estimateThreadViewportHeightPx());
            const workspace = await getDealWorkspaceCore(normalizedDealId, { take: prefetchedLimit });
            if (!workspace?.success) return;

            const timelineEvents = Array.isArray(workspace.timelineEvents) ? workspace.timelineEvents : [];
            const hydration = createDealWorkspaceHydrationState({
                status: timelineEvents.length >= THREAD_TARGET_MESSAGE_COUNT ? 'full' : 'partial',
                timelineEvents,
                timelineWindow: workspace.timelineWindow,
                initialCount: timelineEvents.length,
                targetCount: THREAD_TARGET_MESSAGE_COUNT,
                requestedLimit: prefetchedLimit,
            });
            cacheDealWorkspaceCoreSnapshot(normalizedDealId, createDealWorkspaceCoreSnapshot({
                dealId: normalizedDealId,
                title: workspace.deal?.title,
                stage: workspace.deal?.stage,
                metadata: workspace.deal?.metadata,
                participants: Array.isArray(workspace.participants) ? workspace.participants : [],
                timelineEvents,
                hydration,
            }));
        } catch (error) {
            console.error("Deal workspace prefetch failed:", error);
        } finally {
            dealWorkspaceCoreInFlightRef.current.delete(normalizedDealId);
        }
    }, [cacheDealWorkspaceCoreSnapshot, dealWorkspaceCoreInFlightRef, estimateThreadViewportHeightPx, getCachedDealWorkspaceCoreSnapshot, isActiveDealWorkspaceBusy, trackClientRequest]);

    useEffect(() => {
        if (viewMode !== 'chats') return;
        if (activeId && !getCachedWorkspaceCoreSnapshot(activeId)) return;
        if (activeId && isActiveChatWorkspaceBusy()) return;

        const candidateIds = conversations
            .filter((conversation) => conversation.id !== activeId)
            .slice(0, BACKGROUND_PREFETCH_LIMIT)
            .map((conversation) => conversation.id);

        if (candidateIds.length === 0) return;

        let cancelled = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        let idleHandle: number | null = null;

        const runPrefetch = () => {
            if (cancelled) return;
            for (const conversationId of candidateIds) {
                void prefetchWorkspaceCore(conversationId);
                void prefetchWorkspaceSidebar(conversationId);
            }
        };

        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
            idleHandle = (window as any).requestIdleCallback(runPrefetch, { timeout: 1200 });
        } else {
            timeoutHandle = setTimeout(runPrefetch, 350);
        }

        return () => {
            cancelled = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (idleHandle !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
                (window as any).cancelIdleCallback(idleHandle);
            }
        };
    }, [activeId, conversations, getCachedWorkspaceCoreSnapshot, isActiveChatWorkspaceBusy, prefetchWorkspaceCore, prefetchWorkspaceSidebar, viewMode]);

    useEffect(() => {
        if (viewMode !== 'deals') return;

        const candidateIds = deals
            .filter((deal) => deal?.id && deal.id !== activeDealId)
            .slice(0, BACKGROUND_PREFETCH_LIMIT)
            .map((deal) => deal.id);

        if (candidateIds.length === 0) return;

        let cancelled = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        let idleHandle: number | null = null;

        const runPrefetch = () => {
            if (cancelled) return;
            for (const dealId of candidateIds) {
                void prefetchDealWorkspaceCore(dealId);
            }
        };

        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
            idleHandle = (window as any).requestIdleCallback(runPrefetch, { timeout: 1200 });
        } else {
            timeoutHandle = setTimeout(runPrefetch, 350);
        }

        return () => {
            cancelled = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (idleHandle !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
                (window as any).cancelIdleCallback(idleHandle);
            }
        };
    }, [activeDealId, deals, prefetchDealWorkspaceCore, viewMode]);

    return {
        prefetchWorkspaceCore,
        prefetchWorkspaceSidebar,
        prefetchDealWorkspaceCore,
    };
}
