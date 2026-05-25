'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Conversation, Message } from '@/lib/ghl/conversations';
import type { ContactIdentityPatch } from '../../contacts/_components/contact-form';
import {
    fetchConversations,
    fetchMessages,
    getConversationWorkspaceSidebar,
    refreshConversationOnDemand,
    sendReply,
    createWhatsAppMediaUploadUrl,
    sendWhatsAppMediaReply,
    generateAIDraft,
    setConversationReplyLanguageOverride,
    translateConversationMessage,
    translateConversationThread,
    previewTranslatedReply,
    deleteConversations,
    restoreConversations,
    archiveConversations,
    unarchiveConversations,
    permanentlyDeleteConversations,
    emptyTrash,
    syncWhatsAppHistory,
    refreshConversation,
    markConversationAsRead,
    refetchWhatsAppMediaAttachment,
    retryWhatsAppAudioTranscript,
    requestWhatsAppAudioTranscript,
    bulkRequestWhatsAppAudioTranscripts,
    extractWhatsAppViewingNotes,
    searchConversations,
    addConversationActivityEntry,
} from '../actions';
import { toast } from '@/components/ui/use-toast';
import {
    createPersistentDeal,
    getDealContexts,
} from '../../deals/actions';
import {
    appendConversationPageFromResponse as appendConversationPageStateFromResponse,
    applyConversationDeltaPayload as applyConversationDeltaListPayload,
    deriveConversationListPageInfo,
    replaceConversationListFromResponse as replaceConversationListStateFromResponse,
} from '@/lib/conversations/list-state';
import {
    getWorkspaceCoreCacheEntry,
    setWorkspaceCoreCacheEntry,
} from '@/lib/conversations/workspace-core-cache';
import {
    THREAD_INITIAL_FALLBACK_MESSAGES,
    THREAD_REFRESH_MESSAGES_OPTIONS,
    THREAD_TARGET_MESSAGE_COUNT,
} from '@/lib/conversations/thread-hydration';
import {
    collectPendingMessagesForConversation,
    isWorkspaceRefreshBusy,
    mergeSnapshotPreservingPendingMessages,
    type WorkspaceCoreSnapshot,
    type WorkspaceHydrationState,
    type WorkspaceHydrationStatus,
} from '@/lib/conversations/workspace-state';
import { ConversationList } from './conversation-list';
import { ChatWorkspacePane } from './chat-workspace-pane';
import { DealWorkspacePane } from './deal-workspace-pane';
import { UndoToast } from './undo-toast';
import { WhatsAppImportModal } from './whatsapp-import-modal';
import { CreateDealDialog } from './create-deal-dialog';
import { SyncAllChatsDialog } from './sync-all-chats-dialog';
import { NewConversationDialog } from './new-conversation-dialog';
import { useSuggestedResponseQueue } from './use-suggested-response-queue';
import { useMobileConversationPanes, type MobilePane } from './use-mobile-conversation-panes';
import { useConversationComposerDrafts } from './use-conversation-composer-drafts';
import {
    applyConversationIdentityPatch,
    applyDealContactIdentityPatch,
    applyRefreshedConversationIdentityPatch,
    applyRefreshedDealContactIdentityPatch,
    applyRefreshedWorkspaceContactContextIdentityPatch,
    applyWorkspaceContactContextIdentityPatch,
    normalizeConversationContactIdentityPatch,
    type DealContactOption,
} from './conversation-contact-identity-actions';
import { generateDraftWithStreamingFallback } from './conversation-draft-generation';
import {
    getMessageSignature,
    getTranscriptActionModeLabel,
    refreshMessagesAfterTranscriptAction,
    runTranscriptAction,
} from './conversation-transcript-actions';
import {
    appendOptimisticMessage,
    applyResendAckById,
    applySendAckByCorrelation,
    buildOptimisticMediaMessage,
    buildOptimisticTextMessage,
    createOutboundClientMessageId,
    getSendAckState,
    markMessageFailedById,
    markMessageSendingById,
    normalizeSendError,
} from './conversation-message-actions';
import { applyRealtimeMessagePatchToMessages } from './conversation-realtime-message-actions';
import {
    applyMessageTranslation,
    applyReplyLanguageOverrideToConversations,
    getConversationMessageType,
} from './conversation-translation-actions';
import {
    applyVisibleConversationSelection,
    collectConversationsByIds,
    removeConversationsByIds,
    resolveSelectedConversations,
    shouldClearActiveConversation,
    shouldExitSelectionModeAfterBulkAction,
    toggleConversationSelection,
} from './conversation-bulk-actions';
import {
    removeMergedSourceConversation,
    resolvePostMergeActiveConversationId,
} from './conversation-merge-ui-actions';
import {
    buildContactContextShell,
    mergeActivityTimelineEntries,
    patchWorkspaceCoreSnapshotActivityEntry,
    type ActivityTimelineItem,
} from './conversation-workspace-ui-actions';
import {
    useChatWorkspaceHydration,
    type WorkspaceSidebarSnapshot,
} from './use-chat-workspace-hydration';
import {
    createDealWorkspaceCoreSnapshot,
    createDealWorkspaceHydrationState,
    useDealWorkspaceHydration,
    type DealWorkspaceCoreSnapshot,
} from './use-deal-workspace-hydration';
import {
    ACTIVE_DEAL_REFRESH_EVENT_LIMIT,
    useDealWorkspaceRefreshOrchestration,
} from './use-deal-workspace-refresh-orchestration';
import { useConversationRefreshOrchestration } from './use-conversation-refresh-orchestration';
import { useConversationWorkspacePrefetch } from './use-conversation-workspace-prefetch';
import { useConversationRealtimeEvents } from './use-conversation-realtime-events';
import {
    buildDealContactOptions,
    chooseNextDealConversationId,
    resolveDealTitle,
    resolveSelectedConversationsForDeal,
    resolveSelectedDealConversation,
} from './conversation-deal-actions';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import type { ConversationFeatureFlags } from '@/lib/feature-flags';

const CoordinatorPanel = dynamic(
    () => import('./coordinator-panel').then((mod) => mod.CoordinatorPanel),
    {
        loading: () => <div className="h-full animate-pulse bg-slate-50" />,
    }
);


interface ConversationInterfaceProps {
    locationId: string;
    initialConversations: Conversation[];
    initialConversationListPageInfo?: {
        hasMore: boolean;
        nextCursor: string | null;
        deltaCursor?: string | null;
    };
    initialDeals?: any[];
    featureFlags: ConversationFeatureFlags;
}

const WORKSPACE_CACHE_LIMIT = 30;
const WORKSPACE_CORE_CACHE_TTL_MS = 2 * 60 * 1000;
const WORKSPACE_SIDEBAR_CACHE_TTL_MS = 5 * 60 * 1000;
const WORKSPACE_ACTIVITY_LIMIT = 180;
const ACTIVE_POLL_GRACE_MS = 2500;

function estimateThreadViewportHeightPx(): number | null {
    if (typeof window === 'undefined') return null;
    const viewportHeight = Number(window.innerHeight);
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return null;
    // Approximate header/composer/padding chrome to derive visible thread area.
    return Math.max(viewportHeight - 280, 320);
}

export function ConversationInterface({ locationId, initialConversations, initialConversationListPageInfo, initialDeals, featureFlags }: ConversationInterfaceProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const searchParamsString = searchParams?.toString() || "";
    const getSearchParam = (key: string) => searchParams?.get(key) || null;

    const updateUrl = useCallback((updates: Record<string, string | null>) => {
        let params: URLSearchParams;
        let nextPathname = pathname || '/admin/conversations';

        if (typeof window !== 'undefined') {
            const currentUrl = new URL(window.location.href);
            params = new URLSearchParams(currentUrl.search);
            nextPathname = currentUrl.pathname;
        } else {
            params = new URLSearchParams(searchParamsString);
        }

        Object.entries(updates).forEach(([key, value]) => {
            if (value === null) {
                params.delete(key);
            } else {
                params.set(key, value);
            }
        });

        const query = params.toString();
        const nextHref = query ? `${nextPathname}?${query}` : nextPathname;

        if (featureFlags.shallowUrlSync && typeof window !== 'undefined') {
            window.history.replaceState(window.history.state, '', nextHref);
            return;
        }

        router.replace(nextHref, { scroll: false });
    }, [featureFlags.shallowUrlSync, pathname, router, searchParamsString]);

    // Initialize state from URL or props
    // Map URL 'inbox' to internal 'active' if needed, but 'active' is the internal string. 
    // Let's support 'inbox' in URL for user friendliness
    const urlView = getSearchParam('view');
    const normalizedViewFilter = (urlView === 'inbox' ? 'active' : urlView) as 'active' | 'archived' | 'trash' | 'tasks' || 'active';

    const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
    const conversationsRef = useRef<Conversation[]>(initialConversations);
    const [messages, setMessages] = useState<Message[]>([]);
    const messagesRef = useRef<Message[]>([]);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [chatTimelineInitialPainted, setChatTimelineInitialPainted] = useState(false);
    const messageSignatureRef = useRef<string>('0');
    const [activityLog, setActivityLog] = useState<any[]>([]);
    const activityLogRef = useRef<any[]>([]);
    const [conversationListHasMore, setConversationListHasMore] = useState<boolean>(!!initialConversationListPageInfo?.hasMore);
    const [conversationListNextCursor, setConversationListNextCursor] = useState<string | null>(initialConversationListPageInfo?.nextCursor || null);
    const [conversationDeltaCursor, setConversationDeltaCursor] = useState<string | null>(initialConversationListPageInfo?.deltaCursor || null);
    const conversationDeltaCursorRef = useRef<string | null>(initialConversationListPageInfo?.deltaCursor || null);
    const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
    const loadingMoreConversationsRef = useRef(false);
    const contactSaveRefreshSeqRef = useRef<Record<string, number>>({});
    const backgroundSyncByConversationRef = useRef<Record<string, number>>({});
    const [isTabVisible, setIsTabVisible] = useState(true);
    const [workspaceContactContext, setWorkspaceContactContext] = useState<any>(null);
    const [workspaceTaskSummary, setWorkspaceTaskSummary] = useState<any>(null);
    const [workspaceViewingSummary, setWorkspaceViewingSummary] = useState<any>(null);
    const [workspaceAgentSummary, setWorkspaceAgentSummary] = useState<any>(null);
    const clientRequestCountRef = useRef<Record<string, number>>({});
    const workspaceCoreCacheRef = useRef<Map<string, any>>(new Map());
    const workspaceSidebarCacheRef = useRef<Map<string, any>>(new Map());
    const workspaceCoreInFlightRef = useRef<Set<string>>(new Set());
    const workspaceSidebarInFlightRef = useRef<Set<string>>(new Set());
    const workspaceInitialHydrationInFlightRef = useRef<Set<string>>(new Set());
    const workspaceBackfillInFlightRef = useRef<Set<string>>(new Set());
    const workspaceActivityHydrationInFlightRef = useRef<Set<string>>(new Set());
    const workspaceMessageMetadataInFlightRef = useRef<Set<string>>(new Set());
    const initialWorkspaceLoadedAtRef = useRef<Record<string, number>>({});
    const [realtimeMode, setRealtimeMode] = useState<'disabled' | 'connecting' | 'connected' | 'fallback'>(
        featureFlags.realtimeSse ? 'connecting' : 'disabled'
    );
    const realtimeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const readResetInFlightRef = useRef<Set<string>>(new Set());
    const pendingOutboundByConversationRef = useRef<Map<string, Map<string, Message>>>(new Map());
    const selectedConversationCacheRef = useRef<Map<string, Conversation>>(
        new Map(initialConversations.filter((conversation) => !!conversation?.id).map((conversation) => [conversation.id, conversation]))
    );

    // Initialize Active ID from URL
    const requestedInitialActiveId = getSearchParam('id');
    const initialActiveId = requestedInitialActiveId
        ? (initialConversations.find((conversation: any) =>
            conversation.id === requestedInitialActiveId
            || conversation.legacyConversationId === requestedInitialActiveId
            || conversation.ghlConversationId === requestedInitialActiveId
            || conversation.providerConversationId === requestedInitialActiveId
        )?.id || requestedInitialActiveId)
        : null;
    const initialTaskId = getSearchParam('task');
    const [activeId, setActiveId] = useState<string | null>(initialActiveId);
    const activeIdRef = useRef<string | null>(initialActiveId);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId);

    // View Mode State (inbox, archived, trash)
    const [viewFilter, setViewFilter] = useState<'active' | 'archived' | 'trash' | 'tasks'>(normalizedViewFilter);

    // Deal Mode State
    const initialViewMode = (getSearchParam('mode') as 'chats' | 'deals') || 'chats';
    const [viewMode, setViewMode] = useState<'chats' | 'deals'>(initialViewMode);

    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<Conversation[]>([]);
    const searchRequestIdRef = useRef(0);

    const [deals, setDeals] = useState<any[]>(initialDeals || []);
    const [activeDealParticipants, setActiveDealParticipants] = useState<Conversation[]>([]);
    const [dealContacts, setDealContacts] = useState<DealContactOption[]>([]);
    const [loadingDealContext, setLoadingDealContext] = useState(false);
    const [dealTimelineEvents, setDealTimelineEvents] = useState<any[]>([]);
    const [activeDealMetadata, setActiveDealMetadata] = useState<any>(null);
    const [dealTimelineHydrationStatus, setDealTimelineHydrationStatus] = useState<WorkspaceHydrationStatus>('full');
    const [dealTimelineInitialPainted, setDealTimelineInitialPainted] = useState(false);
    const dealWorkspaceCoreCacheRef = useRef<Map<string, any>>(new Map());
    const dealWorkspaceCoreInFlightRef = useRef<Set<string>>(new Set());
    const dealWorkspaceInitialHydrationInFlightRef = useRef<Set<string>>(new Set());
    const dealWorkspaceBackfillInFlightRef = useRef<Set<string>>(new Set());
    const dealWorkspaceSidebarInFlightRef = useRef<Set<string>>(new Set());
    const activeDealIdRef = useRef<string | null>(null);

    // Global Search Effect
    useEffect(() => {
        const requestId = searchRequestIdRef.current + 1;
        searchRequestIdRef.current = requestId;
        const normalizedSearchQuery = searchQuery.trim();

        if (!normalizedSearchQuery) {
            setSearchResults([]);
            setIsSearching(false);
            return;
        }

        let isCancelled = false;
        setIsSearching(true);

        searchConversations(normalizedSearchQuery, { limit: 50 })
            .then(res => {
                if (isCancelled || searchRequestIdRef.current !== requestId) return;
                if (res.success) {
                    setSearchResults(res.conversations || []);
                } else {
                    toast({ title: "Search Failed", description: String(res.error), variant: "destructive" });
                    setSearchResults([]);
                }
            })
            .catch(err => {
                if (isCancelled || searchRequestIdRef.current !== requestId) return;
                console.error("Search failed:", err);
                toast({ title: "Error", description: "Search failed.", variant: "destructive" });
            })
            .finally(() => {
                if (!isCancelled && searchRequestIdRef.current === requestId) setIsSearching(false);
            });

        return () => {
            isCancelled = true;
        };
    }, [searchQuery]);

    const initialDealId = getSearchParam('dealId');
    const initialUrlConversationId = getSearchParam('id');
    const [urlConversationId, setUrlConversationId] = useState<string | null>(initialUrlConversationId);
    const urlConversationIdRef = useRef<string | null>(urlConversationId);
    
    useEffect(() => {
        urlConversationIdRef.current = urlConversationId;
    }, [urlConversationId]);

    const [activeDealId, setActiveDealId] = useState<string | null>(initialDealId);
    const [transcriptOnDemandEnabled, setTranscriptOnDemandEnabled] = useState(false);
    const {
        composerInsertSeed,
        getComposerDraft,
        setComposerDraftForConversation,
        clearComposerDraftForConversation,
        insertSuggestedResponseIntoComposer,
    } = useConversationComposerDrafts({
        activeConversationIdRef: activeIdRef,
        resetKey: `${viewMode}:${activeId || ""}:${activeDealId || ""}`,
    });

    const hasActiveConversationForMobile = activeId
        ? !!(
            conversations.find((conversation) => conversation.id === activeId)
            || searchResults.find((conversation) => conversation.id === activeId)
            || selectedConversationCacheRef.current.get(activeId)
        )
        : false;
    const {
        isMobileViewport,
        mobilePane,
        setMobilePane,
        currentMobilePane,
        mobilePaneHint,
        mobilePaneContainerRef,
        mobilePaneHostRef,
        handleMobileTouchStart,
        handleMobileTouchMove,
        handleMobileTouchEnd,
    } = useMobileConversationPanes({
        viewMode,
        activeId,
        activeDealId,
        urlConversationId,
        activeConversationOpen: hasActiveConversationForMobile,
    });

    const [loadedDealId, setLoadedDealId] = useState<string | null>(null);
    const [loadedChatId, setLoadedChatId] = useState<string | null>(null);

    const isDealLoading = loadingDealContext || (!!activeDealId && activeDealId !== loadedDealId);
    const isChatLoading = loadingMessages || (!!activeId && activeId !== loadedChatId);

    useEffect(() => {
        activeDealIdRef.current = activeDealId;
    }, [activeDealId]);

    useEffect(() => {
        if (!featureFlags.shallowUrlSync) return;
        if (typeof window === 'undefined') return;

        const handlePopState = () => {
            const params = new URLSearchParams(window.location.search);
            const rawView = params.get('view');
            const normalizedView =
                rawView === 'inbox' ||
                rawView === 'active' ||
                rawView === 'archived' ||
                rawView === 'trash' ||
                rawView === 'tasks'
                    ? rawView === 'inbox'
                        ? 'active'
                        : rawView
                    : 'active';
            const nextId = params.get('id');
            const nextTaskId = params.get('task');
            const nextMode = (params.get('mode') as 'chats' | 'deals') || 'chats';
            const nextDealId = params.get('dealId');

            setUrlConversationId(nextId);
            setSelectedTaskId(nextTaskId);
            setViewMode(nextMode);
            setActiveDealId(nextDealId);
            setViewFilter(
                normalizedView === 'archived' || normalizedView === 'trash' || normalizedView === 'tasks'
                    ? normalizedView
                    : 'active'
            );
            setActiveId(nextId);
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [featureFlags.shallowUrlSync]);

    useEffect(() => {
        if (!isMobileViewport) return;
        if (viewMode === 'deals') return;
        if (urlConversationId) return;
        if (!activeIdRef.current) return;
        setActiveId(null);
    }, [isMobileViewport, viewMode, urlConversationId]);

    // Sync View Mode & Deal ID to URL
    useEffect(() => {
        updateUrl({
            mode: viewMode === 'chats' ? null : 'deals',
            dealId: activeDealId
        });
    }, [viewMode, activeDealId, updateUrl]);

    // Sync View Filter & Active ID to URL
    useEffect(() => {
        const view = viewFilter === 'active' ? null : viewFilter;
        updateUrl({
            view,
            id: activeId,
            task: viewFilter === 'tasks' ? selectedTaskId : null,
        });
        setUrlConversationId(activeId);
    }, [viewFilter, activeId, selectedTaskId, updateUrl]);

    useEffect(() => {
        if (viewFilter === 'tasks') return;
        if (!selectedTaskId) return;
        setSelectedTaskId(null);
    }, [viewFilter, selectedTaskId]);

    useEffect(() => {
        activeIdRef.current = activeId;
    }, [activeId]);

    useEffect(() => {
        conversationsRef.current = conversations;
    }, [conversations]);

    const cacheSelectedConversations = useCallback((items: Conversation[]) => {
        for (const item of items) {
            if (!item?.id) continue;
            selectedConversationCacheRef.current.set(item.id, item);
        }
    }, []);

    useEffect(() => {
        cacheSelectedConversations(conversations);
    }, [cacheSelectedConversations, conversations]);

    useEffect(() => {
        cacheSelectedConversations(searchResults);
    }, [cacheSelectedConversations, searchResults]);

    useEffect(() => {
        cacheSelectedConversations(activeDealParticipants);
    }, [activeDealParticipants, cacheSelectedConversations]);

    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    useEffect(() => {
        activityLogRef.current = activityLog;
    }, [activityLog]);

    useEffect(() => {
        conversationDeltaCursorRef.current = conversationDeltaCursor;
    }, [conversationDeltaCursor]);

    const trackClientRequest = useCallback((kind: string, metadata?: Record<string, unknown>) => {
        const nextCount = (clientRequestCountRef.current[kind] || 0) + 1;
        clientRequestCountRef.current[kind] = nextCount;
        console.log("[perf:conversations.client_request]", JSON.stringify({
            kind,
            count: nextCount,
            ts: new Date().toISOString(),
            ...(metadata || {}),
        }));
    }, []);

    const trackClientMetric = useCallback((kind: string, valueMs: number, metadata?: Record<string, unknown>) => {
        const roundedValue = Math.max(0, Math.round(Number(valueMs) || 0));
        console.log("[perf:conversations.client_metric]", JSON.stringify({
            kind,
            value_ms: roundedValue,
            ts: new Date().toISOString(),
            ...(metadata || {}),
        }));
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        let cancelled = false;
        requestAnimationFrame(() => {
            if (cancelled) return;
            trackClientMetric("conversation_list_first_paint_ms", performance.now(), {
                initial_count: initialConversations.length,
                has_selected_id: !!initialActiveId,
            });
        });
        return () => {
            cancelled = true;
        };
    }, [initialActiveId, initialConversations.length, trackClientMetric]);

    const isWorkspaceHydrationBusy = useCallback((conversationId?: string | null) => {
        return isWorkspaceRefreshBusy(conversationId, {
            initialHydration: workspaceInitialHydrationInFlightRef.current,
            backfill: workspaceBackfillInFlightRef.current,
            activityHydration: workspaceActivityHydrationInFlightRef.current,
            messageMetadata: workspaceMessageMetadataInFlightRef.current,
        });
    }, []);

    const cacheWorkspaceCoreSnapshot = useCallback((conversationId: string, snapshot: WorkspaceCoreSnapshot) => {
        setWorkspaceCoreCacheEntry(
            workspaceCoreCacheRef.current,
            conversationId,
            snapshot,
            WORKSPACE_CACHE_LIMIT,
            WORKSPACE_CORE_CACHE_TTL_MS
        );
    }, []);

    const getCachedWorkspaceCoreSnapshot = useCallback((conversationId: string): WorkspaceCoreSnapshot | null => {
        return getWorkspaceCoreCacheEntry(workspaceCoreCacheRef.current, conversationId);
    }, []);

    const cacheWorkspaceSidebarSnapshot = useCallback((conversationId: string, snapshot: WorkspaceSidebarSnapshot) => {
        setWorkspaceCoreCacheEntry(
            workspaceSidebarCacheRef.current,
            conversationId,
            snapshot,
            WORKSPACE_CACHE_LIMIT,
            WORKSPACE_SIDEBAR_CACHE_TTL_MS
        );
    }, []);

    const getCachedWorkspaceSidebarSnapshot = useCallback((conversationId: string): WorkspaceSidebarSnapshot | null => {
        return getWorkspaceCoreCacheEntry(workspaceSidebarCacheRef.current, conversationId);
    }, []);

    const syncPendingMessagesForConversation = useCallback((conversationId: string, list: Message[]) => {
        const normalizedConversationId = String(conversationId || "").trim();
        if (!normalizedConversationId) return;

        const nextMap = collectPendingMessagesForConversation(normalizedConversationId, list);

        if (nextMap.size > 0) {
            pendingOutboundByConversationRef.current.set(normalizedConversationId, nextMap);
        } else {
            pendingOutboundByConversationRef.current.delete(normalizedConversationId);
        }
    }, []);

    const mergeSnapshotPreservingPending = useCallback((conversationId: string, snapshotMessages: Message[]) => {
        const pendingMap = pendingOutboundByConversationRef.current.get(String(conversationId || "").trim());
        const pendingMessages = pendingMap ? Array.from(pendingMap.values()) : [];
        const mergedMessages = mergeSnapshotPreservingPendingMessages(snapshotMessages, pendingMessages);
        syncPendingMessagesForConversation(conversationId, mergedMessages);
        return mergedMessages;
    }, [syncPendingMessagesForConversation]);

    useEffect(() => {
        if (!activeId) return;
        syncPendingMessagesForConversation(activeId, messages);
    }, [activeId, messages, syncPendingMessagesForConversation]);

    const applyRealtimeMessagePatch = useCallback((
        conversationId: string | null | undefined,
        payload: Record<string, unknown>
    ): boolean => {
        const normalizedConversationId = String(conversationId || "").trim();
        if (!normalizedConversationId || activeIdRef.current !== normalizedConversationId) return false;

        let matched = false;
        let nextMessagesSnapshot: Message[] | null = null;

        setMessages((prev) => {
            const result = applyRealtimeMessagePatchToMessages(prev, payload);
            matched = result.matched;
            nextMessagesSnapshot = result.messages;
            return result.messages;
        });

        if (!matched || !nextMessagesSnapshot) return false;

        syncPendingMessagesForConversation(normalizedConversationId, nextMessagesSnapshot);
        messageSignatureRef.current = getMessageSignature(nextMessagesSnapshot);

        const cached = getCachedWorkspaceCoreSnapshot(normalizedConversationId);
        if (cached) {
            cacheWorkspaceCoreSnapshot(normalizedConversationId, {
                ...cached,
                messages: nextMessagesSnapshot,
            });
        }

        return true;
    }, [cacheWorkspaceCoreSnapshot, getCachedWorkspaceCoreSnapshot, syncPendingMessagesForConversation]);

    const applyWorkspaceCoreSnapshot = useCallback((conversationId: string, snapshot: WorkspaceCoreSnapshot) => {
        // Guard: prevent stale writes when rapidly switching conversations.
        // Even though callers check `cancelled`, this is a safety net against
        // race conditions where the ref updates between the caller's check and
        // the actual state mutation.
        if (activeIdRef.current !== conversationId) return;

        const nextMessages = mergeSnapshotPreservingPending(
            conversationId,
            Array.isArray(snapshot.messages) ? snapshot.messages : []
        );
        const nextActivity = Array.isArray(snapshot.activityTimeline) ? snapshot.activityTimeline : [];

        setMessages(nextMessages);
        messageSignatureRef.current = getMessageSignature(nextMessages);
        setActivityLog(nextActivity);
        setTranscriptOnDemandEnabled(!!snapshot.transcriptOnDemandEnabled);

        const header = snapshot.conversationHeader;
        if (header?.id) {
            setConversations((prev) => {
                if (prev.some((item) => item.id === header.id)) {
                    return prev.map((item) => item.id === header.id ? { ...item, ...header } : item);
                }
                return [header, ...prev];
            });
        } else if (conversationId) {
            setConversations((prev) => prev.map((item) => item.id === conversationId ? { ...item, unreadCount: item.unreadCount || 0 } : item));
        }

        setLoadedChatId(conversationId);
    }, [mergeSnapshotPreservingPending]);

    const upsertActivityEntryInWorkspace = useCallback((
        conversationId: string | null | undefined,
        activityEntry: ActivityTimelineItem | null | undefined
    ) => {
        const normalizedConversationId = String(conversationId || "").trim();
        if (!normalizedConversationId || !activityEntry?.id) return;

        if (activeIdRef.current === normalizedConversationId) {
            setActivityLog((prev) => mergeActivityTimelineEntries(prev as ActivityTimelineItem[], activityEntry));
        }

        const cached = getCachedWorkspaceCoreSnapshot(normalizedConversationId);
        if (cached) {
            cacheWorkspaceCoreSnapshot(
                normalizedConversationId,
                patchWorkspaceCoreSnapshotActivityEntry(cached, activityEntry)
            );
        }
    }, [cacheWorkspaceCoreSnapshot, getCachedWorkspaceCoreSnapshot]);

    const isDealWorkspaceHydrationBusy = useCallback((dealId?: string | null) => {
        const key = String(dealId || "");
        if (!key) return false;
        return (
            dealWorkspaceInitialHydrationInFlightRef.current.has(key)
            || dealWorkspaceBackfillInFlightRef.current.has(key)
        );
    }, []);

    const cacheDealWorkspaceCoreSnapshot = useCallback((dealId: string, snapshot: DealWorkspaceCoreSnapshot) => {
        setWorkspaceCoreCacheEntry(
            dealWorkspaceCoreCacheRef.current,
            dealId,
            snapshot,
            WORKSPACE_CACHE_LIMIT,
            WORKSPACE_CORE_CACHE_TTL_MS
        );
    }, []);

    const getCachedDealWorkspaceCoreSnapshot = useCallback((dealId: string): DealWorkspaceCoreSnapshot | null => {
        return getWorkspaceCoreCacheEntry(dealWorkspaceCoreCacheRef.current, dealId);
    }, []);

    const applyDealParticipants = useCallback((participants: Conversation[], preferredConversationId?: string | null) => {
        const normalizedParticipants = Array.isArray(participants) ? participants.filter((conversation) => !!conversation?.id) : [];
        const contacts = buildDealContactOptions(normalizedParticipants);

        setActiveDealParticipants(normalizedParticipants);
        setDealContacts(contacts);
        setActiveId((prev) => chooseNextDealConversationId(
            normalizedParticipants,
            contacts,
            preferredConversationId,
            urlConversationIdRef.current,
            prev
        ));
    }, []);

    const applyDealWorkspaceCoreSnapshot = useCallback((dealId: string, snapshot: DealWorkspaceCoreSnapshot, preferredConversationId?: string | null) => {
        applyDealParticipants(snapshot.participants, preferredConversationId);
        setDealTimelineEvents(Array.isArray(snapshot.timelineEvents) ? snapshot.timelineEvents : []);
        setActiveDealMetadata(snapshot.metadata || null);
        setDealTimelineHydrationStatus(snapshot.hydration?.status || 'full');
        setDeals((prev) => prev.map((deal) => (
            deal.id === dealId
                ? {
                    ...deal,
                    title: snapshot.title || deal.title,
                    stage: snapshot.stage || deal.stage,
                    metadata: snapshot.metadata ?? deal.metadata,
                }
                : deal
        )));

        setLoadedDealId(dealId);
    }, [applyDealParticipants]);

    useEffect(() => {
        const onVisibility = () => setIsTabVisible(typeof document === 'undefined' ? true : !document.hidden);
        onVisibility();
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);

    useEffect(() => {
        return () => {
            if (realtimeRefreshTimerRef.current) {
                clearTimeout(realtimeRefreshTimerRef.current);
                realtimeRefreshTimerRef.current = null;
            }
        };
    }, []);

    // Fetch Deals when switching mode
    useEffect(() => {
        if (viewMode === 'deals' && deals.length === 0) {
            getDealContexts().then(setDeals).catch(console.error);
        }
    }, [deals.length, viewMode]);

    const { loadDealWorkspaceSidebar } = useDealWorkspaceHydration({
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
    });

    const { refreshActiveDealWorkspace, isDealWorkspaceRefreshBusy } = useDealWorkspaceRefreshOrchestration({
        activeDealIdRef,
        activeIdRef,
        applyDealWorkspaceCoreSnapshot,
        cacheDealWorkspaceCoreSnapshot,
        getCachedDealWorkspaceCoreSnapshot,
        isDealWorkspaceHydrationBusy,
        loadDealWorkspaceSidebar,
        trackClientRequest,
    });

    useEffect(() => {
        if (viewMode !== 'deals') return;
        setWorkspaceContactContext(null);
        setWorkspaceTaskSummary(null);
        setWorkspaceViewingSummary(null);
        setWorkspaceAgentSummary(null);
    }, [activeDealId, viewMode]);

    // Multi-selection (what shows in the Context Builder)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isSelectionMode, setIsSelectionMode] = useState(false);

    const hasHydratedListRef = useRef(false);

    const replaceConversationListFromResponse = useCallback((data: any) => {
        const listState = replaceConversationListStateFromResponse<Conversation>(data, readResetInFlightRef.current);
        setConversations(listState.conversations);
        setConversationListHasMore(listState.pageInfo.hasMore);
        setConversationListNextCursor(listState.pageInfo.nextCursor);
        if ('deltaCursor' in listState.pageInfo) {
            setConversationDeltaCursor(listState.pageInfo.deltaCursor || null);
            conversationDeltaCursorRef.current = listState.pageInfo.deltaCursor || null;
        }
    }, []);

    const appendConversationPageFromResponse = useCallback((data: any) => {
        const pageInfo = deriveConversationListPageInfo(data);
        setConversations(prev => {
            const listState = appendConversationPageStateFromResponse<Conversation>(prev, data, readResetInFlightRef.current);
            return listState.conversations;
        });
        setConversationListHasMore(pageInfo.hasMore);
        setConversationListNextCursor(pageInfo.nextCursor);
        if ('deltaCursor' in pageInfo) {
            setConversationDeltaCursor(pageInfo.deltaCursor || null);
            conversationDeltaCursorRef.current = pageInfo.deltaCursor || null;
        }
    }, []);

    const applyConversationDeltaPayload = useCallback((deltaPayload: any) => {
        // We DO NOT call setActiveId(null) here even if the active conversation is in removedIds.
        // If a user clicks an archived conversation from the search results while on the 'active' tab,
        // it will naturally not match the filter, but we should not kick them out of the chat window.
        setConversations((prev) => {
            const listState = applyConversationDeltaListPayload<Conversation>(prev, deltaPayload, readResetInFlightRef.current);
            return listState.conversations;
        });

        if (typeof deltaPayload?.cursor === 'string' || deltaPayload?.cursor === null) {
            setConversationDeltaCursor(deltaPayload?.cursor || null);
            conversationDeltaCursorRef.current = deltaPayload?.cursor || null;
        }
    }, []);

    // Fetch Conversations when View Filter changes (skip first load to avoid duplicate SSR refetch).
    useEffect(() => {
        if (!hasHydratedListRef.current) {
            hasHydratedListRef.current = true;
            return;
        }

        // Tasks view uses its own data source (GlobalTaskList), skip conversation fetching.
        if (viewFilter === 'tasks') return;

        fetchConversations(viewFilter, activeIdRef.current || undefined)
            .then(data => {
                replaceConversationListFromResponse(data);
            })
            .catch((err: any) => {
                console.error("Failed to fetch conversations:", err);
                toast({ title: "Error", description: "Failed to load conversations.", variant: "destructive" });
            });
    }, [viewFilter, replaceConversationListFromResponse]);

    // When in Tasks view and a task is clicked, load its conversation so center/right panels can render.
    useEffect(() => {
        if (viewFilter !== 'tasks' || !activeId) return;
        // If conversation is already in the list, no need to fetch
        if (conversationsRef.current.some(c => c.id === activeId)) return;

        refreshConversation(activeId).then(fresh => {
            if (!fresh || activeIdRef.current !== activeId) return;
            setConversations(prev => {
                if (prev.some(c => c.id === activeId)) return prev;
                return [...prev, fresh as Conversation];
            });
        }).catch(err => {
            console.error("Failed to load task conversation:", err);
        });
    }, [viewFilter, activeId]);

    const loadMoreConversations = useCallback(async () => {
        if (viewMode !== 'chats') return;
        if (loadingMoreConversationsRef.current) return;
        if (!conversationListHasMore || !conversationListNextCursor) return;

        loadingMoreConversationsRef.current = true;
        setLoadingMoreConversations(true);
        try {
            const data = await fetchConversations(viewFilter, activeId || undefined, {
                cursor: conversationListNextCursor,
                limit: 50,
            });
            appendConversationPageFromResponse(data);
        } catch (err: any) {
            console.error("Failed to load more conversations:", err);
            toast({ title: "Error", description: "Failed to load more conversations.", variant: "destructive" });
        } finally {
            loadingMoreConversationsRef.current = false;
            setLoadingMoreConversations(false);
        }
    }, [
        viewMode,
        conversationListHasMore,
        conversationListNextCursor,
        viewFilter,
        activeId,
        appendConversationPageFromResponse,
    ]);

    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [permanentDeleteDialogOpen, setPermanentDeleteDialogOpen] = useState(false);
    const [emptyTrashDialogOpen, setEmptyTrashDialogOpen] = useState(false);
    const [idsToDelete, setIdsToDelete] = useState<string[]>([]);

    // Undo Toast State
    const [undoToast, setUndoToast] = useState<{ message: string; action: () => void } | null>(null);

    // WhatsApp Import Modal State
    const [importModalOpen, setImportModalOpen] = useState(false);

    // Create Deal Modal State
    const [createDealOpen, setCreateDealOpen] = useState(false);
    const [creatingDeal, setCreatingDeal] = useState(false);

    // Sync All & New Conversation Dialog State
    const [syncAllOpen, setSyncAllOpen] = useState(false);
    const [newConversationOpen, setNewConversationOpen] = useState(false);

    useEffect(() => {
        messageSignatureRef.current = getMessageSignature(messages);
    }, [messages, activeId]);

    const markConversationReadInUi = useCallback((conversationId: string) => {
        const currentConversation = conversationsRef.current.find((c) => c.id === conversationId);
        if (!currentConversation) return;

        const currentUnreadCount = Number(currentConversation.unreadCount || 0);
        if (currentUnreadCount <= 0 && !readResetInFlightRef.current.has(conversationId)) return;

        if (currentUnreadCount > 0) {
            setConversations(prev =>
                prev.map(c =>
                    c.id === conversationId
                        ? { ...c, unreadCount: 0 }
                        : c
                )
            );
        }

        if (readResetInFlightRef.current.has(conversationId)) return;
        readResetInFlightRef.current.add(conversationId);

        void markConversationAsRead(conversationId)
            .then((res) => {
                if (!res?.success) {
                    console.warn("markConversationAsRead returned unsuccessful response:", res);
                }
            })
            .catch((err) => {
                console.error("Failed to mark conversation as read:", err);
            })
            .finally(() => {
                readResetInFlightRef.current.delete(conversationId);
            });
    }, []);

    const handleBindClick = (ids: string[]) => {
        if (ids.length === 0) return;
        setCreateDealOpen(true);
    };

    const executeCreateDeal = async (title: string) => {
        if (selectedIds.size === 0) return;
        setCreatingDeal(true);
        try {
            const ids = Array.from(selectedIds);
            const selectedConversationsForDeal = resolveSelectedConversationsForDeal(
                ids,
                selectedConversationCacheRef.current,
                conversationsRef.current
            );
            const newDeal = await createPersistentDeal(title, ids);

            cacheDealWorkspaceCoreSnapshot(newDeal.id, createDealWorkspaceCoreSnapshot({
                dealId: newDeal.id,
                title: newDeal.title,
                stage: newDeal.stage,
                metadata: newDeal.metadata,
                participants: selectedConversationsForDeal,
                timelineEvents: [],
                hydration: createDealWorkspaceHydrationState({
                    status: 'partial',
                    timelineEvents: [],
                    initialCount: 0,
                    targetCount: THREAD_TARGET_MESSAGE_COUNT,
                    requestedLimit: THREAD_INITIAL_FALLBACK_MESSAGES,
                }),
            }));

            setDeals((prev) => [
                newDeal,
                ...prev.filter((deal) => deal.id !== newDeal.id),
            ]);
            setActiveId(ids[0] || null);
            setViewMode('deals');
            setActiveDealId(newDeal.id);

            toast({ title: "Deal Created", description: `Created "${newDeal.title}" with ${ids.length} conversations.` });

            // Clear selection and mode
            setSelectedIds(new Set());
            setIsSelectionMode(false);
            setCreateDealOpen(false);
        } catch (e: any) {
            toast({ title: "Error", description: e.message || "Failed to create deal", variant: "destructive" });
        } finally {
            setCreatingDeal(false);
        }
    };

    // Derived State
    const activeConversation = activeId
        ? (
            conversations.find(c => c.id === activeId)
            || searchResults.find(c => c.id === activeId)
            || selectedConversationCacheRef.current.get(activeId)
            || null
        )
        : null;
    const selectedConversations = resolveSelectedConversations(
        selectedIds,
        selectedConversationCacheRef.current,
        conversations
    );
    const selectedDealConversation = resolveSelectedDealConversation(activeDealParticipants, activeId);
    const activeDealListEntry = deals.find((deal) => deal?.id === activeDealId) || null;
    const activeDealSnapshot = activeDealId ? getCachedDealWorkspaceCoreSnapshot(activeDealId) : null;
    const activeDealTitle = resolveDealTitle(activeDealListEntry, activeDealSnapshot);
    const activeDealEnrichmentStatus = String(
        activeDealMetadata?.enrichment?.status
        || activeDealListEntry?.metadata?.enrichment?.status
        || ""
    ).trim().toLowerCase();
    const dealMissionConversation = dealTimelineInitialPainted ? selectedDealConversation : null;

    useChatWorkspaceHydration({
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
        workspaceActivityLimit: WORKSPACE_ACTIVITY_LIMIT,
    });

    const { runRealtimeRefresh, isConversationWorkspaceRefreshBusy } = useConversationRefreshOrchestration({
        viewMode,
        viewFilter,
        activeId,
        searchQuery,
        isTabVisible,
        featureFlags,
        realtimeMode,
        activeIdRef,
        messagesRef,
        activityLogRef,
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
        workspaceActivityLimit: WORKSPACE_ACTIVITY_LIMIT,
    });

    const {
        prefetchWorkspaceCore,
        prefetchWorkspaceSidebar,
        prefetchDealWorkspaceCore,
    } = useConversationWorkspacePrefetch({
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
        workspaceActivityLimit: WORKSPACE_ACTIVITY_LIMIT,
    });

    useEffect(() => {
        if (viewMode !== 'deals' || !activeDealId) return;
        if (!isTabVisible) return;
        if (featureFlags.realtimeSse && realtimeMode !== 'fallback') return;

        let cancelled = false;
        const intervalMs = featureFlags.balancedPolling ? 20_000 : 5_000;

        const runActiveDealDelta = async () => {
            const selectedDealId = activeDealIdRef.current;
            if (!selectedDealId) return;

            try {
                await refreshActiveDealWorkspace(selectedDealId, {
                    reason: "poll",
                    take: ACTIVE_DEAL_REFRESH_EVENT_LIMIT,
                    refreshSidebar: true,
                    hydrationSkipLogKind: "deal_active_poll_skipped_hydration",
                });
            } catch (error) {
                if (!cancelled) {
                    console.error("Active deal delta sync failed:", error);
                }
            }
        };

        let intervalId: ReturnType<typeof setInterval> | null = null;
        const startTimer = setTimeout(() => {
            if (cancelled) return;
            void runActiveDealDelta();
            intervalId = setInterval(runActiveDealDelta, intervalMs);
        }, ACTIVE_POLL_GRACE_MS);

        return () => {
            cancelled = true;
            clearTimeout(startTimer);
            if (intervalId) clearInterval(intervalId);
        };
    }, [
        activeDealId,
        featureFlags.balancedPolling,
        featureFlags.realtimeSse,
        isTabVisible,
        realtimeMode,
        refreshActiveDealWorkspace,
        viewMode,
    ]);

    useConversationRealtimeEvents({
        featureRealtimeSse: featureFlags.realtimeSse,
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
    });

    // Handle clicking a conversation in the list
    const handleSelect = (id: string) => {
        const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const selectedConversation =
            conversationsRef.current.find((conversation) => conversation.id === id)
            || searchResults.find((conversation) => conversation.id === id)
            || selectedConversationCacheRef.current.get(id)
            || null;
        if (selectedConversation) {
            selectedConversationCacheRef.current.set(id, selectedConversation);
            setConversations((prev) => {
                if (prev.some((conversation) => conversation.id === id)) {
                    return prev.map((conversation) => conversation.id === id ? { ...conversation, ...selectedConversation } : conversation);
                }
                return [selectedConversation, ...prev];
            });
        }
        const cachedSidebar = getCachedWorkspaceSidebarSnapshot(id);
        if (cachedSidebar) {
            setWorkspaceContactContext(cachedSidebar.contactContext || null);
            setWorkspaceTaskSummary(cachedSidebar.taskSummary || null);
            setWorkspaceViewingSummary(cachedSidebar.viewingSummary || null);
            setWorkspaceAgentSummary(cachedSidebar.agentSummary || null);
        } else if (selectedConversation) {
            setWorkspaceContactContext(buildContactContextShell(selectedConversation, locationId));
            setWorkspaceTaskSummary(null);
            setWorkspaceViewingSummary(null);
            setWorkspaceAgentSummary(null);
        }
        setLoadedChatId(id);
        trackClientMetric("thread_shell_paint_ms", (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt, {
            conversationId: id,
            cache_hit: !!getCachedWorkspaceCoreSnapshot(id),
            sidebar_cache_hit: !!cachedSidebar,
        });
        setActiveId(id);
        setSelectedTaskId(null);
        markConversationReadInUi(id);
        if (isMobileViewport) {
            setMobilePane('window');
        }
    };

    const handleSelectTask = useCallback((taskId: string | null, conversationId?: string | null) => {
        if (conversationId) {
            setActiveId(conversationId);
        }
        setSelectedTaskId(taskId);
        if (isMobileViewport && taskId) {
            setMobilePane('window');
        }
    }, [isMobileViewport]);

    const handleSelectDeal = (id: string) => {
        setActiveDealId(id);
        if (isMobileViewport) {
            setMobilePane('window');
        }
    };

    const handleBackToList = () => {
        setMobilePane('list');
    };

    const handleBackToConversation = () => {
        setMobilePane('window');
    };

    const handleOpenMissionControl = () => {
        if (!isMobileViewport) return;
        setMobilePane('mission');
    };

    // Handle toggling context mode IDs
    const handleToggleSelect = (id: string, checked: boolean) => {
        setSelectedIds(toggleConversationSelection(selectedIds, id, checked));
    };

    const handleDelete = async (ids: string[]) => {
        if (ids.length === 0) return;

        // If in trash view, prompt for permanent deletion
        if (viewFilter === 'trash') {
            setIdsToDelete(ids);
            setPermanentDeleteDialogOpen(true);
        } else {
            // Soft delete with undo
            setIdsToDelete(ids);
            setDeleteDialogOpen(true);
        }
    };

    const handleArchive = async (ids: string[]) => {
        if (ids.length === 0) return;

        try {
            const res = await archiveConversations(ids);
            if (res.success) {
                const archivedConversations = collectConversationsByIds(conversations, ids);

                // Remove from local state immediately if filtering active conversations
                if (viewFilter === 'active') {
                    setConversations(prev => removeConversationsByIds(prev, ids));
                }

                // Clear selection
                setSelectedIds(new Set());
                if (shouldExitSelectionModeAfterBulkAction(ids, conversations)) {
                    setIsSelectionMode(false);
                }

                // If active ID was archived, deselect
                if (shouldClearActiveConversation(activeId, ids)) {
                    setActiveId(null);
                }

                toast({
                    title: "Archived",
                    description: `Archived ${res.count} conversation${res.count !== 1 ? 's' : ''}`,
                    action: (
                        <UndoToast
                            message={`Archived ${res.count} conversation${res.count !== 1 ? 's' : ''}`}
                            onUndo={async () => {
                                const restoreRes = await unarchiveConversations(ids);
                                if (restoreRes.success) {
                                    if (viewFilter === 'active') {
                                        setConversations(prev => [...archivedConversations, ...prev]);
                                    }
                                    toast({ title: "Unarchived", description: `Unarchived ${restoreRes.count} conversation(s)` });
                                } else {
                                    toast({ title: "Unarchive Failed", description: String(restoreRes.error), variant: "destructive" });
                                }
                            }}
                            onDismiss={() => { }}
                        />
                    ) as any // Type casting for Toast Action usage pattern if needed or just use simple undo logic
                });

                // Simplified Undo Toast Logic reusing existing state
                setUndoToast({
                    message: `Archived ${res.count} conversation${res.count !== 1 ? 's' : ''}`,
                    action: async () => {
                        const restoreRes = await unarchiveConversations(ids);
                        if (restoreRes.success) {
                            if (viewFilter === 'active') {
                                setConversations(prev => [...archivedConversations, ...prev]);
                            }
                            toast({ title: "Unarchived", description: `Unarchived ${restoreRes.count} conversation(s)` });
                        }
                    }
                });

            } else {
                toast({ title: "Archive Failed", description: String(res.error), variant: "destructive" });
            }
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" });
        }
    };

    const executeDelete = async () => {
        const ids = idsToDelete;
        if (ids.length === 0) return;

        try {
            const res = await deleteConversations(ids);
            if (res.success) {
                const deletedConversations = collectConversationsByIds(conversations, ids);

                // Remove from local state immediately
                setConversations(prev => removeConversationsByIds(prev, ids));

                // Clear selection
                setSelectedIds(new Set());
                if (shouldExitSelectionModeAfterBulkAction(ids, conversations)) {
                    setIsSelectionMode(false);
                }

                // If active ID was deleted, deselect
                if (shouldClearActiveConversation(activeId, ids)) {
                    setActiveId(null);
                }

                // Show undo toast
                setUndoToast({
                    message: `Moved ${res.count} conversation${res.count !== 1 ? 's' : ''} to trash`,
                    action: async () => {
                        // Restore conversations
                        const restoreRes = await restoreConversations(ids);
                        if (restoreRes.success) {
                            // Add back to local state
                            setConversations(prev => [...deletedConversations, ...prev]);
                            toast({ title: "Restored", description: `Restored ${restoreRes.count} conversation(s)` });
                        } else {
                            toast({ title: "Restore Failed", description: String(restoreRes.error), variant: "destructive" });
                        }
                    }
                });
            } else {
                toast({ title: "Delete Failed", description: String(res.error), variant: "destructive" });
            }
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" });
        } finally {
            setDeleteDialogOpen(false);
            setIdsToDelete([]);
        }
    };

    const executePermanentDelete = async () => {
        const ids = idsToDelete;
        if (ids.length === 0) return;

        try {
            const res = await permanentlyDeleteConversations(ids);
            if (res.success) {
                toast({ title: "Deleted Forever", description: `Permanently deleted ${res.count} conversation(s).` });

                // Remove from local state
                setConversations(prev => removeConversationsByIds(prev, ids));

                // Clear selection
                setSelectedIds(new Set());
                if (shouldExitSelectionModeAfterBulkAction(ids, conversations)) {
                    setIsSelectionMode(false);
                }

                // If active ID was deleted, deselect
                if (shouldClearActiveConversation(activeId, ids)) {
                    setActiveId(null);
                }
            } else {
                toast({ title: "Delete Failed", description: String(res.error), variant: "destructive" });
            }
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" });
        } finally {
            setPermanentDeleteDialogOpen(false);
            setIdsToDelete([]);
        }
    };

    const handleRestore = async (ids: string[]) => {
        if (ids.length === 0) return;

        try {
            const res = await restoreConversations(ids);
            if (res.success) {
                toast({ title: "Restored", description: `Restored ${res.count} conversation(s).` });

                // Remove from local state
                setConversations(prev => removeConversationsByIds(prev, ids));

                // Clear selection
                setSelectedIds(new Set());
                if (shouldExitSelectionModeAfterBulkAction(ids, conversations)) {
                    setIsSelectionMode(false);
                }

                // If active ID was restored, deselect
                if (shouldClearActiveConversation(activeId, ids)) {
                    setActiveId(null);
                }
            } else {
                toast({ title: "Restore Failed", description: String(res.error), variant: "destructive" });
            }
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" });
        }
    };

    const handleEmptyTrash = () => {
        setEmptyTrashDialogOpen(true);
    };

    const executeEmptyTrash = async () => {
        try {
            const res = await emptyTrash();
            if (res.success) {
                toast({ title: "Trash Emptied", description: `Permanently deleted ${res.count} conversation(s).` });
                setConversations([]);
                setSelectedIds(new Set());
                setIsSelectionMode(false);
                setActiveId(null);
            } else {
                toast({ title: "Failed to Empty Trash", description: String(res.error), variant: "destructive" });
            }
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" });
        } finally {
            setEmptyTrashDialogOpen(false);
        }
    };


    const handleSendMessage = async (
        text: string,
        type: 'SMS' | 'Email' | 'WhatsApp' | 'SMS_RELAY',
        options?: {
            translationSourceText?: string | null;
            translationTargetLanguage?: string | null;
            translationDetectedSourceLanguage?: string | null;
        },
        targetConversation?: Conversation
    ) => {
        const conversationTarget = targetConversation || activeConversation;
        if (!conversationTarget) return;

        // Optimistic UI update — message appears instantly with 'sending' status
        const optimisticClientMessageId = createOutboundClientMessageId();
        const optimisticMessage = buildOptimisticTextMessage({
            clientMessageId: optimisticClientMessageId,
            conversation: conversationTarget,
            text,
            type,
            options,
        });
        const optimisticMessageId = optimisticMessage.id;

        if (viewMode === 'chats' && activeIdRef.current === conversationTarget.id) {
            setMessages((prev) => {
                const next = appendOptimisticMessage(prev, optimisticMessage);
                syncPendingMessagesForConversation(conversationTarget.id, next);
                return next;
            });
        }

        const capturedConversationId = conversationTarget.id;
        const capturedContactId = conversationTarget.contactId;

        const markOptimisticMessageFailed = () => {
            if (viewMode !== 'chats' || activeIdRef.current !== capturedConversationId) return;
            setMessages((prev) => {
                const next = markMessageFailedById(prev, optimisticMessageId, { deadOutbox: true });
                syncPendingMessagesForConversation(capturedConversationId, next);
                return next;
            });
        };

        let sendFailureToastShown = false;
        try {
            const res = type === "SMS_RELAY"
                ? await fetch("/api/sms-relay/send", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        conversationId: capturedConversationId,
                        contactId: capturedContactId,
                        messageBody: text,
                        clientMessageId: optimisticClientMessageId,
                    }),
                }).then(async (response) => {
                    const payload = await response.json().catch(() => ({}));
                    if (!response.ok) {
                        return {
                            success: false,
                            error: payload?.error || `SIM Relay send failed (${response.status})`,
                            errorCode: payload?.errorCode,
                        };
                    }
                    return payload;
                })
                : await sendReply(capturedConversationId, capturedContactId, text, type as 'SMS' | 'Email' | 'WhatsApp' | 'SMS_RELAY', {
                    clientMessageId: optimisticClientMessageId,
                    translationSourceText: options?.translationSourceText || null,
                    translationTargetLanguage: options?.translationTargetLanguage || null,
                    translationDetectedSourceLanguage: options?.translationDetectedSourceLanguage || null,
                });

            if (!res.success) {
                markOptimisticMessageFailed();
                const description = normalizeSendError(typeof res.error === 'string' ? res.error : 'Unknown error occurred');
                toast({
                    title: 'Failed to send message',
                    description,
                    variant: 'destructive',
                });
                sendFailureToastShown = true;
                throw new Error(description);
            }

            // Deal mode: refresh deal workspace in background
            if (viewMode === 'deals' && activeDealIdRef.current) {
                void refreshActiveDealWorkspace(activeDealIdRef.current, {
                    reason: "send_message",
                    refreshSidebar: false,
                });
            }

            if (viewMode === 'chats' && activeIdRef.current === capturedConversationId) {
                const ackState = getSendAckState(res as any, optimisticClientMessageId);

                setMessages((prev) => {
                    const next = applySendAckByCorrelation(prev, {
                        optimisticMessageId,
                        optimisticClientMessageId,
                        ack: res as any,
                    });
                    syncPendingMessagesForConversation(capturedConversationId, next);
                    return next;
                });

                if (ackState.warning) {
                    toast({
                        title: type === "SMS_RELAY" ? 'SIM Relay delivery queued' : 'WhatsApp delivery degraded',
                        description: ackState.warning,
                    });
                } else if (ackState.degradedDelivery) {
                    toast({
                        title: type === "SMS_RELAY" ? 'SIM Relay delivery degraded' : 'WhatsApp delivery degraded',
                        description: 'Queue enqueue failed. Durable auto-recovery is active for this message.',
                    });
                }
            }
        } catch (e: any) {
            markOptimisticMessageFailed();
            if (!sendFailureToastShown) {
                toast({
                    title: 'Failed to send message',
                    description: normalizeSendError(e),
                    variant: 'destructive',
                });
            }
            throw e;
        }
    };

    const handleTranslateMessage = useCallback(async (messageId: string, targetLanguage?: string | null) => {
        const normalizedMessageId = String(messageId || "").trim();
        if (!normalizedMessageId) {
            return { success: false as const, error: "Missing message ID." };
        }
        const activeConversationId = String(activeIdRef.current || "").trim();
        if (!activeConversationId) {
            return { success: false as const, error: "No active conversation." };
        }

        const result = await translateConversationMessage(normalizedMessageId, targetLanguage || null);
        if (!result?.success || !result.translation) {
            return {
                success: false as const,
                error: String(result?.error || "Failed to translate message."),
            };
        }

        setMessages((prev) => applyMessageTranslation(prev, normalizedMessageId, result.translation));

        return {
            success: true as const,
            messageId: normalizedMessageId,
            translation: result.translation,
        };
    }, []);

    const handleTranslateVisibleThread = useCallback(async (visibleMessageIds: string[], targetLanguage?: string | null) => {
        const activeConversationId = String(activeIdRef.current || "").trim();
        if (!activeConversationId) {
            return { success: false as const, error: "No active conversation." };
        }

        const result = await translateConversationThread(activeConversationId, targetLanguage || null, visibleMessageIds || []);
        if (!result?.success) {
            return { success: false as const, error: String(result?.error || "Failed to translate thread.") };
        }

        try {
            const refreshed = await fetchMessages(activeConversationId, THREAD_REFRESH_MESSAGES_OPTIONS);
            if (activeIdRef.current === activeConversationId) {
                const nextMessages = mergeSnapshotPreservingPending(activeConversationId, refreshed);
                setMessages(nextMessages);
                messageSignatureRef.current = getMessageSignature(nextMessages);
            }
        } catch {
            // Ignore refresh errors; optimistic/message-level updates can still continue.
        }

        return {
            success: true as const,
            translatedCount: Number(result.translatedCount || 0),
            failedCount: Number(result.failedCount || 0),
        };
    }, []);

    const handlePreviewTranslatedReply = useCallback(async (
        sourceText: string,
        channel: "SMS" | "Email" | "WhatsApp",
        targetLanguage?: string | null
    ) => {
        const conversationId = String(activeIdRef.current || "").trim();
        if (!conversationId) {
            return { success: false as const, error: "No active conversation." };
        }
        return previewTranslatedReply(conversationId, sourceText, channel, targetLanguage || null);
    }, []);

    const applyConversationReplyLanguageOverride = useCallback((conversationId: string, replyLanguageOverride: string | null) => {
        setConversations((prev) => applyReplyLanguageOverrideToConversations(prev, conversationId, replyLanguageOverride));
        setSearchResults((prev) => applyReplyLanguageOverrideToConversations(prev, conversationId, replyLanguageOverride));
        setActiveDealParticipants((prev) => applyReplyLanguageOverrideToConversations(prev, conversationId, replyLanguageOverride));
    }, []);

    const handleContactMerged = useCallback(async (conversationId: string, targetContactId: string, targetConversationId?: string | null) => {
        const normalizedConversationId = String(conversationId || "").trim();
        if (!normalizedConversationId || !targetContactId) return;

        // 1. Remove the old (source) conversation from the list — it's been deleted/merged
        setConversations(prev => removeMergedSourceConversation(prev, normalizedConversationId));
        setSearchResults(prev => removeMergedSourceConversation(prev, normalizedConversationId));

        // 2. Invalidate workspace cache for the old conversation
        workspaceCoreCacheRef.current.delete(normalizedConversationId);

        // 3. Keep local state coherent while we navigate away from the merged source contact
        const targetConvId = resolvePostMergeActiveConversationId(targetConversationId);
        if (targetConvId) {
            setActiveId(targetConvId);
        } else {
            setActiveId(null);
        }

        // 4. Refresh the target conversation's sidebar in background
        if (targetConvId) {
            try {
                const sidebar = await getConversationWorkspaceSidebar(targetConvId);
                if (sidebar?.success) {
                    setWorkspaceContactContext(sidebar.contactContext);
                    setWorkspaceTaskSummary(sidebar.taskSummary);
                    setWorkspaceViewingSummary(sidebar.viewingSummary);
                }
            } catch (e) {
                console.error("Failed to refresh sidebar after merge", e);
            }
        }

        router.push(`/admin/contacts/${encodeURIComponent(targetContactId)}/view?locationId=${encodeURIComponent(locationId)}`);
    }, [locationId, router]);

    const handleConversationContactSaved = useCallback(async (conversationId: string, patch: ContactIdentityPatch) => {
        const normalizedPatch = normalizeConversationContactIdentityPatch(conversationId, patch);
        if (!normalizedPatch) return;

        const sequence = (contactSaveRefreshSeqRef.current[normalizedPatch.conversationId] || 0) + 1;
        contactSaveRefreshSeqRef.current[normalizedPatch.conversationId] = sequence;

        setConversations((prev) => prev.map((conversationItem) => applyConversationIdentityPatch(conversationItem, normalizedPatch)));
        setSearchResults((prev) => prev.map((conversationItem) => applyConversationIdentityPatch(conversationItem, normalizedPatch)));
        setActiveDealParticipants((prev) => prev.map((conversationItem) => applyConversationIdentityPatch(conversationItem, normalizedPatch)));
        setDealContacts((prev) => prev.map((contact) => applyDealContactIdentityPatch(contact, normalizedPatch)));
        setWorkspaceContactContext((prev: any) => applyWorkspaceContactContextIdentityPatch(prev, normalizedPatch));

        try {
            const fresh = await refreshConversation(normalizedPatch.conversationId);
            if (!fresh) return;
            if (contactSaveRefreshSeqRef.current[normalizedPatch.conversationId] !== sequence) return;

            setConversations((prev) => prev.map((conversationItem) => applyRefreshedConversationIdentityPatch(conversationItem, fresh, normalizedPatch)));
            setSearchResults((prev) => prev.map((conversationItem) => applyRefreshedConversationIdentityPatch(conversationItem, fresh, normalizedPatch)));
            setActiveDealParticipants((prev) => prev.map((conversationItem) => applyRefreshedConversationIdentityPatch(conversationItem, fresh, normalizedPatch)));
            setDealContacts((prev) => prev.map((contact) => applyRefreshedDealContactIdentityPatch(contact, fresh, normalizedPatch)));
            setWorkspaceContactContext((prev: any) => applyRefreshedWorkspaceContactContextIdentityPatch(prev, fresh, normalizedPatch));
        } catch (error) {
            console.error("Failed to refresh conversation after contact save:", error);
        }
    }, []);

    const handleSendMedia = async (
        file: File,
        caption: string,
        targetConversation?: Conversation
    ) => {
        const conversationTarget = targetConversation || activeConversation;
        if (!conversationTarget) return;

        const optimisticClientMessageId = createOutboundClientMessageId();
        const objectUrl = URL.createObjectURL(file);
        const optimisticMessage = buildOptimisticMediaMessage({
            clientMessageId: optimisticClientMessageId,
            conversation: conversationTarget,
            caption,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            objectUrl,
        });
        const optimisticMessageId = optimisticMessage.id;

        const markOptimisticMediaFailed = () => {
            if (viewMode !== 'chats' || activeIdRef.current !== conversationTarget.id) return;
            setMessages((prev) => {
                const next = markMessageFailedById(prev, optimisticMessageId, { deadOutbox: true });
                syncPendingMessagesForConversation(conversationTarget.id, next);
                return next;
            });
        };

        if (viewMode === 'chats' && activeIdRef.current === conversationTarget.id) {
            setMessages((prev) => {
                const next = appendOptimisticMessage(prev, optimisticMessage);
                syncPendingMessagesForConversation(conversationTarget.id, next);
                return next;
            });
        }

        try {
            const prep = await createWhatsAppMediaUploadUrl(conversationTarget.id, conversationTarget.contactId, {
                fileName: file.name,
                contentType: file.type || 'application/octet-stream',
                size: file.size,
            });

            if (!prep.success) {
                markOptimisticMediaFailed();
                toast({
                    title: 'Failed to prepare media upload',
                    description: typeof prep.error === 'string' ? prep.error : 'Unknown error',
                    variant: 'destructive',
                });
                return;
            }

            if (!prep.uploadUrl || !prep.upload) {
                markOptimisticMediaFailed();
                toast({
                    title: 'Missing upload details',
                    description: "Upload preparation response missing upload URL or upload reference.",
                    variant: 'destructive',
                });
                return;
            }

            const uploadUrl = prep.uploadUrl;
            const uploadHeaders = prep.headers || { 'Content-Type': file.type || 'application/octet-stream' };
            const uploadRef = prep.upload;

            const uploadRes = await fetch(uploadUrl, {
                method: 'PUT',
                headers: uploadHeaders,
                body: file,
            });

            if (!uploadRes.ok) {
                const errText = await uploadRes.text().catch(() => '');
                markOptimisticMediaFailed();
                toast({
                    title: `R2 upload failed (${uploadRes.status})`,
                    description: errText,
                    variant: 'destructive',
                });
                return;
            }

            const sendRes = await sendWhatsAppMediaReply(
                conversationTarget.id,
                conversationTarget.contactId,
                uploadRef,
                { caption, clientMessageId: optimisticClientMessageId }
            );

            if (sendRes.success) {
                if (viewMode === 'deals' && activeDealIdRef.current) {
                    void refreshActiveDealWorkspace(activeDealIdRef.current, {
                        reason: "send_media",
                        refreshSidebar: false,
                    });
                }
                if (viewMode === 'chats' && activeIdRef.current === conversationTarget.id) {
                    const ackState = getSendAckState(sendRes as any, optimisticClientMessageId, { media: true });

                    setMessages((prev) => {
                        const next = applySendAckByCorrelation(prev, {
                            optimisticMessageId,
                            optimisticClientMessageId,
                            ack: sendRes as any,
                            media: true,
                        });
                        syncPendingMessagesForConversation(conversationTarget.id, next);
                        return next;
                    });

                    if (ackState.warning) {
                        toast({
                            title: 'WhatsApp delivery degraded',
                            description: ackState.warning,
                        });
                    } else if (ackState.degradedDelivery) {
                        toast({
                            title: 'WhatsApp delivery degraded',
                            description: 'Queue enqueue failed. Durable auto-recovery is active for this media message.',
                        });
                    }
                }
            } else {
                markOptimisticMediaFailed();
                toast({
                    title: 'Failed to send media',
                    description: typeof sendRes.error === 'string' ? sendRes.error : 'Unknown error',
                    variant: 'destructive',
                });
            }
        } catch (e: any) {
            markOptimisticMediaFailed();
            toast({
                title: 'Failed to send media',
                description: e?.message || 'Unknown error',
                variant: 'destructive',
            });
        }
    };

    const handleResendMessage = async (messageId: string) => {
        const conversationTarget = activeConversation;
        if (!conversationTarget) return;

        const msgs = viewMode === 'chats' ? messages : dealTimelineEvents.filter(e => e.kind === 'message').map(e => e.message as any);
        const originalMsg = msgs.find(m => m.id === messageId);
        
        if (!originalMsg) {
            toast({ title: "Cannot resend", description: "Message not found in timeline", variant: "destructive" });
            return;
        }

        if (originalMsg.status !== 'failed') return;

        // Transition back to sending optimism
        if (viewMode === 'chats' && activeIdRef.current === conversationTarget.id) {
            setMessages((prev) => {
                const next = markMessageSendingById(prev, messageId);
                syncPendingMessagesForConversation(conversationTarget.id, next);
                return next;
            });
        }

        try {
            const resendClientMessageId = createOutboundClientMessageId();
            const hasAttachments = originalMsg.attachments && originalMsg.attachments.length > 0;
            const res = hasAttachments 
              // Basic retry for text for now, media retry requires original file which we don't store on client.
              // We'll fallback to alerting for media if we can't reconstruct.
              ? { success: false, error: "Retrying media messages is not supported without re-uploading the file" }
              : await sendReply(
                  conversationTarget.id,
                  conversationTarget.contactId,
                  originalMsg.body,
                  originalMsg.type as 'SMS'|'Email'|'WhatsApp'|'SMS_RELAY',
                  { clientMessageId: resendClientMessageId }
              );

            if (!res.success) {
                if (viewMode === 'chats' && activeIdRef.current === conversationTarget.id) {
                    setMessages((prev) => {
                        const next = markMessageFailedById(prev, messageId);
                        syncPendingMessagesForConversation(conversationTarget.id, next);
                        return next;
                    });
                }
                toast({
                    title: 'Failed to resend message',
                    description: typeof res.error === 'string' ? res.error : 'Unknown error',
                    variant: 'destructive',
                });
                return;
            }

            if (viewMode === 'deals' && activeDealIdRef.current) {
                void refreshActiveDealWorkspace(activeDealIdRef.current, {
                    reason: "resend_message",
                    refreshSidebar: false,
                });
            }

            if (viewMode === 'chats' && activeIdRef.current === conversationTarget.id) {
                const ackState = getSendAckState(res as any, resendClientMessageId);

                setMessages((prev) => {
                    const next = applyResendAckById(prev, {
                        messageId,
                        clientMessageId: resendClientMessageId,
                        ack: res as any,
                    });
                    syncPendingMessagesForConversation(conversationTarget.id, next);
                    return next;
                });

                if (ackState.warning) {
                    toast({
                        title: 'WhatsApp delivery degraded',
                        description: ackState.warning,
                    });
                } else if (ackState.degradedDelivery) {
                    toast({
                        title: 'WhatsApp delivery degraded',
                        description: 'Queue enqueue failed. Durable auto-recovery is active for this resend.',
                    });
                }
            }
        } catch (e: any) {
            if (viewMode === 'chats' && activeIdRef.current === conversationTarget.id) {
                setMessages((prev) => {
                    const next = markMessageFailedById(prev, messageId);
                    syncPendingMessagesForConversation(conversationTarget.id, next);
                    return next;
                });
            }
            toast({
                title: 'Failed to resend message',
                description: e?.message || 'Unknown error',
                variant: 'destructive',
            });
        }
    };

    const handleRefetchMedia = async (messageId: string) => {
        if (!activeConversation) return;

        const selectedConversationId = activeConversation.id;

        try {
            const res = await refetchWhatsAppMediaAttachment(selectedConversationId, messageId, {
                deleteStoredObject: true,
            });

            if (!res?.success) {
                toast({
                    title: "Media Re-fetch Failed",
                    description: String(res?.error || "Unknown error"),
                    variant: "destructive",
                });
                return;
            }

            const refreshed = await fetchMessages(selectedConversationId, THREAD_REFRESH_MESSAGES_OPTIONS);
            if (activeIdRef.current === selectedConversationId) {
                setMessages(mergeSnapshotPreservingPending(selectedConversationId, refreshed));
            }

            const deletedStorageSuffix = (res.removedStorageObjects || 0) > 0
                ? ` • removed ${res.removedStorageObjects} old object${res.removedStorageObjects === 1 ? "" : "s"}`
                : "";

            toast({
                title: "Media Re-fetched",
                description: `Fetched ${res.mediaType} from WhatsApp again${deletedStorageSuffix}.`,
            });

            if (Array.isArray(res.warnings) && res.warnings.length > 0) {
                toast({
                    title: "Media Re-fetch Warning",
                    description: res.warnings[0],
                    variant: "destructive",
                });
            }
        } catch (error: any) {
            toast({
                title: "Media Re-fetch Failed",
                description: String(error?.message || "Unexpected error"),
                variant: "destructive",
            });
        }
    };

    const handleRetryTranscript = async (messageId: string, attachmentId: string) => {
        if (!activeConversation) return;
        const conversationId = activeConversation.id;
        await runTranscriptAction({
            run: () => retryWhatsAppAudioTranscript(conversationId, messageId, attachmentId),
            refresh: () => refreshMessagesAfterTranscriptAction({
                conversationId,
                activeConversationId: activeIdRef.current,
                fetchMessages,
                mergeMessages: mergeSnapshotPreservingPending,
                setMessages,
                messageSignatureRef,
            }),
            toast,
            failureTitle: "Retry Failed",
            failureDescription: "Could not retry transcript.",
            unexpectedFailureDescription: "Unexpected error while retrying transcript.",
            onSuccess: (result) => {
                const modeLabel = getTranscriptActionModeLabel(result.mode);
                toast({
                    title: result.skipped ? "Transcript Already Complete" : "Transcript Retry Started",
                    description: result.message || `Retry accepted via ${modeLabel}.`,
                });
            },
        });
    };

    const handleRequestTranscript = async (
        messageId: string,
        attachmentId: string,
        options?: { force?: boolean }
    ) => {
        if (!activeConversation) return;
        const conversationId = activeConversation.id;
        await runTranscriptAction({
            run: () => requestWhatsAppAudioTranscript(
                conversationId,
                messageId,
                attachmentId,
                { force: !!options?.force, priority: "high" }
            ),
            refresh: () => refreshMessagesAfterTranscriptAction({
                conversationId,
                activeConversationId: activeIdRef.current,
                fetchMessages,
                mergeMessages: mergeSnapshotPreservingPending,
                setMessages,
                messageSignatureRef,
            }),
            toast,
            failureTitle: options?.force ? "Regeneration Failed" : "Transcription Failed",
            failureDescription: "Could not start transcript job.",
            unexpectedFailureDescription: "Unexpected error while starting transcript.",
            onSuccess: (result) => {
                const modeLabel = getTranscriptActionModeLabel(result.mode);
                toast({
                    title: result.skipped
                        ? "Transcript Already Queued"
                        : (options?.force ? "Transcript Regeneration Started" : "Transcript Started"),
                    description: result.message || `Accepted via ${modeLabel}.`,
                });
            },
        });
    };

    const handleBulkTranscribeUnprocessedAudio = async (options?: { window?: "30d" | "all" }) => {
        if (!activeConversation) return;
        const conversationId = activeConversation.id;
        await runTranscriptAction({
            run: () => bulkRequestWhatsAppAudioTranscripts(conversationId, {
                window: options?.window || "30d",
                priority: "normal",
            }),
            refresh: () => refreshMessagesAfterTranscriptAction({
                conversationId,
                activeConversationId: activeIdRef.current,
                fetchMessages,
                mergeMessages: mergeSnapshotPreservingPending,
                setMessages,
                messageSignatureRef,
            }),
            toast,
            failureTitle: "Bulk Transcription Failed",
            failureDescription: "Could not queue bulk transcript jobs.",
            unexpectedFailureDescription: "Unexpected error while queuing bulk transcripts.",
            onSuccess: (result) => {
                const summary = `Queued ${result.queuedCount}, skipped ${result.skippedCount}, failed ${result.failedCount}.`;
                toast({
                    title: "Bulk Transcription Requested",
                    description: `${result.message} ${summary}`.trim(),
                    variant: result.failedCount > 0 ? "destructive" : "default",
                });
            },
        });
    };

    const handleExtractViewingNotes = async (
        messageId: string,
        attachmentId: string,
        options?: { force?: boolean }
    ) => {
        if (!activeConversation) return;
        const conversationId = activeConversation.id;
        await runTranscriptAction({
            run: () => extractWhatsAppViewingNotes(
                conversationId,
                messageId,
                attachmentId,
                { force: !!options?.force, priority: "high" }
            ),
            refresh: () => refreshMessagesAfterTranscriptAction({
                conversationId,
                activeConversationId: activeIdRef.current,
                fetchMessages,
                mergeMessages: mergeSnapshotPreservingPending,
                setMessages,
                messageSignatureRef,
            }),
            toast,
            failureTitle: options?.force ? "Notes Regeneration Failed" : "Extraction Failed",
            failureDescription: "Could not start viewing notes extraction.",
            unexpectedFailureDescription: "Unexpected error while extracting viewing notes.",
            onSuccess: (result) => {
                const modeLabel = getTranscriptActionModeLabel(result.mode);
                toast({
                    title: result.skipped
                        ? "Viewing Notes Already Available"
                        : (options?.force ? "Notes Regeneration Started" : "Viewing Notes Extraction Started"),
                    description: result.message || `Accepted via ${modeLabel}.`,
                });
            },
        });
    };


    const handleSync = async () => {
        if (!activeId) return;
        setLoadingMessages(true);
        const CHUNK_SIZE = 50;
        const MAX_LIMIT = 500; // Safety cap
        let totalSynced = 0;
        let offset = 0;
        let keepFetching = true;

        try {
            toast({ title: "Starting Deep Sync...", description: "Initializing..." });

            while (keepFetching && offset < MAX_LIMIT) {
                // Manual Sync: Force deeper check (limit 50, offset, ignore duplicates)
                const res = await syncWhatsAppHistory(activeId, CHUNK_SIZE, true, offset);

                if (res.success) {
                    const count = res.count || 0;
                    totalSynced += count;
                    offset += CHUNK_SIZE;

                    // Update UI with progress
                    if (count > 0) {
                        toast({
                            title: "Syncing WhatsApp History...",
                            description: `Fetched ${count} messages (Total: ${totalSynced})...`
                        });
                        // Re-fetch to display them as they come in
                        const msgs = await fetchMessages(activeId, THREAD_REFRESH_MESSAGES_OPTIONS);
                        setMessages(mergeSnapshotPreservingPending(activeId, msgs));
                    }

                    // Stop if we fetched fewer than requested (end of history)
                    // WhatsApp history fetch usually returns what it finds. If it finds 0, we stop.
                    if (count < CHUNK_SIZE) {
                        keepFetching = false;
                    }
                } else {
                    toast({ title: "Sync Failed", description: String(res.error), variant: "destructive" });
                    keepFetching = false;
                }
            }

            toast({ title: "Sync Complete", description: `Total messages recovered: ${totalSynced}` });
            const msgs = await fetchMessages(activeId, THREAD_REFRESH_MESSAGES_OPTIONS);
            setMessages(mergeSnapshotPreservingPending(activeId, msgs));

        } catch (e) {
            console.error("Sync error:", e);
            toast({ title: "Sync Error", description: "An unexpected error occurred.", variant: "destructive" });
        } finally {
            setLoadingMessages(false);
        }
    };

    const [suggestions, setSuggestions] = useState<string[]>([]);

    // Reset suggestions when active conversation changes
    useEffect(() => {
        setSuggestions([]);
    }, [activeId]);

    useEffect(() => {
        setChatTimelineInitialPainted(false);
    }, [viewMode, activeId]);

    const {
        suggestedResponseQueue,
        loadingSuggestedResponseQueue,
        refreshSuggestedResponseQueue,
        handleAcceptSuggestedResponse,
        handleRejectSuggestedResponse,
    } = useSuggestedResponseQueue({
        viewMode,
        activeConversationId: activeId,
        activeDealId,
        chatTimelineInitialPainted,
        dealTimelineInitialPainted,
        insertIntoComposer: insertSuggestedResponseIntoComposer,
        trackClientRequest,
    });

    const handleMissionSuggestionsGenerated = useCallback((nextSuggestions: string[]) => {
        setSuggestions(Array.isArray(nextSuggestions) ? nextSuggestions : []);
        void refreshSuggestedResponseQueue({ trigger: "mission" });
    }, [refreshSuggestedResponseQueue]);

    const handleChatAddActivityEntry = useCallback(async (entryText: string, dateIso: string) => {
        if (!activeConversation) return;

        const clientMutationId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `activity-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const result = await addConversationActivityEntry(
            activeConversation.id,
            entryText,
            dateIso,
            clientMutationId
        );
        if (result?.activityEntry) {
            upsertActivityEntryInWorkspace(
                activeConversation.id,
                result.activityEntry as ActivityTimelineItem
            );
        }
    }, [activeConversation, upsertActivityEntryInWorkspace]);

    const handleChatFetchHistory = useCallback(async () => {
        if (!activeConversation) return;

        setLoadingMessages(true);
        try {
            toast({ title: "Fetching History", description: "Checking Gmail for recent messages..." });
            // Dynamic import or passed prop action
            const { fetchContactHistory } = await import('@/lib/google/actions');
            const res = await fetchContactHistory(activeConversation.contactId);

            if (res.success) {
                toast({ title: "History Fetched", description: `Found ${res.count} messages.` });
                const msgs = await fetchMessages(activeConversation.id, THREAD_REFRESH_MESSAGES_OPTIONS);
                setMessages(mergeSnapshotPreservingPending(activeConversation.id, msgs));
            } else {
                toast({ title: "Fetch Failed", description: res.error, variant: "destructive" });
            }
        } catch (e: any) {
            toast({ title: "Error", description: e.message, variant: "destructive" });
        } finally {
            setLoadingMessages(false);
        }
    }, [activeConversation, mergeSnapshotPreservingPending]);

    const handleChatGenerateDraft = useCallback(async (
        instruction?: string,
        model?: string,
        draftLanguage?: string | null,
        onChunk?: (chunk: string) => void
    ) => {
        if (!activeConversation) return null;

        try {
            const res = await generateDraftWithStreamingFallback({
                conversationId: activeConversation.id,
                contactId: activeConversation.contactId,
                instruction,
                model,
                mode: "chat",
                draftLanguage,
                onChunk,
                generateDraft: generateAIDraft,
                onStreamError: (streamError) => {
                    console.warn("[AI Draft] Stream path failed, falling back to server action.", streamError);
                },
            });
            if (res.reasoning) {
                toast({ title: "Draft Generated", description: res.reasoning });
            }
            return res.draft || null;
        } catch (e: any) {
            toast({ title: "Draft Failed", description: e.message, variant: "destructive" });
            return null;
        }
    }, [activeConversation]);

    const handleChatSetReplyLanguageOverride = useCallback(async (replyLanguage: string | null) => {
        if (!activeConversation) {
            return { success: false as const, error: "No conversation selected." };
        }

        const result = await setConversationReplyLanguageOverride(activeConversation.id, replyLanguage);
        if (result.success) {
            applyConversationReplyLanguageOverride(activeConversation.id, result.replyLanguageOverride ?? null);
        }
        return result;
    }, [activeConversation, applyConversationReplyLanguageOverride]);

    const handleChatInitialPaintReady = useCallback(() => {
        if (activeIdRef.current === activeConversation?.id) {
            setChatTimelineInitialPainted(true);
            const loadedAt = initialWorkspaceLoadedAtRef.current[activeConversation.id] || 0;
            trackClientMetric("thread_messages_ready_ms", loadedAt ? Date.now() - loadedAt : 0, {
                conversationId: activeConversation.id,
                message_count: messages.length,
                cache_hit: !!getCachedWorkspaceCoreSnapshot(activeConversation.id),
            });
        }
    }, [activeConversation, getCachedWorkspaceCoreSnapshot, messages.length, trackClientMetric]);

    const handleDealInitialPaintReady = useCallback(() => {
        if (activeDealIdRef.current === activeDealId) {
            setDealTimelineInitialPainted(true);
        }
    }, [activeDealId]);

    const handleDealPreviewTranslatedReply = useCallback(async (
        sourceText: string,
        channel: "SMS" | "Email" | "WhatsApp",
        targetLanguage?: string | null
    ) => {
        if (!selectedDealConversation) {
            return { success: false as const, error: "No conversation selected." };
        }
        return previewTranslatedReply(selectedDealConversation.id, sourceText, channel, targetLanguage || null);
    }, [selectedDealConversation]);

    const handleDealGenerateDraft = useCallback(async (
        instruction?: string,
        model?: string,
        draftLanguage?: string | null,
        onChunk?: (chunk: string) => void
    ) => {
        if (!selectedDealConversation) return null;
        try {
            const res = await generateDraftWithStreamingFallback({
                conversationId: selectedDealConversation.id,
                contactId: selectedDealConversation.contactId,
                instruction,
                model,
                mode: "deal",
                dealId: activeDealId || undefined,
                draftLanguage,
                onChunk,
                generateDraft: generateAIDraft,
                onStreamError: (streamError) => {
                    console.warn("[AI Draft] Deal stream path failed, falling back to server action.", streamError);
                },
            });
            if (res.reasoning) {
                toast({ title: "Draft Generated", description: res.reasoning });
            }
            return res.draft || null;
        } catch (error: any) {
            toast({ title: "Draft Failed", description: error?.message || "Failed to generate draft", variant: "destructive" });
            return null;
        }
    }, [activeDealId, selectedDealConversation]);

    const handleDealSetReplyLanguageOverride = useCallback(async (replyLanguage: string | null) => {
        if (!selectedDealConversation) {
            return { success: false as const, error: "No conversation selected." };
        }
        const result = await setConversationReplyLanguageOverride(selectedDealConversation.id, replyLanguage);
        if (result.success) {
            applyConversationReplyLanguageOverride(selectedDealConversation.id, result.replyLanguageOverride ?? null);
        }
        return result;
    }, [applyConversationReplyLanguageOverride, selectedDealConversation]);

    const conversationListPane = (
        <ConversationList
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            isSearching={isSearching}
            conversations={searchQuery.trim() ? searchResults : conversations}
            selectedId={viewMode === 'chats' ? activeId : activeDealId}
            onSelect={handleSelect}
            onHoverConversation={viewMode === 'chats' ? (conversationId) => {
                void prefetchWorkspaceCore(conversationId);
                void prefetchWorkspaceSidebar(conversationId);
            } : undefined}
            hasMore={viewMode === 'chats' ? conversationListHasMore : false}
            isLoadingMore={viewMode === 'chats' ? loadingMoreConversations : false}
            onLoadMore={viewMode === 'chats' ? loadMoreConversations : undefined}

            // Selection / Generic Mode Props
            isSelectionMode={isSelectionMode}
            onToggleSelectionMode={setIsSelectionMode}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onDelete={handleDelete}
            selectedTaskId={selectedTaskId}
            onSelectTask={handleSelectTask}
            onSelectAll={(select, ids) => {
                const visibleIds = ids && ids.length > 0 ? ids : conversations.map(c => c.id);
                setSelectedIds((prev) => applyVisibleConversationSelection(prev, visibleIds, select));
            }}

            // Deal Mode Props
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            viewFilter={viewFilter}
            onViewFilterChange={setViewFilter}
            deals={deals}
            onSelectDeal={handleSelectDeal}
            onHoverDeal={viewMode === 'deals' ? prefetchDealWorkspaceCore : undefined}
            onImportClick={() => setImportModalOpen(true)}
            onBind={handleBindClick}
            onArchive={viewFilter === 'active' ? handleArchive : undefined}
            onRestore={viewFilter === 'trash' ? handleRestore : undefined}
            onEmptyTrash={viewFilter === 'trash' ? handleEmptyTrash : undefined}
            onNewConversationClick={() => setNewConversationOpen(true)}
            onSyncAllClick={() => setSyncAllOpen(true)}
            disablePreviewCard={isMobileViewport}
        />
    );

    const conversationMainPane = viewMode === 'chats' ? (
        <ChatWorkspacePane
            activeConversation={activeConversation}
            messages={messages}
            activityLog={activityLog}
            loading={isChatLoading}
            isMobileViewport={isMobileViewport}
            onBack={handleBackToList}
            onOpenMissionControl={handleOpenMissionControl}
            onSendMessage={handleSendMessage}
            composerDraft={getComposerDraft(activeConversation?.id)}
            onComposerDraftChange={(draft) => setComposerDraftForConversation(activeConversation?.id, draft)}
            onComposerDraftClear={() => clearComposerDraftForConversation(activeConversation?.id)}
            onTranslateMessage={handleTranslateMessage}
            onTranslateVisibleThread={handleTranslateVisibleThread}
            onPreviewTranslatedReply={handlePreviewTranslatedReply}
            translationReadEnabled={featureFlags.conversationTranslationRead}
            translationWriteEnabled={featureFlags.conversationTranslationWrite}
            translationBannerEnabled={featureFlags.conversationTranslationBanner}
            smsRelayEnabled={featureFlags.smsRelayEnabled}
            onResendMessage={handleResendMessage}
            onSendMedia={handleSendMedia}
            onRefetchMedia={handleRefetchMedia}
            onRequestTranscript={handleRequestTranscript}
            onExtractViewingNotes={handleExtractViewingNotes}
            onRetryTranscript={handleRetryTranscript}
            onBulkTranscribeUnprocessedAudio={handleBulkTranscribeUnprocessedAudio}
            transcriptOnDemandEnabled={transcriptOnDemandEnabled}
            onSync={handleSync}
            onAddActivityEntry={handleChatAddActivityEntry}
            onFetchHistory={handleChatFetchHistory}
            suggestions={[...(activeConversation?.suggestedActions || []), ...suggestions]}
            suggestedResponseQueue={suggestedResponseQueue}
            suggestedResponseQueueLoading={loadingSuggestedResponseQueue}
            onAcceptSuggestedResponse={handleAcceptSuggestedResponse}
            onRejectSuggestedResponse={handleRejectSuggestedResponse}
            composerInsertSeed={composerInsertSeed}
            onGenerateDraft={handleChatGenerateDraft}
            onSetReplyLanguageOverride={handleChatSetReplyLanguageOverride}
            onInitialPaintReady={handleChatInitialPaintReady}
        />
    ) : (
        <DealWorkspacePane
            activeDealId={activeDealId}
            activeDealTitle={activeDealTitle}
            timelineEvents={dealTimelineEvents}
            loading={isDealLoading}
            hydrationStatus={dealTimelineHydrationStatus}
            selectedDealConversation={selectedDealConversation}
            isMobileViewport={isMobileViewport}
            loadingDealContext={loadingDealContext}
            suggestions={suggestions}
            suggestedResponseQueue={suggestedResponseQueue}
            suggestedResponseQueueLoading={loadingSuggestedResponseQueue}
            composerInsertSeed={composerInsertSeed}
            composerDraft={getComposerDraft(selectedDealConversation?.id)}
            translationWriteEnabled={featureFlags.conversationTranslationWrite}
            onBack={handleBackToList}
            onOpenMissionControl={handleOpenMissionControl}
            onInitialPaintReady={handleDealInitialPaintReady}
            onSendMessage={(text, type, options) => handleSendMessage(text, type, options, selectedDealConversation || undefined)}
            onComposerDraftChange={(draft) => setComposerDraftForConversation(selectedDealConversation?.id, draft)}
            onComposerDraftClear={() => clearComposerDraftForConversation(selectedDealConversation?.id)}
            onResendMessage={handleResendMessage}
            onSendMedia={(file, caption) => handleSendMedia(file, caption, selectedDealConversation || undefined)}
            onPreviewTranslatedReply={handleDealPreviewTranslatedReply}
            onGenerateDraft={handleDealGenerateDraft}
            onSetReplyLanguageOverride={handleDealSetReplyLanguageOverride}
            onAcceptSuggestedResponse={handleAcceptSuggestedResponse}
            onRejectSuggestedResponse={handleRejectSuggestedResponse}
        />
    );

    const missionControlPane = viewMode === 'chats' ? (
        activeConversation ? (
            <CoordinatorPanel
                locationId={locationId}
                conversation={activeConversation}
                selectedConversations={isSelectionMode ? selectedConversations : undefined}
                initialContactContext={workspaceContactContext}
                initialTaskSummary={workspaceTaskSummary}
                initialViewingSummary={workspaceViewingSummary}
                initialAgentSummary={workspaceAgentSummary}
                lazySidebarDataEnabled={featureFlags.lazySidebarData}
                onBackToConversation={isMobileViewport ? handleBackToConversation : undefined}
                onDraftApproved={(text) => handleSendMessage(text, getConversationMessageType(activeConversation))}
                onDeselect={(id) => handleToggleSelect(id, false)}
                onSuggestionsGenerated={handleMissionSuggestionsGenerated}
                onContactSaved={(patch) => handleConversationContactSaved(activeConversation.id, patch)}
                onContactMerged={(targetId, targetConvId) => handleContactMerged(activeConversation.id, targetId, targetConvId)}
            />
        ) : <div className="h-full bg-slate-50" />
    ) : (
        dealMissionConversation ? (
            <CoordinatorPanel
                locationId={locationId}
                conversation={dealMissionConversation}
                selectedConversations={activeDealParticipants}
                existingDealContextId={activeDealId}
                existingDealTitle={activeDealTitle}
                initialContactContext={workspaceContactContext}
                initialTaskSummary={workspaceTaskSummary}
                initialViewingSummary={workspaceViewingSummary}
                initialAgentSummary={workspaceAgentSummary}
                lazySidebarDataEnabled={featureFlags.lazySidebarData}
                onBackToConversation={isMobileViewport ? handleBackToConversation : undefined}
                onDraftApproved={(text) => handleSendMessage(text, getConversationMessageType(dealMissionConversation), undefined, dealMissionConversation)}
                onDeselect={() => undefined} // No deselect in deal mode
                onSuggestionsGenerated={handleMissionSuggestionsGenerated}
                onContactSaved={(patch) => handleConversationContactSaved(dealMissionConversation.id, patch)}
                onContactMerged={(targetId, targetConvId) => handleContactMerged(dealMissionConversation.id, targetId, targetConvId)}
                dealContacts={dealContacts}
                selectedDealConversationId={dealMissionConversation.id}
                onSelectDealConversation={(conversationId) => setActiveId(conversationId)}
            />
        ) : (
            <div className="h-full bg-slate-50 p-4 text-center text-gray-400 text-xs flex flex-col items-center justify-center">
                {loadingDealContext
                    ? 'Loading deal context...'
                    : !dealTimelineInitialPainted
                        ? 'Preparing timeline...'
                        : (activeDealEnrichmentStatus === 'pending' || activeDealEnrichmentStatus === 'processing')
                            ? 'Finalizing deal enrichment...'
                            : 'Select a deal contact to view context.'}
            </div>
        )
    );

    const mobilePaneContent: Record<MobilePane, ReactNode> = {
        list: conversationListPane,
        window: conversationMainPane,
        mission: missionControlPane,
    };

    useEffect(() => {
        if (process.env.NODE_ENV !== 'development') return;
        if (!isMobileViewport) return;

        const root = mobilePaneHostRef.current;
        if (!root) return;

        const detectOverflow = () => {
            if (!mobilePaneHostRef.current) return;
            const paneRoot = mobilePaneHostRef.current;
            const overflowX = paneRoot.scrollWidth - paneRoot.clientWidth;
            if (overflowX <= 1) return;

            let culprit: HTMLElement | null = null;
            let culpritOverflow = 0;
            const descendants = paneRoot.querySelectorAll<HTMLElement>('*');
            descendants.forEach((el) => {
                if (!el.clientWidth) return;
                const delta = el.scrollWidth - el.clientWidth;
                if (delta > culpritOverflow + 1) {
                    culpritOverflow = delta;
                    culprit = el;
                }
            });

            const culpritElement = culprit as HTMLElement | null;
            const culpritDetails = culpritElement ? {
                tag: culpritElement.tagName.toLowerCase(),
                className: culpritElement.className,
                clientWidth: culpritElement.clientWidth,
                scrollWidth: culpritElement.scrollWidth,
                noPaneSwipe: culpritElement.hasAttribute('data-no-pane-swipe'),
                horizontalScroll: culpritElement.hasAttribute('data-horizontal-scroll'),
            } : null;

            console.warn('[Conversations Mobile Overflow]', {
                pane: currentMobilePane,
                rootClientWidth: paneRoot.clientWidth,
                rootScrollWidth: paneRoot.scrollWidth,
                overflowX,
                culprit: culpritDetails,
            });
        };

        const rafId = requestAnimationFrame(detectOverflow);
        const timeoutId = window.setTimeout(detectOverflow, 350);
        return () => {
            cancelAnimationFrame(rafId);
            clearTimeout(timeoutId);
        };
    }, [
        isMobileViewport,
        currentMobilePane,
        messages.length,
        conversations.length,
        activityLog.length,
        activeId,
        activeDealId,
        viewMode,
    ]);

    return (
        <>
            {isMobileViewport ? (
                <div
                    ref={mobilePaneContainerRef}
                    className="relative h-full w-full overflow-hidden touch-pan-y"
                    onTouchStart={handleMobileTouchStart}
                    onTouchMove={handleMobileTouchMove}
                    onTouchEnd={handleMobileTouchEnd}
                >
                    <div
                        ref={mobilePaneHostRef}
                        className="h-full w-full min-w-0 max-w-full overflow-x-hidden"
                        data-mobile-pane={currentMobilePane}
                    >
                        {mobilePaneContent[currentMobilePane]}
                    </div>
                    {mobilePaneHint && (
                        <div className="pointer-events-none absolute bottom-2 left-1/2 z-20 -translate-x-1/2 rounded-full bg-slate-900/75 px-3 py-1 text-[10px] font-medium text-white">
                            {mobilePaneHint}
                        </div>
                    )}
                </div>
            ) : (
                <PanelGroup orientation="horizontal" className="h-full w-full max-w-full overflow-hidden">
                    {/* Left: List */}
                    <Panel
                        defaultSize={24}
                        minSize={18}
                        className="overflow-hidden min-w-0"
                    >
                        {conversationListPane}
                    </Panel>

                    <PanelResizeHandle
                        className="w-1 bg-gray-200 hover:bg-blue-400 transition-colors z-50 flex flex-col justify-center"
                        style={{ width: '2px', cursor: 'col-resize' }}
                    />

                    {/* Center: Chat */}
                    <Panel defaultSize={52} minSize={36} className="overflow-hidden min-w-0">
                        {conversationMainPane}
                    </Panel>

                    <PanelResizeHandle
                        className="w-1 bg-gray-200 hover:bg-blue-400 transition-colors z-50"
                        style={{ width: '1px', cursor: 'col-resize' }}
                    />

                    {/* Right: AI Coordinator */}
                    <Panel defaultSize={24} minSize={20} className="min-w-0">
                        {missionControlPane}
                    </Panel>
                </PanelGroup>
            )}

            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Move to Trash?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {idsToDelete.length} conversation{idsToDelete.length > 1 ? 's' : ''} will be moved to trash. You can restore them within 30 days or delete them permanently.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={executeDelete} className="bg-orange-600 hover:bg-orange-700">
                            Move to Trash
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={permanentDeleteDialogOpen} onOpenChange={setPermanentDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Forever?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. {idsToDelete.length} conversation{idsToDelete.length > 1 ? 's' : ''} will be permanently deleted and cannot be recovered.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={executePermanentDelete} className="bg-red-600 hover:bg-red-700">
                            Delete Forever
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {undoToast && (
                <UndoToast
                    message={undoToast.message}
                    onUndo={undoToast.action}
                    onDismiss={() => setUndoToast(null)}
                />
            )}

            {/* WhatsApp Import Modal */}
            {activeConversation && (
                <WhatsAppImportModal
                    open={importModalOpen}
                    onOpenChange={setImportModalOpen}
                    conversationId={activeConversation.id}
                    contactName={activeConversation.contactName || 'Unknown'}
                    onImportComplete={async () => {
                        // Refresh messages for the active conversation
                        const msgs = await fetchMessages(activeConversation.id, THREAD_REFRESH_MESSAGES_OPTIONS);
                        setMessages(mergeSnapshotPreservingPending(activeConversation.id, msgs));
                        toast({ title: 'Import Complete', description: 'Messages have been imported.' });
                    }}
                />
            )}

            <CreateDealDialog
                open={createDealOpen}
                onOpenChange={setCreateDealOpen}
                onConfirm={executeCreateDeal}
                loading={creatingDeal}
            />

            {/* Sync All WhatsApp Chats Dialog */}
            <SyncAllChatsDialog
                open={syncAllOpen}
                onOpenChange={setSyncAllOpen}
                onComplete={async () => {
                    // Refresh conversations list after sync
                    const data = await fetchConversations(viewFilter, activeId || undefined);
                    replaceConversationListFromResponse(data);
                }}
            />

            {/* New Conversation Dialog */}
            <NewConversationDialog
                open={newConversationOpen}
                onOpenChange={setNewConversationOpen}
                locationId={locationId}
                onConversationCreated={async (conversationId) => {
                    // Refresh conversations list
                    const data = await fetchConversations(viewFilter, conversationId);
                    replaceConversationListFromResponse(data);
                    // Select the new conversation
                    setActiveId(conversationId);
                    toast({ title: "Conversation Created", description: "You can now send messages." });
                }}
            />
        </>
    );
}
