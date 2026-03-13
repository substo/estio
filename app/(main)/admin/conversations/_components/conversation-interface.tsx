'use client';

import { useState, useEffect, useCallback, useRef, type TouchEvent as ReactTouchEvent, type ReactNode } from 'react';
import { useDebounce } from 'use-debounce';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Conversation, Message } from '@/lib/ghl/conversations';
import type { ContactIdentityPatch } from '../../contacts/_components/contact-form';
import {
    fetchConversations,
    fetchMessages,
    getConversationWorkspaceCore,
    getConversationWorkspaceSidebar,
    getConversationListDelta,
    refreshConversationOnDemand,
    sendReply,
    createWhatsAppMediaUploadUrl,
    sendWhatsAppMediaReply,
    generateAIDraft,
    setConversationReplyLanguageOverride,
    deleteConversations,
    restoreConversations,
    archiveConversations,
    unarchiveConversations,
    permanentlyDeleteConversations,
    syncWhatsAppHistory,
    refreshConversation,
    markConversationAsRead,
    refetchWhatsAppMediaAttachment,
    retryWhatsAppAudioTranscript,
    requestWhatsAppAudioTranscript,
    bulkRequestWhatsAppAudioTranscripts,
    extractWhatsAppViewingNotes,
    searchConversations,
    fetchConversationActivityLog,
    addConversationActivityEntry,
    listSuggestedResponses,
    acceptSuggestedResponse,
    rejectSuggestedResponse,
} from '../actions';
import { toast } from '@/components/ui/use-toast';
import { getDealContexts, createPersistentDeal, getDealContext } from '../../deals/actions';
import { shouldApplyRealtimeEnvelope } from '@/lib/conversations/realtime-merge';
import {
    getWorkspaceCoreCacheEntry,
    setWorkspaceCoreCacheEntry,
} from '@/lib/conversations/workspace-core-cache';
import {
    THREAD_INITIAL_FALLBACK_MESSAGES,
    THREAD_TARGET_MESSAGE_COUNT,
    buildMessageCursorFromMessage,
    computeInitialMessageLimitFromViewport,
    mergePrependMessagesDedupe,
} from '@/lib/conversations/thread-hydration';
import { UnifiedTimeline } from './unified-timeline';
import { ConversationList } from './conversation-list';
import { ChatWindow } from './chat-window';
import { CoordinatorPanel } from './coordinator-panel';
import { UndoToast } from './undo-toast';
import { WhatsAppImportModal } from './whatsapp-import-modal';
import { CreateDealDialog } from './create-deal-dialog';
import { SyncAllChatsDialog } from './sync-all-chats-dialog';
import { NewConversationDialog } from './new-conversation-dialog';
import type { SuggestedResponseQueueItem } from './suggested-response-queue';
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


interface ConversationInterfaceProps {
    locationId: string;
    initialConversations: Conversation[];
    initialConversationListPageInfo?: {
        hasMore: boolean;
        nextCursor: string | null;
        deltaCursor?: string | null;
    };
    featureFlags: ConversationFeatureFlags;
}

type MobilePane = 'list' | 'window' | 'mission';
type SwipeDirection = 'left' | 'right';
type MobileGestureState = {
    startX: number;
    startY: number;
    startTime: number;
    lastX: number;
    lastY: number;
    lastTime: number;
    containerWidth: number;
    containerLeft: number;
    target: EventTarget | null;
    blocked: boolean;
};

const MOBILE_EDGE_SWIPE_ZONE_PX = 16;
const MOBILE_MIN_SWIPE_DISTANCE_PX = 72;
const MOBILE_MIN_SWIPE_VELOCITY = 0.32; // px / ms
const MOBILE_HORIZONTAL_DOMINANCE_RATIO = 1.2;

function isTextInputLikeTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    if (target.closest('[data-no-pane-swipe]')) return true;
    return !!target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
}

function getHorizontalScrollableAncestor(target: EventTarget | null, boundary: HTMLElement | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    let current: HTMLElement | null = target as HTMLElement;

    while (current) {
        const explicitHorizontalScroll = current.hasAttribute('data-horizontal-scroll');
        const style = window.getComputedStyle(current);
        const overflowX = style.overflowX;
        const canScrollByStyle = overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay';
        const hasHorizontalOverflow = current.scrollWidth > current.clientWidth + 1;

        if ((explicitHorizontalScroll || canScrollByStyle) && hasHorizontalOverflow) {
            return current;
        }

        if (boundary && current === boundary) break;
        current = current.parentElement;
    }

    return null;
}

function canHorizontalScrollerConsumeGesture(scroller: HTMLElement, direction: SwipeDirection): boolean {
    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
    if (maxScrollLeft <= 1) return false;

    if (direction === 'left') {
        // Finger moved left; user likely intends to reveal content on the right.
        return scroller.scrollLeft < maxScrollLeft - 1;
    }

    // Finger moved right; user likely intends to reveal content on the left.
    return scroller.scrollLeft > 1;
}

/**
 * Derive the message type from the conversation's lastMessageType
 */
function getMessageType(conversation: Conversation): 'SMS' | 'Email' | 'WhatsApp' {
    const type = (conversation.lastMessageType || conversation.type || '').toUpperCase();
    if (type.includes('EMAIL')) return 'Email';
    if (type.includes('WHATSAPP')) return 'WhatsApp';
    return 'SMS'; // Default fallback
}

function getMessageSignature(messages: Message[]): string {
    if (!messages || messages.length === 0) return '0';
    const compact = messages.map((message) => {
        const attachmentSignature = (message.attachments || []).map((attachment) => {
            if (typeof attachment === "string") return `s:${attachment.length}`;
            const transcript = attachment.transcript;
            const extraction = transcript?.extraction;
            return [
                attachment.id || "",
                transcript?.status || "",
                String(transcript?.text || "").length,
                String(transcript?.error || "").length,
                transcript?.updatedAt || "",
                extraction?.status || "",
                extraction?.updatedAt || "",
                String(extraction?.error || "").length,
                extraction?.payload ? JSON.stringify(extraction.payload).length : 0,
            ].join(":");
        }).join(",");

        return [
            message.id,
            message.status,
            message.dateAdded,
            String(message.body || "").length,
            attachmentSignature,
        ].join("|");
    }).join(";");

    return `${messages.length}:${compact}`;
}

function hasPendingTranscripts(messages: Message[]): boolean {
    return (messages || []).some((message) =>
        (message.attachments || []).some((attachment) =>
            typeof attachment !== "string"
            && !!attachment.transcript
            && (
                attachment.transcript.status === "pending"
                || attachment.transcript.status === "processing"
                || attachment.transcript.extraction?.status === "pending"
                || attachment.transcript.extraction?.status === "processing"
            )
        )
    );
}

type WorkspaceHydrationStatus = 'partial' | 'full';

type WorkspaceHydrationState = {
    status: WorkspaceHydrationStatus;
    oldestCursor: string | null;
    newestCursor: string | null;
    initialCount: number;
    targetCount: number;
    requestedLimit: number;
};

type WorkspaceCoreSnapshot = {
    conversationHeader: Conversation | null;
    messages: Message[];
    activityTimeline: any[];
    transcriptOnDemandEnabled: boolean;
    hydration: WorkspaceHydrationState;
};

const WORKSPACE_CACHE_LIMIT = 30;
const WORKSPACE_ACTIVITY_LIMIT = 180;
const ACTIVE_POLL_GRACE_MS = 2500;

type WorkspaceMessageWindowLike = {
    oldestCursor?: string | null;
    newestCursor?: string | null;
    count?: number;
    requestedLimit?: number;
} | null | undefined;

function createWorkspaceHydrationState(args: {
    status?: WorkspaceHydrationStatus;
    messages: Message[];
    messageWindow?: WorkspaceMessageWindowLike;
    initialCount?: number;
    targetCount?: number;
    requestedLimit?: number;
}): WorkspaceHydrationState {
    const messages = Array.isArray(args.messages) ? args.messages : [];
    const messageWindow = args.messageWindow;
    const derivedInitialCount = Number(args.initialCount);
    const derivedTargetCount = Number(args.targetCount);
    const derivedRequestedLimit = Number(args.requestedLimit);
    const resolvedCount = Number(messageWindow?.count);
    const resolvedRequestedLimit = Number(messageWindow?.requestedLimit);

    return {
        status: args.status || 'full',
        oldestCursor: messageWindow?.oldestCursor || buildMessageCursorFromMessage(messages[0]) || null,
        newestCursor: messageWindow?.newestCursor || buildMessageCursorFromMessage(messages[messages.length - 1]) || null,
        initialCount: Number.isFinite(derivedInitialCount)
            ? Math.max(0, Math.floor(derivedInitialCount))
            : (Number.isFinite(resolvedCount) ? Math.max(0, Math.floor(resolvedCount)) : messages.length),
        targetCount: Number.isFinite(derivedTargetCount)
            ? Math.max(1, Math.floor(derivedTargetCount))
            : THREAD_TARGET_MESSAGE_COUNT,
        requestedLimit: Number.isFinite(derivedRequestedLimit)
            ? Math.max(1, Math.floor(derivedRequestedLimit))
            : (Number.isFinite(resolvedRequestedLimit)
                ? Math.max(1, Math.floor(resolvedRequestedLimit))
                : Math.max(messages.length || 0, THREAD_INITIAL_FALLBACK_MESSAGES)),
    };
}

function createWorkspaceCoreSnapshot(args: {
    conversationHeader?: Conversation | null;
    messages?: Message[];
    activityTimeline?: any[];
    transcriptEligibility?: { success?: boolean; enabled?: boolean } | null;
    transcriptOnDemandEnabled?: boolean;
    hydration: WorkspaceHydrationState;
}): WorkspaceCoreSnapshot {
    return {
        conversationHeader: args.conversationHeader || null,
        messages: Array.isArray(args.messages) ? args.messages : [],
        activityTimeline: Array.isArray(args.activityTimeline) ? args.activityTimeline : [],
        transcriptOnDemandEnabled: typeof args.transcriptOnDemandEnabled === 'boolean'
            ? args.transcriptOnDemandEnabled
            : (!!args.transcriptEligibility?.success && !!args.transcriptEligibility?.enabled),
        hydration: args.hydration,
    };
}

function estimateThreadViewportHeightPx(): number | null {
    if (typeof window === 'undefined') return null;
    const viewportHeight = Number(window.innerHeight);
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return null;
    // Approximate header/composer/padding chrome to derive visible thread area.
    return Math.max(viewportHeight - 280, 320);
}

interface DealContactOption {
    conversationId: string;
    contactId: string;
    contactName: string;
    contactEmail?: string;
    contactPhone?: string;
    lastMessageDate: number;
    unreadCount?: number;
    lastMessageType?: string;
}

function buildDealContactOptions(participants: Conversation[]): DealContactOption[] {
    const byContact = new Map<string, DealContactOption>();

    for (const conversation of participants) {
        const key = String(
            conversation.contactId
            || conversation.contactEmail
            || conversation.contactPhone
            || conversation.id
        );

        const candidate: DealContactOption = {
            conversationId: conversation.id,
            contactId: conversation.contactId,
            contactName: conversation.contactName || "Unknown Contact",
            contactEmail: conversation.contactEmail,
            contactPhone: conversation.contactPhone,
            lastMessageDate: Number(conversation.lastMessageDate || 0),
            unreadCount: conversation.unreadCount,
            lastMessageType: conversation.lastMessageType,
        };

        const current = byContact.get(key);
        if (!current || candidate.lastMessageDate > current.lastMessageDate) {
            byContact.set(key, candidate);
        }
    }

    return Array.from(byContact.values()).sort((a, b) => b.lastMessageDate - a.lastMessageDate);
}

export function ConversationInterface({ locationId, initialConversations, initialConversationListPageInfo, featureFlags }: ConversationInterfaceProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [isMobileViewport, setIsMobileViewport] = useState(false);
    const [mobilePane, setMobilePane] = useState<MobilePane>('list');
    const hasInitializedMobilePaneRef = useRef(false);
    const mobileGestureRef = useRef<MobileGestureState | null>(null);
    const mobilePaneContainerRef = useRef<HTMLDivElement | null>(null);
    const mobilePaneHostRef = useRef<HTMLDivElement | null>(null);

    const updateUrl = useCallback((updates: Record<string, string | null>) => {
        let params: URLSearchParams;
        let nextPathname = pathname;

        if (typeof window !== 'undefined') {
            const currentUrl = new URL(window.location.href);
            params = new URLSearchParams(currentUrl.search);
            nextPathname = currentUrl.pathname;
        } else {
            params = new URLSearchParams(searchParams.toString());
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
    }, [featureFlags.shallowUrlSync, pathname, router, searchParams]);

    // Initialize state from URL or props
    // Map URL 'inbox' to internal 'active' if needed, but 'active' is the internal string. 
    // Let's support 'inbox' in URL for user friendliness
    const urlView = searchParams.get('view');
    const normalizedViewFilter = (urlView === 'inbox' ? 'active' : urlView) as 'active' | 'archived' | 'trash' | 'tasks' || 'active';

    const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
    const conversationsRef = useRef<Conversation[]>(initialConversations);
    const [messages, setMessages] = useState<Message[]>([]);
    const messagesRef = useRef<Message[]>([]);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const messageSignatureRef = useRef<string>('0');
    const [activityLog, setActivityLog] = useState<any[]>([]);
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
    const workspaceCoreCacheRef = useRef<Map<string, WorkspaceCoreSnapshot>>(new Map());
    const workspaceCoreInFlightRef = useRef<Set<string>>(new Set());
    const workspaceInitialHydrationInFlightRef = useRef<Set<string>>(new Set());
    const workspaceBackfillInFlightRef = useRef<Set<string>>(new Set());
    const workspaceActivityHydrationInFlightRef = useRef<Set<string>>(new Set());
    const initialWorkspaceLoadedAtRef = useRef<Record<string, number>>({});
    const [realtimeMode, setRealtimeMode] = useState<'disabled' | 'connecting' | 'connected' | 'fallback'>(
        featureFlags.realtimeSse ? 'connecting' : 'disabled'
    );
    const realtimeEventIdsRef = useRef<Set<string>>(new Set());
    const realtimeEventLastTsByConversationRef = useRef<Record<string, number>>({});
    const realtimeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const readResetInFlightRef = useRef<Set<string>>(new Set());

    // Initialize Active ID from URL
    const initialActiveId = searchParams.get('id') || (initialConversations.length > 0 ? initialConversations[0].id : null);
    const [activeId, setActiveId] = useState<string | null>(initialActiveId);
    const activeIdRef = useRef<string | null>(initialActiveId);

    // View Mode State (inbox, archived, trash)
    const [viewFilter, setViewFilter] = useState<'active' | 'archived' | 'trash' | 'tasks'>(normalizedViewFilter);

    // Deal Mode State
    const initialViewMode = (searchParams.get('mode') as 'chats' | 'deals') || 'chats';
    const [viewMode, setViewMode] = useState<'chats' | 'deals'>(initialViewMode);

    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery] = useDebounce(searchQuery, 300);
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<Conversation[]>([]);

    const [deals, setDeals] = useState<any[]>([]);
    const [activeDealParticipants, setActiveDealParticipants] = useState<Conversation[]>([]);
    const [dealContacts, setDealContacts] = useState<DealContactOption[]>([]);
    const [loadingDealContext, setLoadingDealContext] = useState(false);
    const [dealTimelineRefreshToken, setDealTimelineRefreshToken] = useState(0);

    useEffect(() => {
        setConversations(initialConversations);
        conversationsRef.current = initialConversations;
        setConversationListHasMore(!!initialConversationListPageInfo?.hasMore);
        setConversationListNextCursor(initialConversationListPageInfo?.nextCursor || null);
        setConversationDeltaCursor(initialConversationListPageInfo?.deltaCursor || null);
        conversationDeltaCursorRef.current = initialConversationListPageInfo?.deltaCursor || null;
    }, [initialConversations, initialConversationListPageInfo?.hasMore, initialConversationListPageInfo?.nextCursor, initialConversationListPageInfo?.deltaCursor]);

    // Global Search Effect
    useEffect(() => {
        if (!debouncedSearchQuery.trim()) {
            setSearchResults([]);
            setIsSearching(false);
            return;
        }

        let isCancelled = false;
        setIsSearching(true);

        searchConversations(debouncedSearchQuery, { limit: 50 })
            .then(res => {
                if (isCancelled) return;
                if (res.success) {
                    setSearchResults(res.conversations || []);
                } else {
                    toast({ title: "Search Failed", description: String(res.error), variant: "destructive" });
                    setSearchResults([]);
                }
            })
            .catch(err => {
                if (isCancelled) return;
                console.error("Search failed:", err);
                toast({ title: "Error", description: "Search failed.", variant: "destructive" });
            })
            .finally(() => {
                if (!isCancelled) setIsSearching(false);
            });

        return () => {
            isCancelled = true;
        };
    }, [debouncedSearchQuery]);

    const initialDealId = searchParams.get('dealId');
    const initialUrlConversationId = searchParams.get('id');
    const [urlConversationId, setUrlConversationId] = useState<string | null>(initialUrlConversationId);
    const [activeDealId, setActiveDealId] = useState<string | null>(initialDealId);
    const [transcriptOnDemandEnabled, setTranscriptOnDemandEnabled] = useState(false);

    useEffect(() => {
        setRealtimeMode(featureFlags.realtimeSse ? 'connecting' : 'disabled');
    }, [featureFlags.realtimeSse]);

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
            const nextMode = (params.get('mode') as 'chats' | 'deals') || 'chats';
            const nextDealId = params.get('dealId');

            setUrlConversationId(nextId);
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
        if (typeof window === 'undefined') return;
        const mediaQuery = window.matchMedia('(max-width: 1023px)');
        const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
        updateViewport();
        mediaQuery.addEventListener('change', updateViewport);
        return () => mediaQuery.removeEventListener('change', updateViewport);
    }, []);

    useEffect(() => {
        if (!isMobileViewport) return;
        if (viewMode === 'deals') return;
        if (urlConversationId) return;
        if (!activeIdRef.current) return;
        setActiveId(null);
    }, [isMobileViewport, viewMode, urlConversationId]);

    useEffect(() => {
        if (!isMobileViewport) {
            hasInitializedMobilePaneRef.current = false;
            setMobilePane('list');
            return;
        }

        if (hasInitializedMobilePaneRef.current) return;
        hasInitializedMobilePaneRef.current = true;
        if (viewMode === 'deals') {
            setMobilePane(activeDealId ? 'window' : 'list');
            return;
        }
        setMobilePane(urlConversationId ? 'window' : 'list');
    }, [isMobileViewport, viewMode, activeDealId, urlConversationId]);

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
            id: activeId
        });
        setUrlConversationId(activeId);
    }, [viewFilter, activeId, updateUrl]);

    useEffect(() => {
        activeIdRef.current = activeId;
    }, [activeId]);

    useEffect(() => {
        conversationsRef.current = conversations;
    }, [conversations]);

    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    useEffect(() => {
        conversationDeltaCursorRef.current = conversationDeltaCursor;
    }, [conversationDeltaCursor]);

    useEffect(() => {
        if (!isMobileViewport) return;
        const hasWindowPane = viewMode === 'deals' ? !!activeDealId : !!activeId;
        if (!hasWindowPane && mobilePane !== 'list') {
            setMobilePane('list');
        }
    }, [isMobileViewport, viewMode, activeId, activeDealId, mobilePane]);

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

    const isWorkspaceHydrationBusy = useCallback((conversationId?: string | null) => {
        const key = String(conversationId || "");
        if (!key) return false;
        return (
            workspaceInitialHydrationInFlightRef.current.has(key)
            || workspaceBackfillInFlightRef.current.has(key)
            || workspaceActivityHydrationInFlightRef.current.has(key)
        );
    }, []);

    const cacheWorkspaceCoreSnapshot = useCallback((conversationId: string, snapshot: WorkspaceCoreSnapshot) => {
        setWorkspaceCoreCacheEntry(
            workspaceCoreCacheRef.current,
            conversationId,
            snapshot,
            WORKSPACE_CACHE_LIMIT
        );
    }, []);

    const getCachedWorkspaceCoreSnapshot = useCallback((conversationId: string): WorkspaceCoreSnapshot | null => {
        return getWorkspaceCoreCacheEntry(workspaceCoreCacheRef.current, conversationId);
    }, []);

    const applyWorkspaceCoreSnapshot = useCallback((conversationId: string, snapshot: WorkspaceCoreSnapshot) => {
        const nextMessages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
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
    }, []);

    const prefetchWorkspaceCore = useCallback(async (conversationId: string) => {
        if (!conversationId) return;
        if (workspaceCoreCacheRef.current.has(conversationId)) return;
        if (workspaceCoreInFlightRef.current.has(conversationId)) return;

        workspaceCoreInFlightRef.current.add(conversationId);
        try {
            trackClientRequest("workspace_core_prefetch", { conversationId });
            const prefetchedLimit = computeInitialMessageLimitFromViewport(estimateThreadViewportHeightPx());
            const workspace = await getConversationWorkspaceCore(conversationId, {
                includeMessages: true,
                includeActivity: false,
                messageLimit: prefetchedLimit,
                activityLimit: WORKSPACE_ACTIVITY_LIMIT,
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
            cacheWorkspaceCoreSnapshot(conversationId, createWorkspaceCoreSnapshot({
                conversationHeader: workspace?.conversationHeader || null,
                messages: prefetchedMessages,
                activityTimeline: [],
                transcriptEligibility: workspace?.transcriptEligibility,
                hydration,
            }));
        } catch (error) {
            console.error("Workspace prefetch failed:", error);
        } finally {
            workspaceCoreInFlightRef.current.delete(conversationId);
        }
    }, [cacheWorkspaceCoreSnapshot, trackClientRequest]);

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
    }, [viewMode]);

    useEffect(() => {
        if (viewMode !== 'deals' || !activeDealId) {
            setActiveDealParticipants([]);
            setDealContacts([]);
            setLoadingDealContext(false);
            return;
        }

        let cancelled = false;
        setLoadingDealContext(true);

        getDealContext(activeDealId)
            .then((context: any) => {
                if (cancelled) return;

                const rawConversations = Array.isArray(context?.conversations) ? context.conversations : [];
                const normalizedConversations: Conversation[] = rawConversations
                    .map((item: any) => {
                        const parsedDate = Number.isFinite(Number(item?.lastMessageDate))
                            ? Number(item.lastMessageDate)
                            : Math.floor(new Date(item?.lastMessageAt || item?.updatedAt || 0).getTime() / 1000);

                        return {
                            id: String(item?.id || ""),
                            contactId: String(item?.contactId || ""),
                            contactName: item?.contactName || "Unknown Contact",
                            contactPhone: item?.contactPhone || undefined,
                            contactEmail: item?.contactEmail || undefined,
                            lastMessageBody: item?.lastMessageBody || "",
                            lastMessageDate: Number.isFinite(parsedDate) ? parsedDate : 0,
                            unreadCount: Number(item?.unreadCount || 0),
                            status: (item?.status || 'open') as any,
                            type: item?.type || item?.lastMessageType || 'TYPE_SMS',
                            lastMessageType: item?.lastMessageType || undefined,
                            locationId: item?.locationId || "",
                            suggestedActions: Array.isArray(item?.suggestedActions) ? item.suggestedActions : [],
                        } satisfies Conversation;
                    })
                    .filter((conversation: Conversation): conversation is Conversation => !!conversation.id);

                const contacts = buildDealContactOptions(normalizedConversations);
                const availableIds = new Set(normalizedConversations.map((conversation) => conversation.id));

                setActiveDealParticipants(normalizedConversations);
                setDealContacts(contacts);
                setActiveId((prev) => {
                    if (urlConversationId && availableIds.has(urlConversationId)) {
                        return urlConversationId;
                    }
                    if (prev && availableIds.has(prev)) {
                        return prev;
                    }
                    return contacts[0]?.conversationId || normalizedConversations[0]?.id || null;
                });
                setDealTimelineRefreshToken((previous) => previous + 1);
            })
            .catch((error) => {
                if (cancelled) return;
                console.error("Failed to fetch active deal context:", error);
                setActiveDealParticipants([]);
                setDealContacts([]);
            })
            .finally(() => {
                if (!cancelled) {
                    setLoadingDealContext(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [viewMode, activeDealId, urlConversationId]);

    // Multi-selection (what shows in the Context Builder)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isSelectionMode, setIsSelectionMode] = useState(false);

    const hasHydratedListRef = useRef(false);

    const mergeConversationLists = useCallback((existing: Conversation[], incoming: Conversation[]) => {
        const seen = new Set<string>();
        const merged: Conversation[] = [];
        for (const item of [...existing, ...incoming]) {
            if (!item?.id || seen.has(item.id)) continue;
            seen.add(item.id);
            merged.push(item);
        }
        return merged;
    }, []);

    const mergeConversationListsWithIncomingFirst = useCallback((existing: Conversation[], incoming: Conversation[]) => {
        const seen = new Set<string>();
        const merged: Conversation[] = [];
        for (const item of [...incoming, ...existing]) {
            if (!item?.id || seen.has(item.id)) continue;
            seen.add(item.id);
            merged.push(item);
        }
        return merged;
    }, []);

    const replaceConversationListFromResponse = useCallback((data: any) => {
        setConversations(Array.isArray(data?.conversations) ? data.conversations : []);
        setConversationListHasMore(!!data?.hasMore);
        setConversationListNextCursor(typeof data?.nextCursor === 'string' ? data.nextCursor : null);
        if (typeof data?.deltaCursor === 'string' || data?.deltaCursor === null) {
            setConversationDeltaCursor(data?.deltaCursor || null);
            conversationDeltaCursorRef.current = data?.deltaCursor || null;
        }
    }, []);

    const appendConversationPageFromResponse = useCallback((data: any) => {
        setConversations(prev => mergeConversationLists(prev, Array.isArray(data?.conversations) ? data.conversations : []));
        setConversationListHasMore(!!data?.hasMore);
        setConversationListNextCursor(typeof data?.nextCursor === 'string' ? data.nextCursor : null);
        if (typeof data?.deltaCursor === 'string' || data?.deltaCursor === null) {
            setConversationDeltaCursor(data?.deltaCursor || null);
            conversationDeltaCursorRef.current = data?.deltaCursor || null;
        }
    }, [mergeConversationLists]);

    const applyConversationDeltaPayload = useCallback((deltaPayload: any) => {
        const deltas = Array.isArray(deltaPayload?.deltas) ? deltaPayload.deltas : [];
        if (deltas.length === 0) {
            if (typeof deltaPayload?.cursor === 'string' || deltaPayload?.cursor === null) {
                setConversationDeltaCursor(deltaPayload?.cursor || null);
                conversationDeltaCursorRef.current = deltaPayload?.cursor || null;
            }
            return;
        }

        const incoming = deltas
            .filter((item: any) => !!item?.matchesFilter && !!item?.conversation)
            .map((item: any) => item.conversation);
        const removedIds = new Set(
            deltas
                .filter((item: any) => item && item.matchesFilter === false && item.id)
                .map((item: any) => item.id)
        );
        if (activeIdRef.current && removedIds.has(activeIdRef.current)) {
            setActiveId(null);
        }

        setConversations((prev) => {
            const withoutRemoved = removedIds.size > 0
                ? prev.filter((conversation) => !removedIds.has(conversation.id))
                : prev;
            if (incoming.length === 0) return withoutRemoved;
            return mergeConversationListsWithIncomingFirst(withoutRemoved, incoming);
        });

        if (typeof deltaPayload?.cursor === 'string' || deltaPayload?.cursor === null) {
            setConversationDeltaCursor(deltaPayload?.cursor || null);
            conversationDeltaCursorRef.current = deltaPayload?.cursor || null;
        }
    }, [mergeConversationListsWithIncomingFirst]);

    const runRealtimeRefresh = useCallback((conversationId?: string | null) => {
        if (realtimeRefreshTimerRef.current) return;
        realtimeRefreshTimerRef.current = setTimeout(async () => {
            realtimeRefreshTimerRef.current = null;
            if (viewMode !== 'chats' || viewFilter === 'tasks') return;
            if (!isTabVisible) return;
            if (debouncedSearchQuery.trim()) return;

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

                const targetConversationId = String(conversationId || "");
                if (targetConversationId && targetConversationId === activeIdRef.current) {
                    if (isWorkspaceHydrationBusy(targetConversationId)) {
                        trackClientRequest("realtime_refresh_skipped_hydration", { conversationId: targetConversationId });
                        return;
                    }
                    const workspace = await getConversationWorkspaceCore(targetConversationId, {
                        includeMessages: true,
                        includeActivity: true,
                        messageLimit: THREAD_TARGET_MESSAGE_COUNT,
                        activityLimit: WORKSPACE_ACTIVITY_LIMIT,
                    });
                    if (workspace?.success && activeIdRef.current === targetConversationId) {
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
                    }
                }
            } catch (error) {
                console.error("Realtime refresh failed:", error);
            }
        }, 250);
    }, [
        applyConversationDeltaPayload,
        applyWorkspaceCoreSnapshot,
        cacheWorkspaceCoreSnapshot,
        debouncedSearchQuery,
        isWorkspaceHydrationBusy,
        isTabVisible,
        trackClientRequest,
        viewFilter,
        viewMode,
    ]);

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
                setActiveId(null); // Deselect when switching views manually
                setMessages([]);
                setActivityLog([]);
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
            const newDeal = await createPersistentDeal(title, ids);
            toast({ title: "Deal Created", description: `Created "${newDeal.title}" with ${ids.length} conversations.` });

            // Clear selection and mode
            setSelectedIds(new Set());
            setIsSelectionMode(false);
            setCreateDealOpen(false);

            // Optional: Switch to Deals view?
            // setViewMode('deals');
            // setActiveDealId(newDeal.id);
        } catch (e: any) {
            toast({ title: "Error", description: e.message || "Failed to create deal", variant: "destructive" });
        } finally {
            setCreatingDeal(false);
        }
    };

    // Derived State
    const activeConversation = conversations.find(c => c.id === activeId);
    const selectedConversations = conversations.filter(c => selectedIds.has(c.id));
    const selectedDealConversation = activeDealParticipants.find((conversation) => conversation.id === activeId) || null;

    // Fetch Messages when active selection changes
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
        setWorkspaceContactContext(null);
        setWorkspaceTaskSummary(null);
        setWorkspaceViewingSummary(null);
        setWorkspaceAgentSummary(null);
        initialWorkspaceLoadedAtRef.current[selectedConversationId] = 0;

        const cachedSnapshot = getCachedWorkspaceCoreSnapshot(selectedConversationId);
        if (cachedSnapshot) {
            applyWorkspaceCoreSnapshot(selectedConversationId, cachedSnapshot);
            setLoadingMessages(false);
        } else {
            setMessages([]);
            setActivityLog([]);
            setTranscriptOnDemandEnabled(false);
            setLoadingMessages(true);
        }

        if (!featureFlags.workspaceV2) {
            trackClientRequest("legacy_selection_load", { conversationId: selectedConversationId });
            Promise.all([
                fetchMessages(selectedConversationId),
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

            return () => {
                cancelled = true;
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
                    activityLimit: WORKSPACE_ACTIVITY_LIMIT,
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
                    thread_open_initial_ms: initialOpenMs,
                    initial_message_count: initialMessages.length,
                    rendered_message_count: mergedInitialMessages.length,
                    requested_initial_limit: initialMessageLimit,
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
                                activityLimit: WORKSPACE_ACTIVITY_LIMIT,
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
            trackClientRequest("workspace_sidebar_load", { conversationId: selectedConversationId });
            try {
                const sidebar = await getConversationWorkspaceSidebar(selectedConversationId);
                if (cancelled || activeIdRef.current !== selectedConversationId) return;
                if (!sidebar?.success) return;

                setWorkspaceContactContext(sidebar?.contactContext || null);
                setWorkspaceTaskSummary(sidebar?.taskSummary || null);
                setWorkspaceViewingSummary(sidebar?.viewingSummary || null);
                setWorkspaceAgentSummary(sidebar?.agentSummary || null);
            } catch (err) {
                if (!cancelled) {
                    console.error("Failed to load conversation workspace sidebar:", err);
                }
            }
        };

        void loadWorkspaceCore();
        void loadWorkspaceSidebar();

        return () => {
            cancelled = true;
            clearDeferredHydrationTimer();
            workspaceInitialHydrationInFlightRef.current.delete(selectedConversationId);
            workspaceBackfillInFlightRef.current.delete(selectedConversationId);
            workspaceActivityHydrationInFlightRef.current.delete(selectedConversationId);
        };
    }, [
        viewMode,
        activeId,
        markConversationReadInUi,
        featureFlags.workspaceV2,
        trackClientRequest,
        getCachedWorkspaceCoreSnapshot,
        applyWorkspaceCoreSnapshot,
        cacheWorkspaceCoreSnapshot,
    ]);

    useEffect(() => {
        if (viewMode !== 'chats' || viewFilter === 'tasks') return;
        if (!isTabVisible) return;
        if (debouncedSearchQuery.trim()) return;
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
    }, [viewMode, viewFilter, isTabVisible, debouncedSearchQuery, featureFlags.balancedPolling, featureFlags.workspaceV2, featureFlags.realtimeSse, realtimeMode, applyConversationDeltaPayload, markConversationReadInUi, replaceConversationListFromResponse, trackClientRequest]);

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

                if (isWorkspaceHydrationBusy(selectedConversationId)) {
                    trackClientRequest("active_delta_poll_skipped_hydration", { conversationId: selectedConversationId });
                    return;
                }

                trackClientRequest("active_delta_poll", { conversationId: selectedConversationId, pendingTranscripts });
                const workspace = await getConversationWorkspaceCore(selectedConversationId, {
                    includeMessages: true,
                    includeActivity: true,
                    messageLimit: THREAD_TARGET_MESSAGE_COUNT,
                    activityLimit: WORKSPACE_ACTIVITY_LIMIT,
                });
                if (cancelled || !workspace?.success || activeIdRef.current !== selectedConversationId) return;

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
                cacheWorkspaceCoreSnapshot(selectedConversationId, snapshot);
                applyWorkspaceCoreSnapshot(selectedConversationId, snapshot);
                initialWorkspaceLoadedAtRef.current[selectedConversationId] = Date.now();

                if ((workspace?.conversationHeader?.unreadCount || 0) > 0) {
                    void markConversationReadInUi(selectedConversationId);
                }
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
    }, [viewMode, activeId, isTabVisible, featureFlags.balancedPolling, featureFlags.workspaceV2, featureFlags.realtimeSse, realtimeMode, isWorkspaceHydrationBusy, markConversationReadInUi, trackClientRequest, applyWorkspaceCoreSnapshot, cacheWorkspaceCoreSnapshot]);

    useEffect(() => {
        if (!featureFlags.realtimeSse) {
            setRealtimeMode('disabled');
            return;
        }

        if (viewMode !== 'chats' || viewFilter === 'tasks' || !isTabVisible || debouncedSearchQuery.trim()) {
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
                const event = JSON.parse(rawData || "{}");
                const conversationId = event?.conversationId ? String(event.conversationId) : null;
                const shouldApply = shouldApplyRealtimeEnvelope(
                    {
                        seenEventIds: realtimeEventIdsRef.current,
                        lastTsByConversationId: realtimeEventLastTsByConversationRef.current,
                    },
                    {
                        id: event?.id ? String(event.id) : null,
                        conversationId,
                        ts: event?.ts ? String(event.ts) : null,
                    },
                    { maxTrackedEventIds: 1000 }
                );
                if (!shouldApply) return;

                runRealtimeRefresh(conversationId);
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
    }, [featureFlags.realtimeSse, viewMode, viewFilter, isTabVisible, debouncedSearchQuery, runRealtimeRefresh]);

    useEffect(() => {
        if (viewMode !== 'chats') return;

        const candidateIds = conversations
            .filter((conversation) => conversation.id !== activeId)
            .slice(0, 3)
            .map((conversation) => conversation.id);

        if (candidateIds.length === 0) return;

        let cancelled = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        let idleHandle: number | null = null;

        const runPrefetch = () => {
            if (cancelled) return;
            for (const conversationId of candidateIds) {
                void prefetchWorkspaceCore(conversationId);
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
    }, [viewMode, activeId, conversations, prefetchWorkspaceCore]);

    // Handle clicking a conversation in the list
    const handleSelect = (id: string) => {
        setActiveId(id);
        markConversationReadInUi(id);
        if (isMobileViewport) {
            setMobilePane('window');
        }
    };

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

    const handleMobileTouchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
        if (!isMobileViewport) return;
        const touch = event.changedTouches[0];
        if (!touch) return;

        const containerRect = event.currentTarget.getBoundingClientRect();
        const containerWidth = event.currentTarget.clientWidth || window.innerWidth || 0;
        mobileGestureRef.current = {
            startX: touch.clientX,
            startY: touch.clientY,
            startTime: Date.now(),
            lastX: touch.clientX,
            lastY: touch.clientY,
            lastTime: Date.now(),
            containerWidth,
            containerLeft: containerRect.left || 0,
            target: event.target,
            blocked: isTextInputLikeTarget(event.target),
        };
    }, [isMobileViewport]);

    const handleMobileTouchMove = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
        if (!isMobileViewport) return;
        const gesture = mobileGestureRef.current;
        if (!gesture) return;

        const touch = event.changedTouches[0];
        if (!touch) return;

        gesture.lastX = touch.clientX;
        gesture.lastY = touch.clientY;
        gesture.lastTime = Date.now();

        if (gesture.blocked) return;

        const absDeltaX = Math.abs(gesture.lastX - gesture.startX);
        const absDeltaY = Math.abs(gesture.lastY - gesture.startY);
        if (absDeltaY > absDeltaX * MOBILE_HORIZONTAL_DOMINANCE_RATIO && absDeltaY > 18) {
            gesture.blocked = true;
        }
    }, [isMobileViewport]);

    const handleMobileTouchEnd = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
        if (!isMobileViewport) return;
        const gesture = mobileGestureRef.current;
        mobileGestureRef.current = null;
        if (!gesture || gesture.blocked) return;

        const touch = event.changedTouches[0];
        if (!touch) return;

        const endTime = Date.now();
        const deltaX = touch.clientX - gesture.startX;
        const deltaY = touch.clientY - gesture.startY;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);

        if (absDeltaX <= absDeltaY * MOBILE_HORIZONTAL_DOMINANCE_RATIO) return;

        const durationMs = Math.max(endTime - gesture.startTime, 1);
        const velocity = absDeltaX / durationMs;
        if (absDeltaX < MOBILE_MIN_SWIPE_DISTANCE_PX && velocity < MOBILE_MIN_SWIPE_VELOCITY) return;

        const swipeDirection: SwipeDirection = deltaX < 0 ? 'left' : 'right';
        const startXWithinContainer = gesture.startX - gesture.containerLeft;
        const withinEdgeZone = swipeDirection === 'left'
            ? startXWithinContainer >= gesture.containerWidth - MOBILE_EDGE_SWIPE_ZONE_PX
            : startXWithinContainer <= MOBILE_EDGE_SWIPE_ZONE_PX;
        if (!withinEdgeZone) return;

        const containerEl = mobilePaneContainerRef.current;
        const horizontalScroller = getHorizontalScrollableAncestor(gesture.target, containerEl);
        if (horizontalScroller && canHorizontalScrollerConsumeGesture(horizontalScroller, swipeDirection)) {
            return;
        }

        const hasWindowPane = viewMode === 'deals' ? !!activeDealId : !!activeId;
        if (!hasWindowPane) return;

        if (swipeDirection === 'left') {
            if (mobilePane === 'list') {
                setMobilePane('window');
            } else if (mobilePane === 'window') {
                setMobilePane('mission');
            }
            return;
        }

        if (mobilePane === 'mission') {
            setMobilePane('window');
            return;
        }

        if (mobilePane === 'window') {
            setMobilePane('list');
        }
    }, [isMobileViewport, viewMode, activeDealId, activeId, mobilePane]);

    // Handle toggling context mode IDs
    const handleToggleSelect = (id: string, checked: boolean) => {
        const next = new Set(selectedIds);
        if (checked) next.add(id);
        else next.delete(id);
        setSelectedIds(next);
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
                const idSet = new Set(ids);
                const archivedConversations = conversations.filter(c => idSet.has(c.id));

                // Remove from local state immediately if filtering active conversations
                if (viewFilter === 'active') {
                    setConversations(prev => prev.filter(c => !idSet.has(c.id)));
                }

                // Clear selection
                setSelectedIds(new Set());
                if (ids.length === conversations.length) {
                    setIsSelectionMode(false);
                }

                // If active ID was archived, deselect
                if (activeId && idSet.has(activeId)) {
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
                const idSet = new Set(ids);
                const deletedConversations = conversations.filter(c => idSet.has(c.id));

                // Remove from local state immediately
                setConversations(prev => prev.filter(c => !idSet.has(c.id)));

                // Clear selection
                setSelectedIds(new Set());
                if (ids.length === conversations.length) {
                    setIsSelectionMode(false);
                }

                // If active ID was deleted, deselect
                if (activeId && idSet.has(activeId)) {
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
                const idSet = new Set(ids);
                setConversations(prev => prev.filter(c => !idSet.has(c.id)));

                // Clear selection
                setSelectedIds(new Set());
                if (ids.length === conversations.length) {
                    setIsSelectionMode(false);
                }

                // If active ID was deleted, deselect
                if (activeId && idSet.has(activeId)) {
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


    const handleSendMessage = async (
        text: string,
        type: 'SMS' | 'Email' | 'WhatsApp',
        targetConversation?: Conversation
    ) => {
        const conversationTarget = targetConversation || activeConversation;
        if (!conversationTarget) return;

        const res = await sendReply(conversationTarget.id, conversationTarget.contactId, text, type);
        if (!res.success) {
            alert('Failed to send message: ' + JSON.stringify(res.error));
            return;
        }

        if (viewMode === 'deals') {
            setDealTimelineRefreshToken((previous) => previous + 1);
        }

        if (activeIdRef.current === conversationTarget.id) {
            const newMsgs = await fetchMessages(conversationTarget.id);
            setMessages(newMsgs);
        }
    };

    const applyConversationReplyLanguageOverride = useCallback((conversationId: string, replyLanguageOverride: string | null) => {
        setConversations((prev) => prev.map((conversationItem) =>
            conversationItem.id === conversationId
                ? { ...conversationItem, replyLanguageOverride }
                : conversationItem
        ));

        setActiveDealParticipants((prev) => prev.map((conversationItem) =>
            conversationItem.id === conversationId
                ? { ...conversationItem, replyLanguageOverride }
                : conversationItem
        ));
    }, []);

    const handleConversationContactSaved = useCallback(async (conversationId: string, patch: ContactIdentityPatch) => {
        const normalizedConversationId = String(conversationId || "").trim();
        const patchedContactId = String(patch?.id || "").trim();
        if (!normalizedConversationId || !patchedContactId) return;

        const normalizedName = patch.name === undefined
            ? undefined
            : (String(patch.name || "").trim() || "Unknown Contact");
        const normalizedEmail = patch.email === undefined
            ? undefined
            : (String(patch.email || "").trim() || undefined);
        const normalizedPhone = patch.phone === undefined
            ? undefined
            : (String(patch.phone || "").trim() || undefined);
        const normalizedPreferredLang = patch.preferredLang === undefined
            ? undefined
            : (String(patch.preferredLang || "").trim() || null);

        const applyConversationIdentityPatch = (conversationItem: Conversation): Conversation => {
            if (
                conversationItem.id !== normalizedConversationId
                && String(conversationItem.contactId || "") !== patchedContactId
            ) {
                return conversationItem;
            }

            return {
                ...conversationItem,
                ...(normalizedName !== undefined ? { contactName: normalizedName } : {}),
                ...(normalizedEmail !== undefined ? { contactEmail: normalizedEmail } : {}),
                ...(normalizedPhone !== undefined ? { contactPhone: normalizedPhone } : {}),
                ...(normalizedPreferredLang !== undefined ? { contactPreferredLanguage: normalizedPreferredLang } : {}),
            };
        };

        const applyDealContactIdentityPatch = (contact: DealContactOption): DealContactOption => {
            if (
                contact.conversationId !== normalizedConversationId
                && String(contact.contactId || "") !== patchedContactId
            ) {
                return contact;
            }

            return {
                ...contact,
                ...(normalizedName !== undefined ? { contactName: normalizedName } : {}),
                ...(normalizedEmail !== undefined ? { contactEmail: normalizedEmail } : {}),
                ...(normalizedPhone !== undefined ? { contactPhone: normalizedPhone } : {}),
            };
        };

        const sequence = (contactSaveRefreshSeqRef.current[normalizedConversationId] || 0) + 1;
        contactSaveRefreshSeqRef.current[normalizedConversationId] = sequence;

        setConversations((prev) => prev.map(applyConversationIdentityPatch));
        setSearchResults((prev) => prev.map(applyConversationIdentityPatch));
        setActiveDealParticipants((prev) => prev.map(applyConversationIdentityPatch));
        setDealContacts((prev) => prev.map(applyDealContactIdentityPatch));
        setWorkspaceContactContext((prev: any) => {
            if (!prev?.contact || String(prev.contact.id || "") !== patchedContactId) return prev;
            return {
                ...prev,
                contact: {
                    ...prev.contact,
                    ...(normalizedName !== undefined ? { name: normalizedName } : {}),
                    ...(normalizedEmail !== undefined ? { email: normalizedEmail || null } : {}),
                    ...(normalizedPhone !== undefined ? { phone: normalizedPhone || null } : {}),
                    ...(normalizedPreferredLang !== undefined ? { preferredLang: normalizedPreferredLang } : {}),
                },
            };
        });

        try {
            const fresh = await refreshConversation(normalizedConversationId);
            if (!fresh) return;
            if (contactSaveRefreshSeqRef.current[normalizedConversationId] !== sequence) return;

            const applyRefreshedConversation = (conversationItem: Conversation): Conversation => {
                if (
                    conversationItem.id !== normalizedConversationId
                    && String(conversationItem.contactId || "") !== patchedContactId
                ) {
                    return conversationItem;
                }

                return {
                    ...conversationItem,
                    ...fresh,
                    ...(normalizedName !== undefined ? { contactName: normalizedName } : {}),
                    ...(normalizedEmail !== undefined ? { contactEmail: normalizedEmail } : {}),
                    ...(normalizedPhone !== undefined ? { contactPhone: normalizedPhone } : {}),
                    ...(normalizedPreferredLang !== undefined ? { contactPreferredLanguage: normalizedPreferredLang } : {}),
                };
            };

            setConversations((prev) => prev.map(applyRefreshedConversation));
            setSearchResults((prev) => prev.map(applyRefreshedConversation));
            setActiveDealParticipants((prev) => prev.map(applyRefreshedConversation));
            setDealContacts((prev) => prev.map((contact) => {
                if (
                    contact.conversationId !== normalizedConversationId
                    && String(contact.contactId || "") !== patchedContactId
                ) {
                    return contact;
                }

                return {
                    ...contact,
                    ...(fresh.contactName !== undefined ? { contactName: fresh.contactName || "Unknown Contact" } : {}),
                    ...(fresh.contactEmail !== undefined ? { contactEmail: fresh.contactEmail || undefined } : {}),
                    ...(fresh.contactPhone !== undefined ? { contactPhone: fresh.contactPhone || undefined } : {}),
                    ...(normalizedName !== undefined ? { contactName: normalizedName } : {}),
                    ...(normalizedEmail !== undefined ? { contactEmail: normalizedEmail } : {}),
                    ...(normalizedPhone !== undefined ? { contactPhone: normalizedPhone } : {}),
                };
            }));

            setWorkspaceContactContext((prev: any) => {
                if (!prev?.contact || String(prev.contact.id || "") !== patchedContactId) return prev;
                return {
                    ...prev,
                    contact: {
                        ...prev.contact,
                        ...(fresh.contactName !== undefined ? { name: fresh.contactName || null } : {}),
                        ...(fresh.contactEmail !== undefined ? { email: fresh.contactEmail || null } : {}),
                        ...(fresh.contactPhone !== undefined ? { phone: fresh.contactPhone || null } : {}),
                        ...(fresh.contactPreferredLanguage !== undefined ? { preferredLang: fresh.contactPreferredLanguage } : {}),
                        ...(normalizedName !== undefined ? { name: normalizedName } : {}),
                        ...(normalizedEmail !== undefined ? { email: normalizedEmail || null } : {}),
                        ...(normalizedPhone !== undefined ? { phone: normalizedPhone || null } : {}),
                        ...(normalizedPreferredLang !== undefined ? { preferredLang: normalizedPreferredLang } : {}),
                    },
                };
            });
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

        try {
            const prep = await createWhatsAppMediaUploadUrl(conversationTarget.id, conversationTarget.contactId, {
                fileName: file.name,
                contentType: file.type || 'application/octet-stream',
                size: file.size,
            });

            if (!prep.success) {
                alert('Failed to prepare media upload: ' + JSON.stringify(prep.error));
                return;
            }

            if (!prep.uploadUrl || !prep.upload) {
                throw new Error("Upload preparation response missing upload URL or upload reference.");
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
                throw new Error(`R2 upload failed (${uploadRes.status}) ${errText}`);
            }

            const sendRes = await sendWhatsAppMediaReply(
                conversationTarget.id,
                conversationTarget.contactId,
                uploadRef,
                { caption }
            );

            if (sendRes.success) {
                if (viewMode === 'deals') {
                    setDealTimelineRefreshToken((previous) => previous + 1);
                }
                if (activeIdRef.current === conversationTarget.id) {
                    const newMsgs = await fetchMessages(conversationTarget.id);
                    setMessages(newMsgs);
                }
            } else {
                alert('Failed to send media: ' + JSON.stringify(sendRes.error));
            }
        } catch (e: any) {
            alert('Failed to send media: ' + (e?.message || 'Unknown error'));
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

            const refreshed = await fetchMessages(selectedConversationId);
            if (activeIdRef.current === selectedConversationId) {
                setMessages(refreshed);
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
        try {
            const result = await retryWhatsAppAudioTranscript(activeConversation.id, messageId, attachmentId);
            if (!result?.success) {
                toast({
                    title: "Retry Failed",
                    description: String(result?.error || "Could not retry transcript."),
                    variant: "destructive",
                });
                return;
            }

            const modeLabel = result.mode === "inline-fallback" ? "inline fallback" : result.mode;
            toast({
                title: result.skipped ? "Transcript Already Complete" : "Transcript Retry Started",
                description: result.message || `Retry accepted via ${modeLabel}.`,
            });

            const refreshed = await fetchMessages(activeConversation.id);
            if (activeIdRef.current === activeConversation.id) {
                setMessages(refreshed);
                messageSignatureRef.current = getMessageSignature(refreshed);
            }
        } catch (error: any) {
            toast({
                title: "Retry Failed",
                description: String(error?.message || "Unexpected error while retrying transcript."),
                variant: "destructive",
            });
        }
    };

    const handleRequestTranscript = async (
        messageId: string,
        attachmentId: string,
        options?: { force?: boolean }
    ) => {
        if (!activeConversation) return;
        try {
            const result = await requestWhatsAppAudioTranscript(
                activeConversation.id,
                messageId,
                attachmentId,
                { force: !!options?.force, priority: "high" }
            );

            if (!result?.success) {
                toast({
                    title: options?.force ? "Regeneration Failed" : "Transcription Failed",
                    description: String(result?.error || "Could not start transcript job."),
                    variant: "destructive",
                });
                return;
            }

            const modeLabel = result.mode === "inline-fallback" ? "inline fallback" : result.mode;
            toast({
                title: result.skipped
                    ? "Transcript Already Queued"
                    : (options?.force ? "Transcript Regeneration Started" : "Transcript Started"),
                description: result.message || `Accepted via ${modeLabel}.`,
            });

            const refreshed = await fetchMessages(activeConversation.id);
            if (activeIdRef.current === activeConversation.id) {
                setMessages(refreshed);
                messageSignatureRef.current = getMessageSignature(refreshed);
            }
        } catch (error: any) {
            toast({
                title: options?.force ? "Regeneration Failed" : "Transcription Failed",
                description: String(error?.message || "Unexpected error while starting transcript."),
                variant: "destructive",
            });
        }
    };

    const handleBulkTranscribeUnprocessedAudio = async (options?: { window?: "30d" | "all" }) => {
        if (!activeConversation) return;
        try {
            const result = await bulkRequestWhatsAppAudioTranscripts(activeConversation.id, {
                window: options?.window || "30d",
                priority: "normal",
            });

            if (!result?.success) {
                toast({
                    title: "Bulk Transcription Failed",
                    description: String(result?.error || "Could not queue bulk transcript jobs."),
                    variant: "destructive",
                });
                return;
            }

            const summary = `Queued ${result.queuedCount}, skipped ${result.skippedCount}, failed ${result.failedCount}.`;
            toast({
                title: "Bulk Transcription Requested",
                description: `${result.message} ${summary}`.trim(),
                variant: result.failedCount > 0 ? "destructive" : "default",
            });

            const refreshed = await fetchMessages(activeConversation.id);
            if (activeIdRef.current === activeConversation.id) {
                setMessages(refreshed);
                messageSignatureRef.current = getMessageSignature(refreshed);
            }
        } catch (error: any) {
            toast({
                title: "Bulk Transcription Failed",
                description: String(error?.message || "Unexpected error while queuing bulk transcripts."),
                variant: "destructive",
            });
        }
    };

    const handleExtractViewingNotes = async (
        messageId: string,
        attachmentId: string,
        options?: { force?: boolean }
    ) => {
        if (!activeConversation) return;
        try {
            const result = await extractWhatsAppViewingNotes(
                activeConversation.id,
                messageId,
                attachmentId,
                { force: !!options?.force, priority: "high" }
            );

            if (!result?.success) {
                toast({
                    title: options?.force ? "Notes Regeneration Failed" : "Extraction Failed",
                    description: String(result?.error || "Could not start viewing notes extraction."),
                    variant: "destructive",
                });
                return;
            }

            const modeLabel = result.mode === "inline-fallback" ? "inline fallback" : result.mode;
            toast({
                title: result.skipped
                    ? "Viewing Notes Already Available"
                    : (options?.force ? "Notes Regeneration Started" : "Viewing Notes Extraction Started"),
                description: result.message || `Accepted via ${modeLabel}.`,
            });

            const refreshed = await fetchMessages(activeConversation.id);
            if (activeIdRef.current === activeConversation.id) {
                setMessages(refreshed);
                messageSignatureRef.current = getMessageSignature(refreshed);
            }
        } catch (error: any) {
            toast({
                title: options?.force ? "Notes Regeneration Failed" : "Extraction Failed",
                description: String(error?.message || "Unexpected error while extracting viewing notes."),
                variant: "destructive",
            });
        }
    };


    const handleSync = async () => {
        if (!activeId) return;
        setLoadingMessages(true);
        let totalSynced = 0;
        let offset = 0;
        const CHUNK_SIZE = 50;
        const MAX_LIMIT = 500; // Safety cap
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
                        const msgs = await fetchMessages(activeId);
                        setMessages(msgs);
                    }

                    // Stop if we fetched fewer than requested (end of history)
                    // Evolution API usually returns what it finds. If it finds 0, we stop.
                    if (count < CHUNK_SIZE) {
                        keepFetching = false;
                    }
                } else {
                    toast({ title: "Sync Failed", description: String(res.error), variant: "destructive" });
                    keepFetching = false;
                }
            }

            toast({ title: "Sync Complete", description: `Total messages recovered: ${totalSynced}` });
            const msgs = await fetchMessages(activeId);
            setMessages(msgs);

        } catch (e) {
            console.error("Sync error:", e);
            toast({ title: "Sync Error", description: "An unexpected error occurred.", variant: "destructive" });
        } finally {
            setLoadingMessages(false);
        }
    };

    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [suggestedResponseQueue, setSuggestedResponseQueue] = useState<SuggestedResponseQueueItem[]>([]);
    const [loadingSuggestedResponseQueue, setLoadingSuggestedResponseQueue] = useState(false);
    const [composerInsertSeed, setComposerInsertSeed] = useState<{ key: string; body: string } | null>(null);
    const suggestedResponseQueueRequestIdRef = useRef(0);

    // Reset suggestions when active conversation changes
    useEffect(() => {
        setSuggestions([]);
    }, [activeId]);

    useEffect(() => {
        setComposerInsertSeed(null);
    }, [viewMode, activeId, activeDealId]);

    const refreshSuggestedResponseQueue = useCallback(async () => {
        const conversationScopeId = viewMode === 'chats' ? String(activeId || "").trim() : "";
        const dealScopeId = viewMode === 'deals' ? String(activeDealId || "").trim() : "";

        if (!conversationScopeId && !dealScopeId) {
            setSuggestedResponseQueue([]);
            setLoadingSuggestedResponseQueue(false);
            return;
        }

        const requestId = suggestedResponseQueueRequestIdRef.current + 1;
        suggestedResponseQueueRequestIdRef.current = requestId;
        setLoadingSuggestedResponseQueue(true);

        try {
            const rows = await listSuggestedResponses({
                conversationId: conversationScopeId || undefined,
                dealId: dealScopeId || undefined,
                status: "pending",
                limit: 40,
            });
            if (suggestedResponseQueueRequestIdRef.current !== requestId) return;
            setSuggestedResponseQueue(Array.isArray(rows) ? (rows as SuggestedResponseQueueItem[]) : []);
        } catch (error: any) {
            if (suggestedResponseQueueRequestIdRef.current !== requestId) return;
            console.error("Failed to load suggested responses:", error);
            toast({
                title: "Queue Error",
                description: error?.message || "Failed to load suggested responses.",
                variant: "destructive",
            });
            setSuggestedResponseQueue([]);
        } finally {
            if (suggestedResponseQueueRequestIdRef.current === requestId) {
                setLoadingSuggestedResponseQueue(false);
            }
        }
    }, [viewMode, activeId, activeDealId]);

    useEffect(() => {
        void refreshSuggestedResponseQueue();
    }, [refreshSuggestedResponseQueue]);

    const handleMissionSuggestionsGenerated = useCallback((nextSuggestions: string[]) => {
        setSuggestions(Array.isArray(nextSuggestions) ? nextSuggestions : []);
        void refreshSuggestedResponseQueue();
    }, [refreshSuggestedResponseQueue]);

    const handleAcceptSuggestedResponse = useCallback(async (
        suggestedResponseId: string,
        mode: "insertOnly" | "sendNow"
    ) => {
        const result = await acceptSuggestedResponse(suggestedResponseId, { mode });
        if (!result?.success) {
            toast({
                title: "Action Failed",
                description: String(result?.error || "Could not accept suggested response."),
                variant: "destructive",
            });
            return;
        }

        if (mode === "insertOnly") {
            setComposerInsertSeed({
                key: `${result.id}:${Date.now()}`,
                body: String(result.body || ""),
            });
            toast({
                title: "Added to Composer",
                description: "Suggested response inserted for review.",
            });
        } else {
            toast({
                title: "Message Sent",
                description: "Suggested response was accepted and sent.",
            });
        }

        await refreshSuggestedResponseQueue();
    }, [refreshSuggestedResponseQueue]);

    const handleRejectSuggestedResponse = useCallback(async (suggestedResponseId: string, reason?: string | null) => {
        const result = await rejectSuggestedResponse(suggestedResponseId, reason);
        if (!result?.success) {
            toast({
                title: "Action Failed",
                description: String(result?.error || "Could not reject suggested response."),
                variant: "destructive",
            });
            return;
        }

        toast({ title: "Suggestion Rejected" });
        await refreshSuggestedResponseQueue();
    }, [refreshSuggestedResponseQueue]);

    const streamDraftViaApi = useCallback(async (args: {
        conversationId: string;
        contactId: string;
        instruction?: string;
        model?: string;
        mode: "chat" | "deal";
        dealId?: string;
        replyLanguage?: string | null;
        onChunk?: (chunk: string) => void;
    }) => {
        const response = await fetch("/api/conversations/draft-stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                conversationId: args.conversationId,
                contactId: args.contactId,
                instruction: args.instruction,
                model: args.model,
                options: {
                    mode: args.mode,
                    dealId: args.dealId,
                    replyLanguage: args.replyLanguage ?? null,
                },
            }),
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            const fallbackMessage = `Draft stream request failed (${response.status})`;
            throw new Error(payload?.error || payload?.message || fallbackMessage);
        }

        if (!response.body) {
            throw new Error("Draft stream response body was empty.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalResult: any = null;

        const parseLine = (line: string) => {
            if (!line.trim()) return;
            let payload: any = null;
            try {
                payload = JSON.parse(line);
            } catch {
                return;
            }

            if (payload?.type === "chunk" && typeof payload.text === "string") {
                args.onChunk?.(payload.text);
                return;
            }

            if (payload?.type === "error") {
                throw new Error(String(payload?.message || "Draft stream failed."));
            }

            if (payload?.type === "complete") {
                finalResult = payload.result || null;
            }
        };

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let newlineIndex = buffer.indexOf("\n");
            while (newlineIndex >= 0) {
                const line = buffer.slice(0, newlineIndex);
                buffer = buffer.slice(newlineIndex + 1);
                parseLine(line);
                newlineIndex = buffer.indexOf("\n");
            }
        }

        buffer += decoder.decode();
        if (buffer.trim()) {
            parseLine(buffer.trim());
        }

        return finalResult;
    }, []);

    const conversationListPane = (
        <ConversationList
            conversations={debouncedSearchQuery.trim() ? searchResults : conversations}
            selectedId={viewMode === 'chats' ? activeId : activeDealId}
            onSelect={handleSelect}
            onHoverConversation={viewMode === 'chats' ? prefetchWorkspaceCore : undefined}
            hasMore={viewMode === 'chats' ? conversationListHasMore : false}
            isLoadingMore={viewMode === 'chats' ? loadingMoreConversations : false}
            onLoadMore={viewMode === 'chats' ? loadMoreConversations : undefined}

            // Selection / Generic Mode Props
            isSelectionMode={isSelectionMode}
            onToggleSelectionMode={setIsSelectionMode}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onDelete={handleDelete}
            onSelectAll={(select) => {
                if (select) {
                    setSelectedIds(new Set(conversations.map(c => c.id)));
                } else {
                    setSelectedIds(new Set());
                }
            }}

            // Deal Mode Props
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            viewFilter={viewFilter}
            onViewFilterChange={setViewFilter}
            deals={deals}
            onSelectDeal={handleSelectDeal}
            onImportClick={() => setImportModalOpen(true)}
            onBind={handleBindClick}
            onArchive={viewFilter === 'active' ? handleArchive : undefined}
            onNewConversationClick={() => setNewConversationOpen(true)}
            onSyncAllClick={() => setSyncAllOpen(true)}
            disablePreviewCard={isMobileViewport}
        />
    );

    const conversationMainPane = viewMode === 'chats' ? (
        activeConversation ? (
            <ChatWindow
                key={activeConversation.id} // Force remount to reset internal state/scroll
                conversation={activeConversation}
                messages={messages}
                activityLog={activityLog}
                loading={loadingMessages}
                onBack={isMobileViewport ? handleBackToList : undefined}
                onOpenMissionControl={isMobileViewport ? handleOpenMissionControl : undefined}
                onSendMessage={handleSendMessage}
                onSendMedia={handleSendMedia}
                onRefetchMedia={handleRefetchMedia}
                onRequestTranscript={handleRequestTranscript}
                onExtractViewingNotes={handleExtractViewingNotes}
                onRetryTranscript={handleRetryTranscript}
                onBulkTranscribeUnprocessedAudio={handleBulkTranscribeUnprocessedAudio}
                transcriptOnDemandEnabled={transcriptOnDemandEnabled}
                onSync={handleSync}
                onAddActivityEntry={async (entryText: string, dateIso: string) => {
                    await addConversationActivityEntry(activeConversation.id, entryText, dateIso);
                    // Refresh the activity log after adding
                    const log = await fetchConversationActivityLog(activeConversation.id);
                    setActivityLog(log);
                }}
                onFetchHistory={async () => {
                    setLoadingMessages(true);
                    try {
                        toast({ title: "Fetching History", description: "Checking Gmail for recent messages..." });
                        // Dynamic import or passed prop action
                        const { fetchContactHistory } = await import('@/lib/google/actions');
                        const res = await fetchContactHistory(activeConversation.contactId);

                        if (res.success) {
                            toast({ title: "History Fetched", description: `Found ${res.count} messages.` });
                            const msgs = await fetchMessages(activeConversation.id);
                            setMessages(msgs);
                        } else {
                            toast({ title: "Fetch Failed", description: res.error, variant: "destructive" });
                        }
                    } catch (e: any) {
                        toast({ title: "Error", description: e.message, variant: "destructive" });
                    } finally {
                        setLoadingMessages(false);
                    }
                }}
                suggestions={[...(activeConversation?.suggestedActions || []), ...suggestions]}
                suggestedResponseQueue={suggestedResponseQueue}
                suggestedResponseQueueLoading={loadingSuggestedResponseQueue}
                onAcceptSuggestedResponse={handleAcceptSuggestedResponse}
                onRejectSuggestedResponse={handleRejectSuggestedResponse}
                composerInsertSeed={composerInsertSeed}
                onGenerateDraft={async (
                    instruction?: string,
                    model?: string,
                    replyLanguage?: string | null,
                    onChunk?: (chunk: string) => void
                ) => {
                    try {
                        let res: any = null;
                        if (onChunk) {
                            try {
                                res = await streamDraftViaApi({
                                    conversationId: activeConversation.id,
                                    contactId: activeConversation.contactId,
                                    instruction,
                                    model,
                                    mode: "chat",
                                    replyLanguage,
                                    onChunk,
                                });
                            } catch (streamError) {
                                console.warn("[AI Draft] Stream path failed, falling back to server action.", streamError);
                            }
                        }

                        if (!res) {
                            res = await generateAIDraft(
                                activeConversation.id,
                                activeConversation.contactId,
                                instruction,
                                model,
                                { mode: "chat", replyLanguage }
                            );
                        }

                        if (res.reasoning) {
                            toast({ title: "Draft Generated", description: res.reasoning });
                        }
                        return res.draft;
                    } catch (e: any) {
                        toast({ title: "Draft Failed", description: e.message, variant: "destructive" });
                        return null;
                    }
                }}
                onSetReplyLanguageOverride={async (replyLanguage: string | null) => {
                    const result = await setConversationReplyLanguageOverride(activeConversation.id, replyLanguage);
                    if (result.success) {
                        applyConversationReplyLanguageOverride(activeConversation.id, result.replyLanguageOverride ?? null);
                    }
                    return result;
                }}
            />
        ) : (
            <div className="h-full flex items-center justify-center text-gray-400 bg-slate-50">
                Select a conversation
            </div>
        )
    ) : (
        activeDealId ? (
            <UnifiedTimeline
                dealId={activeDealId}
                refreshToken={dealTimelineRefreshToken}
                composerConversation={selectedDealConversation}
                onBack={isMobileViewport ? handleBackToList : undefined}
                onOpenMissionControl={isMobileViewport ? handleOpenMissionControl : undefined}
                onSendMessage={(text, type) => handleSendMessage(text, type, selectedDealConversation || undefined)}
                onSendMedia={(file, caption) => handleSendMedia(file, caption, selectedDealConversation || undefined)}
                onGenerateDraft={async (
                    instruction?: string,
                    model?: string,
                    replyLanguage?: string | null,
                    onChunk?: (chunk: string) => void
                ) => {
                    if (!selectedDealConversation) return null;
                    try {
                        let res: any = null;
                        if (onChunk) {
                            try {
                                res = await streamDraftViaApi({
                                    conversationId: selectedDealConversation.id,
                                    contactId: selectedDealConversation.contactId,
                                    instruction,
                                    model,
                                    mode: "deal",
                                    dealId: activeDealId || undefined,
                                    replyLanguage,
                                    onChunk,
                                });
                            } catch (streamError) {
                                console.warn("[AI Draft] Deal stream path failed, falling back to server action.", streamError);
                            }
                        }

                        if (!res) {
                            res = await generateAIDraft(
                                selectedDealConversation.id,
                                selectedDealConversation.contactId,
                                instruction,
                                model,
                                { mode: "deal", dealId: activeDealId, replyLanguage }
                            );
                        }

                        if (res.reasoning) {
                            toast({ title: "Draft Generated", description: res.reasoning });
                        }
                        return res.draft;
                    } catch (error: any) {
                        toast({ title: "Draft Failed", description: error?.message || "Failed to generate draft", variant: "destructive" });
                        return null;
                    }
                }}
                onSetReplyLanguageOverride={async (replyLanguage: string | null) => {
                    if (!selectedDealConversation) {
                        return { success: false as const, error: "No conversation selected." };
                    }
                    const result = await setConversationReplyLanguageOverride(selectedDealConversation.id, replyLanguage);
                    if (result.success) {
                        applyConversationReplyLanguageOverride(selectedDealConversation.id, result.replyLanguageOverride ?? null);
                    }
                    return result;
                }}
                suggestions={suggestions}
                suggestedResponseQueue={suggestedResponseQueue}
                suggestedResponseQueueLoading={loadingSuggestedResponseQueue}
                onAcceptSuggestedResponse={handleAcceptSuggestedResponse}
                onRejectSuggestedResponse={handleRejectSuggestedResponse}
                composerInsertSeed={composerInsertSeed}
                composerDisabled={loadingDealContext || !selectedDealConversation}
                composerDisabledReason={
                    loadingDealContext
                        ? "Loading deal participants..."
                        : "Select a contact in Mission Control to reply."
                }
                replyingToLabel={selectedDealConversation?.contactName || undefined}
            />
        ) : (
            <div className="h-full flex items-center justify-center text-gray-400 bg-slate-50">
                Select a deal to view timeline
            </div>
        )
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
                onDraftApproved={(text) => handleSendMessage(text, getMessageType(activeConversation))}
                onDeselect={(id) => handleToggleSelect(id, false)}
                onSuggestionsGenerated={handleMissionSuggestionsGenerated}
                onContactSaved={(patch) => handleConversationContactSaved(activeConversation.id, patch)}
            />
        ) : <div className="h-full bg-slate-50" />
    ) : (
        selectedDealConversation ? (
            <CoordinatorPanel
                locationId={locationId}
                conversation={selectedDealConversation}
                selectedConversations={activeDealParticipants}
                initialContactContext={workspaceContactContext}
                initialTaskSummary={workspaceTaskSummary}
                initialViewingSummary={workspaceViewingSummary}
                initialAgentSummary={workspaceAgentSummary}
                lazySidebarDataEnabled={featureFlags.lazySidebarData}
                onBackToConversation={isMobileViewport ? handleBackToConversation : undefined}
                onDraftApproved={(text) => handleSendMessage(text, getMessageType(selectedDealConversation), selectedDealConversation)}
                onDeselect={() => undefined} // No deselect in deal mode
                onSuggestionsGenerated={handleMissionSuggestionsGenerated}
                onContactSaved={(patch) => handleConversationContactSaved(selectedDealConversation.id, patch)}
                dealContacts={dealContacts}
                selectedDealConversationId={selectedDealConversation.id}
                onSelectDealConversation={(conversationId) => setActiveId(conversationId)}
            />
        ) : (
            <div className="h-full bg-slate-50 p-4 text-center text-gray-400 text-xs flex flex-col items-center justify-center">
                {loadingDealContext ? 'Loading deal context...' : 'Select a deal contact to view context.'}
            </div>
        )
    );

    const isMobileThreadOpen = viewMode === 'chats'
        ? !!activeConversation
        : !!activeDealId;
    const mobilePaneHint = (() => {
        if (viewMode === 'deals') {
            if (!activeDealId) return null;
            if (mobilePane === 'list') return 'Edge-swipe left to open timeline';
            if (mobilePane === 'window') return 'Edge-swipe left for Mission Control';
            return 'Edge-swipe right to return to timeline';
        }
        if (!activeConversation) return null;
        if (mobilePane === 'list') return 'Edge-swipe left to open conversation';
        if (mobilePane === 'window') return 'Edge-swipe left for Mission Control';
        return 'Edge-swipe right to return to conversation';
    })();

    const currentMobilePane: MobilePane = isMobileThreadOpen
        ? mobilePane
        : 'list';
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
                        const msgs = await fetchMessages(activeConversation.id);
                        setMessages(msgs);
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
