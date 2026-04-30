'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback, useRef, type TouchEvent as ReactTouchEvent, type ReactNode } from 'react';
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
    fetchConversationActivityLog,
    addConversationActivityEntry,
    listSuggestedResponses,
    acceptSuggestedResponse,
    rejectSuggestedResponse,
} from '../actions';
import { toast } from '@/components/ui/use-toast';
import {
    createPersistentDeal,
    fetchDealTimeline,
    getDealContexts,
    getDealWorkspaceCore,
    getDealWorkspaceSidebar,
} from '../../deals/actions';
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
import {
    isPendingOutboundMessage,
    matchesByCorrelation,
    mergeSnapshotWithPendingMessages,
} from '@/lib/conversations/outbound-reconciliation';
import { buildTimelineCursorFromEvent } from '@/lib/conversations/timeline-events';
import { UnifiedTimeline } from './unified-timeline';
import { ConversationList } from './conversation-list';
import { ChatWindow } from './chat-window';
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

type WorkspaceSidebarSnapshot = {
    contactContext: any;
    taskSummary: any;
    viewingSummary: any;
    agentSummary: any;
};

type ActivityTimelineItem = {
    id: string;
    type: 'activity';
    createdAt: string | Date;
    action: string;
    changes?: any;
    user?: { name: string | null; email: string | null } | null;
};

type DealWorkspaceHydrationState = {
    status: WorkspaceHydrationStatus;
    oldestCursor: string | null;
    newestCursor: string | null;
    initialCount: number;
    targetCount: number;
    requestedLimit: number;
};

type DealWorkspaceCoreSnapshot = {
    dealId: string;
    title: string;
    stage: string;
    metadata: any;
    participants: Conversation[];
    timelineEvents: any[];
    hydration: DealWorkspaceHydrationState;
};

const WORKSPACE_CACHE_LIMIT = 30;
const WORKSPACE_CORE_CACHE_TTL_MS = 2 * 60 * 1000;
const WORKSPACE_SIDEBAR_CACHE_TTL_MS = 5 * 60 * 1000;
const WORKSPACE_ACTIVITY_LIMIT = 180;
const ACTIVE_POLL_GRACE_MS = 2500;
const COMPOSER_DRAFTS_SESSION_KEY = "estio:conversation-composer-drafts:v1";

type WorkspaceMessageWindowLike = {
    oldestCursor?: string | null;
    newestCursor?: string | null;
    count?: number;
    requestedLimit?: number;
} | null | undefined;

type DealTimelineWindowLike = {
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

function createDealWorkspaceHydrationState(args: {
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

function createDealWorkspaceCoreSnapshot(args: {
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

function buildContactContextShell(conversation: Conversation | null | undefined, appLocationId: string): any | null {
    if (!conversation?.contactId) return null;
    return {
        contact: {
            id: conversation.contactId,
            name: conversation.contactName || "Unknown Contact",
            email: conversation.contactEmail || null,
            phone: conversation.contactPhone || null,
            preferredLang: conversation.contactPreferredLanguage || null,
            locationId: appLocationId,
            contactType: "Lead",
            propertyRoles: [],
            companyRoles: [],
            viewings: [],
            interestedProperties: [],
            inspectedProperties: [],
            propertiesInterested: [],
            propertiesInspected: [],
            propertiesEmailed: [],
            propertiesMatched: [],
        },
        leadSources: [],
        shell: true,
    };
}

export function ConversationInterface({ locationId, initialConversations, initialConversationListPageInfo, initialDeals, featureFlags }: ConversationInterfaceProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const searchParamsString = searchParams?.toString() || "";
    const getSearchParam = (key: string) => searchParams?.get(key) || null;
    const [isMobileViewport, setIsMobileViewport] = useState(false);
    const [mobilePane, setMobilePane] = useState<MobilePane>('list');
    const hasInitializedMobilePaneRef = useRef(false);
    const mobileGestureRef = useRef<MobileGestureState | null>(null);
    const mobilePaneContainerRef = useRef<HTMLDivElement | null>(null);
    const mobilePaneHostRef = useRef<HTMLDivElement | null>(null);

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
    const initialWorkspaceLoadedAtRef = useRef<Record<string, number>>({});
    const [realtimeMode, setRealtimeMode] = useState<'disabled' | 'connecting' | 'connected' | 'fallback'>(
        featureFlags.realtimeSse ? 'connecting' : 'disabled'
    );
    const realtimeEventIdsRef = useRef<Set<string>>(new Set());
    const realtimeEventLastTsByConversationRef = useRef<Record<string, number>>({});
    const realtimeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const readResetInFlightRef = useRef<Set<string>>(new Set());
    const pendingOutboundByConversationRef = useRef<Map<string, Map<string, Message>>>(new Map());
    const selectedConversationCacheRef = useRef<Map<string, Conversation>>(
        new Map(initialConversations.filter((conversation) => !!conversation?.id).map((conversation) => [conversation.id, conversation]))
    );
    const hasSkippedInitialDraftPersistRef = useRef(false);
    const [composerDrafts, setComposerDrafts] = useState<Record<string, string>>({});

    // Initialize Active ID from URL
    const initialActiveId = getSearchParam('id');
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
        if (!searchQuery.trim()) {
            setSearchResults([]);
            setIsSearching(false);
            return;
        }

        let isCancelled = false;
        setIsSearching(true);

        searchConversations(searchQuery, { limit: 50 })
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

    const [loadedDealId, setLoadedDealId] = useState<string | null>(null);
    const [loadedChatId, setLoadedChatId] = useState<string | null>(null);

    const isDealLoading = loadingDealContext || (!!activeDealId && activeDealId !== loadedDealId);
    const isChatLoading = loadingMessages || (!!activeId && activeId !== loadedChatId);

    useEffect(() => {
        activeDealIdRef.current = activeDealId;
    }, [activeDealId]);

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
        if (typeof window === 'undefined') return;
        try {
            const rawDrafts = window.sessionStorage.getItem(COMPOSER_DRAFTS_SESSION_KEY);
            if (!rawDrafts) return;
            const parsed = JSON.parse(rawDrafts);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
            const restored: Record<string, string> = {};
            for (const [conversationId, draft] of Object.entries(parsed)) {
                const normalizedId = String(conversationId || "").trim();
                const normalizedDraft = String(draft || "");
                if (normalizedId && normalizedDraft) {
                    restored[normalizedId] = normalizedDraft;
                }
            }
            if (Object.keys(restored).length > 0) {
                setComposerDrafts(restored);
            }
        } catch (error) {
            console.warn("Failed to restore conversation drafts:", error);
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!hasSkippedInitialDraftPersistRef.current) {
            hasSkippedInitialDraftPersistRef.current = true;
            return;
        }
        try {
            const entries = Object.entries(composerDrafts).filter(([, draft]) => String(draft || "").length > 0);
            if (entries.length === 0) {
                window.sessionStorage.removeItem(COMPOSER_DRAFTS_SESSION_KEY);
                return;
            }
            window.sessionStorage.setItem(COMPOSER_DRAFTS_SESSION_KEY, JSON.stringify(Object.fromEntries(entries)));
        } catch (error) {
            console.warn("Failed to persist conversation drafts:", error);
        }
    }, [composerDrafts]);

    const getComposerDraft = useCallback((conversationId?: string | null) => {
        const normalizedId = String(conversationId || "").trim();
        if (!normalizedId) return "";
        return composerDrafts[normalizedId] || "";
    }, [composerDrafts]);

    const setComposerDraftForConversation = useCallback((conversationId: string | null | undefined, draft: string) => {
        const normalizedId = String(conversationId || "").trim();
        if (!normalizedId) return;
        const nextDraft = String(draft || "");
        setComposerDrafts((prev) => {
            if (nextDraft) {
                if (prev[normalizedId] === nextDraft) return prev;
                return { ...prev, [normalizedId]: nextDraft };
            }
            if (!(normalizedId in prev)) return prev;
            const next = { ...prev };
            delete next[normalizedId];
            return next;
        });
    }, []);

    const clearComposerDraftForConversation = useCallback((conversationId?: string | null) => {
        setComposerDraftForConversation(conversationId, "");
    }, [setComposerDraftForConversation]);

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

    const getPendingMessageKey = useCallback((message: Partial<Message> | null | undefined): string | null => {
        if (!message) return null;
        const clientMessageId = String((message as any).clientMessageId || "").trim();
        if (clientMessageId) return `client:${clientMessageId}`;
        const id = String(message.id || "").trim();
        if (id) return `id:${id}`;
        const wamId = String((message as any).wamId || "").trim();
        if (wamId) return `wam:${wamId}`;
        return null;
    }, []);

    const syncPendingMessagesForConversation = useCallback((conversationId: string, list: Message[]) => {
        const normalizedConversationId = String(conversationId || "").trim();
        if (!normalizedConversationId) return;

        const nextMap = new Map<string, Message>();
        for (const message of Array.isArray(list) ? list : []) {
            if (!isPendingOutboundMessage(message as any)) continue;
            
            // Prevent optimistic leaking during rapid activeId changes before messages settle
            if ((message as any).conversationId && (message as any).conversationId !== normalizedConversationId) {
                continue;
            }

            const key = getPendingMessageKey(message);
            if (!key) continue;
            nextMap.set(key, message);
        }

        if (nextMap.size > 0) {
            pendingOutboundByConversationRef.current.set(normalizedConversationId, nextMap);
        } else {
            pendingOutboundByConversationRef.current.delete(normalizedConversationId);
        }
    }, [getPendingMessageKey]);

    const mergeSnapshotPreservingPending = useCallback((conversationId: string, snapshotMessages: Message[]) => {
        const pendingMap = pendingOutboundByConversationRef.current.get(String(conversationId || "").trim());
        const pendingMessages = pendingMap ? Array.from(pendingMap.values()) : [];
        const mergedMessages = pendingMessages.length > 0
            ? mergeSnapshotWithPendingMessages(snapshotMessages || [], pendingMessages)
            : (Array.isArray(snapshotMessages) ? snapshotMessages : []);
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

        const messageId = String(payload?.messageId || "").trim();
        const clientMessageId = String(payload?.clientMessageId || "").trim();
        const wamId = String(payload?.wamId || "").trim();
        const nextStatus = String(payload?.status || "").trim();

        let matched = false;
        let nextMessagesSnapshot: Message[] | null = null;

        setMessages((prev) => {
            const next = prev.map((message) => {
                const isMatch = matchesByCorrelation(message as any, {
                    messageId: messageId || null,
                    clientMessageId: clientMessageId || null,
                    wamId: wamId || messageId || null,
                });
                if (!isMatch) return message;

                matched = true;
                return {
                    ...message,
                    ...(messageId ? { id: messageId } : {}),
                    ...(clientMessageId ? { clientMessageId } : {}),
                    ...(wamId ? { wamId } : {}),
                    ...(nextStatus ? { status: nextStatus } : {}),
                    ...(nextStatus ? {
                        sendState: nextStatus === "sending"
                            ? "sending"
                            : nextStatus === "failed"
                                ? "failed"
                                : "sent"
                    } : {}),
                } as Message;
            });
            nextMessagesSnapshot = next;
            return next;
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

    const mergeActivityTimelineEntries = useCallback((
        currentEntries: ActivityTimelineItem[],
        incomingEntry: ActivityTimelineItem
    ): ActivityTimelineItem[] => {
        const nextEntries = [...(Array.isArray(currentEntries) ? currentEntries : [])];
        const existingIndex = nextEntries.findIndex((item) => item?.id === incomingEntry.id);

        if (existingIndex >= 0) {
            nextEntries[existingIndex] = {
                ...nextEntries[existingIndex],
                ...incomingEntry,
            };
        } else {
            nextEntries.push(incomingEntry);
        }

        nextEntries.sort((left, right) => {
            const leftTs = new Date(left.createdAt).getTime();
            const rightTs = new Date(right.createdAt).getTime();
            if (leftTs === rightTs) return String(left.id || "").localeCompare(String(right.id || ""));
            return leftTs - rightTs;
        });

        return nextEntries;
    }, []);

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
            cacheWorkspaceCoreSnapshot(normalizedConversationId, {
                ...cached,
                activityTimeline: mergeActivityTimelineEntries(
                    (cached.activityTimeline || []) as ActivityTimelineItem[],
                    activityEntry
                ),
            });
        }
    }, [cacheWorkspaceCoreSnapshot, getCachedWorkspaceCoreSnapshot, mergeActivityTimelineEntries]);

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
        const availableIds = new Set(normalizedParticipants.map((conversation) => conversation.id));

        setActiveDealParticipants(normalizedParticipants);
        setDealContacts(contacts);
        setActiveId((prev) => {
            const preferredId = String(preferredConversationId || "").trim();
            if (preferredId && availableIds.has(preferredId)) {
                return preferredId;
            }
            const currentUrlId = urlConversationIdRef.current;
            if (currentUrlId && availableIds.has(currentUrlId)) {
                return currentUrlId;
            }
            if (prev && availableIds.has(prev)) {
                return prev;
            }
            return contacts[0]?.conversationId || normalizedParticipants[0]?.id || null;
        });
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

    const prefetchWorkspaceSidebar = useCallback(async (conversationId: string) => {
        const normalizedConversationId = String(conversationId || "").trim();
        if (!normalizedConversationId) return;
        if (getCachedWorkspaceSidebarSnapshot(normalizedConversationId)) return;
        if (workspaceSidebarInFlightRef.current.has(normalizedConversationId)) return;

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
    }, [cacheWorkspaceSidebarSnapshot, getCachedWorkspaceSidebarSnapshot, trackClientRequest]);

    const prefetchDealWorkspaceCore = useCallback(async (dealId: string) => {
        if (!dealId) return;
        if (dealWorkspaceCoreCacheRef.current.has(dealId)) return;
        if (dealWorkspaceCoreInFlightRef.current.has(dealId)) return;

        dealWorkspaceCoreInFlightRef.current.add(dealId);
        try {
            trackClientRequest("deal_workspace_core_prefetch", { dealId });
            const prefetchedLimit = computeInitialMessageLimitFromViewport(estimateThreadViewportHeightPx());
            const workspace = await getDealWorkspaceCore(dealId, { take: prefetchedLimit });
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
            cacheDealWorkspaceCoreSnapshot(dealId, createDealWorkspaceCoreSnapshot({
                dealId,
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
            dealWorkspaceCoreInFlightRef.current.delete(dealId);
        }
    }, [cacheDealWorkspaceCoreSnapshot, trackClientRequest]);

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
    }, [applyDealParticipants, trackClientRequest]);

    const refreshActiveDealWorkspace = useCallback(async (
        dealId: string,
        options?: {
            reason?: string;
            take?: number;
            refreshSidebar?: boolean;
        }
    ) => {
        const normalizedDealId = String(dealId || "").trim();
        if (!normalizedDealId) return null;

        const requestedTake = Number(options?.take);
        const take = Number.isFinite(requestedTake) && requestedTake > 0
            ? Math.min(Math.max(Math.floor(requestedTake), 1), THREAD_TARGET_MESSAGE_COUNT)
            : THREAD_TARGET_MESSAGE_COUNT;

        trackClientRequest("deal_workspace_refresh", {
            dealId: normalizedDealId,
            reason: options?.reason || "manual",
            take,
        });

        try {
            const workspace = await getDealWorkspaceCore(normalizedDealId, { take });
            if (!workspace?.success) return workspace;
            if (activeDealIdRef.current !== normalizedDealId) return workspace;

            const timelineEvents = Array.isArray(workspace.timelineEvents) ? workspace.timelineEvents : [];
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
                void loadDealWorkspaceSidebar(normalizedDealId, { reason: options.reason || "refresh" });
            }

            return workspace;
        } catch (error) {
            console.error("Failed to refresh deal workspace:", error);
            return null;
        }
    }, [
        applyDealWorkspaceCoreSnapshot,
        cacheDealWorkspaceCoreSnapshot,
        loadDealWorkspaceSidebar,
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

                trackClientRequest("deal_open_initial", {
                    dealId: selectedDealId,
                    deal_open_initial_ms: Date.now() - dealOpenStartedAtMs,
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
                            trackClientRequest("deal_open_full", {
                                dealId: selectedDealId,
                                deal_open_full_ms: Date.now() - dealOpenStartedAtMs,
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
        applyDealWorkspaceCoreSnapshot,
        cacheDealWorkspaceCoreSnapshot,
        getCachedDealWorkspaceCoreSnapshot,
        isDealWorkspaceHydrationBusy,
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
        const fetchedConversations = Array.isArray(data?.conversations)
            ? data.conversations.map((c: Conversation) => {
                if (c.id && readResetInFlightRef.current.has(c.id)) {
                    return { ...c, unreadCount: 0 };
                }
                return c;
            })
            : [];
        setConversations(fetchedConversations);
        setConversationListHasMore(!!data?.hasMore);
        setConversationListNextCursor(typeof data?.nextCursor === 'string' ? data.nextCursor : null);
        if (typeof data?.deltaCursor === 'string' || data?.deltaCursor === null) {
            setConversationDeltaCursor(data?.deltaCursor || null);
            conversationDeltaCursorRef.current = data?.deltaCursor || null;
        }
    }, []);

    const appendConversationPageFromResponse = useCallback((data: any) => {
        const incoming = Array.isArray(data?.conversations)
            ? data.conversations.map((c: Conversation) => {
                if (c.id && readResetInFlightRef.current.has(c.id)) {
                    return { ...c, unreadCount: 0 };
                }
                return c;
            })
            : [];
        setConversations(prev => mergeConversationLists(prev, incoming));
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
            .map((item: any) => {
                const conv = { ...item.conversation };
                // Prevent stale DB reads from reverting our optimistic read state
                if (conv.id && readResetInFlightRef.current.has(conv.id)) {
                    conv.unreadCount = 0;
                }
                return conv;
            });
        const removedIds = new Set(
            deltas
                .filter((item: any) => item && item.matchesFilter === false && item.id)
                .map((item: any) => item.id)
        );

        // We DO NOT call setActiveId(null) here even if the active conversation is in removedIds.
        // If a user clicks an archived conversation from the search results while on the 'active' tab,
        // it will naturally not match the filter, but we should not kick them out of the chat window.

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
        searchQuery,
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
            const selectedConversationsForDeal = ids
                .map((id) => selectedConversationCacheRef.current.get(id) || conversationsRef.current.find((conversation) => conversation.id === id))
                .filter((conversation): conversation is Conversation => !!conversation);
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
    const selectedConversations = Array.from(selectedIds)
        .map((id) => selectedConversationCacheRef.current.get(id) || conversations.find((conversation) => conversation.id === id))
        .filter((conversation): conversation is Conversation => !!conversation);
    const selectedDealConversation = activeDealParticipants.find((conversation) => conversation.id === activeId) || null;
    const activeDealListEntry = deals.find((deal) => deal?.id === activeDealId) || null;
    const activeDealSnapshot = activeDealId ? getCachedDealWorkspaceCoreSnapshot(activeDealId) : null;
    const activeDealTitle = String(activeDealListEntry?.title || activeDealSnapshot?.title || "Deal").trim() || "Deal";
    const activeDealEnrichmentStatus = String(
        activeDealMetadata?.enrichment?.status
        || activeDealListEntry?.metadata?.enrichment?.status
        || ""
    ).trim().toLowerCase();
    const dealMissionConversation = dealTimelineInitialPainted ? selectedDealConversation : null;

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
        // Cached conversations skip the debounce (instant render above, then
        // immediate background refresh here).
        const WORKSPACE_NETWORK_DEBOUNCE_MS = cachedSnapshot ? 0 : 150;
        const networkDebounceTimer = setTimeout(() => {
            if (cancelled || activeIdRef.current !== selectedConversationId) return;
            void loadWorkspaceCore();
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
        const workspaceSidebarInFlight = workspaceSidebarInFlightRef.current;

        return () => {
            cancelled = true;
            clearTimeout(networkDebounceTimer);
            clearDeferredHydrationTimer();
            workspaceInitialHydrationInFlight.delete(selectedConversationId);
            workspaceBackfillInFlight.delete(selectedConversationId);
            workspaceActivityHydrationInFlight.delete(selectedConversationId);
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
    }, [viewMode, viewFilter, isTabVisible, searchQuery, featureFlags.balancedPolling, featureFlags.workspaceV2, featureFlags.realtimeSse, realtimeMode, applyConversationDeltaPayload, markConversationReadInUi, replaceConversationListFromResponse, trackClientRequest]);

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
        if (viewMode !== 'deals' || !activeDealId) return;
        if (!isTabVisible) return;
        if (featureFlags.realtimeSse && realtimeMode !== 'fallback') return;

        let cancelled = false;
        const intervalMs = featureFlags.balancedPolling ? 20_000 : 5_000;

        const runActiveDealDelta = async () => {
            const selectedDealId = activeDealIdRef.current;
            if (!selectedDealId) return;

            try {
                if (isDealWorkspaceHydrationBusy(selectedDealId)) {
                    trackClientRequest("deal_active_poll_skipped_hydration", { dealId: selectedDealId });
                    return;
                }

                await refreshActiveDealWorkspace(selectedDealId, {
                    reason: "poll",
                    refreshSidebar: true,
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
        isDealWorkspaceHydrationBusy,
        isTabVisible,
        realtimeMode,
        refreshActiveDealWorkspace,
        trackClientRequest,
        viewMode,
    ]);

    useEffect(() => {
        if (!featureFlags.realtimeSse) {
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
                const event = JSON.parse(rawData || "{}");
                const conversationId = event?.conversationId ? String(event.conversationId) : null;
                const eventType = String(event?.type || "");
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

                if (viewMode === 'deals') {
                    const payloadDealId = String(event?.payload?.dealId || "").trim();
                    if (eventType === "deal.update" && payloadDealId && payloadDealId === activeDealIdRef.current) {
                        if (isDealWorkspaceHydrationBusy(payloadDealId)) {
                            trackClientRequest("deal_realtime_refresh_skipped_hydration", { dealId: payloadDealId });
                            return;
                        }
                        void refreshActiveDealWorkspace(payloadDealId, {
                            reason: "realtime",
                            refreshSidebar: true,
                        });
                    }
                    return;
                }

                if (viewMode === "chats" && conversationId && (eventType === "message.status" || eventType === "message.outbound")) {
                    const payload = event?.payload && typeof event.payload === "object"
                        ? event.payload as Record<string, unknown>
                        : {};
                    const patched = applyRealtimeMessagePatch(conversationId, payload);
                    if (patched) return;

                    // Fallback consistency repair for unknown message ids.
                    runRealtimeRefresh(conversationId);
                    return;
                }

                if (viewMode === "chats" && conversationId && eventType === "activity.created") {
                    const payload = event?.payload && typeof event.payload === "object"
                        ? event.payload as Record<string, unknown>
                        : {};
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

                // ── Optimistic inbound message insertion ──
                // When the SSE carries an enriched message.inbound event we can
                // render the bubble immediately without a server round-trip.
                if (viewMode === "chats" && conversationId && eventType === "message.inbound") {
                    const payload = event?.payload && typeof event.payload === "object"
                        ? event.payload as Record<string, unknown>
                        : {};
                    const messageId = String(payload?.messageId || "").trim();
                    const body = String(payload?.body ?? "");
                    const createdAt = String(payload?.createdAt || new Date().toISOString());
                    const wamId = String(payload?.wamId || "");

                    if (conversationId === activeIdRef.current && messageId) {
                        // Active conversation → optimistic append
                        const optimisticMessage: Message = {
                            id: messageId,
                            wamId: wamId || undefined,
                            clientMessageId: String(payload?.clientMessageId || "") || undefined,
                            conversationId: "",   // not used by UI rendering
                            contactId: "",        // not used by UI rendering
                            body,
                            type: "WhatsApp",
                            direction: "inbound" as const,
                            status: "received",
                            sendState: "sent",
                            dateAdded: createdAt,
                            attachments: [],
                        } as Message;

                        setMessages((prev) => {
                            // Guard against duplicate
                            if (prev.some((m) => m.id === messageId || (wamId && (m as any).wamId === wamId))) {
                                return prev;
                            }
                            return [...prev, optimisticMessage];
                        });

                        // Also update the cached snapshot so switching away and back
                        // still shows the message instantly.
                        const cached = getCachedWorkspaceCoreSnapshot(conversationId);
                        if (cached) {
                            const cachedMessages = Array.isArray(cached.messages) ? cached.messages : [];
                            const alreadyInCache = cachedMessages.some(
                                (m) => m.id === messageId || (wamId && (m as any).wamId === wamId)
                            );
                            if (!alreadyInCache) {
                                cacheWorkspaceCoreSnapshot(conversationId, {
                                    ...cached,
                                    messages: [...cachedMessages, optimisticMessage],
                                });
                            }
                        }

                        // Still trigger a background refresh to reconcile optimistic
                        // data with the real server state (attachments, transcript, etc.)
                        runRealtimeRefresh(conversationId);
                        return;
                    }

                    // Non-active conversation → eagerly invalidate cache + prefetch
                    // so the workspace is ready by the time the user clicks.
                    const existingCache = getCachedWorkspaceCoreSnapshot(conversationId);
                    if (existingCache) {
                        // Invalidate stale cache so next open triggers a fresh fetch
                        // but keep it around for instant partial render.
                        workspaceCoreInFlightRef.current.delete(conversationId);
                    }
                    void prefetchWorkspaceCore(conversationId);

                    // Still run the list-level delta to update sidebar badge/preview.
                    runRealtimeRefresh(conversationId);
                    return;
                }

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
            if (viewMode === 'deals') {
                if (activeDealIdRef.current && !isDealWorkspaceHydrationBusy(activeDealIdRef.current)) {
                    void refreshActiveDealWorkspace(activeDealIdRef.current, {
                        reason: "reconnect",
                        refreshSidebar: true,
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
        activeDealId,
        applyRealtimeMessagePatch,
        cacheWorkspaceCoreSnapshot,
        searchQuery,
        featureFlags.realtimeSse,
        getCachedWorkspaceCoreSnapshot,
        isDealWorkspaceHydrationBusy,
        isTabVisible,
        prefetchWorkspaceCore,
        refreshActiveDealWorkspace,
        runRealtimeRefresh,
        trackClientRequest,
        upsertActivityEntryInWorkspace,
        viewFilter,
        viewMode,
    ]);

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
    }, [viewMode, activeId, conversations, prefetchWorkspaceCore, prefetchWorkspaceSidebar]);

    useEffect(() => {
        if (viewMode !== 'deals') return;

        const candidateIds = deals
            .filter((deal) => deal?.id && deal.id !== activeDealId)
            .slice(0, 3)
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

    const handleRestore = async (ids: string[]) => {
        if (ids.length === 0) return;

        try {
            const res = await restoreConversations(ids);
            if (res.success) {
                toast({ title: "Restored", description: `Restored ${res.count} conversation(s).` });

                // Remove from local state
                const idSet = new Set(ids);
                setConversations(prev => prev.filter(c => !idSet.has(c.id)));

                // Clear selection
                setSelectedIds(new Set());
                if (ids.length === conversations.length) {
                    setIsSelectionMode(false);
                }

                // If active ID was restored, deselect
                if (activeId && idSet.has(activeId)) {
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
        type: 'SMS' | 'Email' | 'WhatsApp',
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
        const optimisticClientMessageId = (
            typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                ? `cmid_${crypto.randomUUID()}`
                : `cmid_${Date.now()}_${Math.random().toString(36).slice(2)}`
        );
        const optimisticMessageId = `opt-${optimisticClientMessageId}`;
        const optimisticMessage: any = {
            id: optimisticMessageId,
            clientMessageId: optimisticClientMessageId,
            conversationId: conversationTarget.id,
            contactId: conversationTarget.contactId,
            body: text,
            type,
            direction: 'outbound',
            status: 'sending',
            sendState: 'queued',
            outboxState: { id: null, status: 'pending' },
            dateAdded: new Date().toISOString(),
            createdAt: new Date(),
            updatedAt: new Date(),
            ...(options?.translationSourceText && String(options.translationSourceText).trim() ? {
                translation: {
                    active: {
                        targetLanguage: options.translationTargetLanguage || conversationTarget.replyLanguageOverride || conversationTarget.locationDefaultReplyLanguage || "en",
                        sourceLanguage: options.translationDetectedSourceLanguage || null,
                        sourceText: String(options.translationSourceText || "").trim(),
                        translatedText: text,
                        status: "completed",
                        provider: "manual_send_preview",
                        model: "manual_send_preview",
                        updatedAt: new Date().toISOString(),
                    },
                    available: [{
                        targetLanguage: options.translationTargetLanguage || conversationTarget.replyLanguageOverride || conversationTarget.locationDefaultReplyLanguage || "en",
                        sourceLanguage: options.translationDetectedSourceLanguage || null,
                        sourceText: String(options.translationSourceText || "").trim(),
                        translatedText: text,
                        status: "completed",
                        provider: "manual_send_preview",
                        model: "manual_send_preview",
                        updatedAt: new Date().toISOString(),
                    }],
                    viewDefault: "original",
                },
            } : {}),
        };

        if (viewMode === 'chats' && activeIdRef.current === conversationTarget.id) {
            setMessages((prev) => {
                const next = [...prev, optimisticMessage];
                syncPendingMessagesForConversation(conversationTarget.id, next);
                return next;
            });
        }

        const capturedConversationId = conversationTarget.id;
        const capturedContactId = conversationTarget.contactId;

        const markOptimisticMessageFailed = () => {
            if (viewMode !== 'chats' || activeIdRef.current !== capturedConversationId) return;
            setMessages((prev) => {
                const next = prev.map((m) =>
                    m.id === optimisticMessageId
                        ? { ...m, status: 'failed', sendState: 'failed', outboxState: { ...(m as any).outboxState, status: 'dead' } }
                        : m
                );
                syncPendingMessagesForConversation(capturedConversationId, next);
                return next;
            });
        };

        let sendFailureToastShown = false;
        try {
            const res = await sendReply(capturedConversationId, capturedContactId, text, type, {
                clientMessageId: optimisticClientMessageId,
                translationSourceText: options?.translationSourceText || null,
                translationTargetLanguage: options?.translationTargetLanguage || null,
                translationDetectedSourceLanguage: options?.translationDetectedSourceLanguage || null,
            });

            if (!res.success) {
                markOptimisticMessageFailed();
                const description = typeof res.error === 'string' ? res.error : 'Unknown error occurred';
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
                const ackMessageId = String((res as any).messageId || "").trim();
                const ackClientMessageId = String((res as any).clientMessageId || optimisticClientMessageId).trim();
                const outboxJobId = String((res as any).outboxJobId || "").trim();
                const queued = !!(res as any).queued;
                const queueAccepted = (res as any).queueAccepted !== false;
                const dispatchMode = String((res as any).dispatchMode || "queued").trim();
                const fallbackSent = dispatchMode === "inline_fallback_sent";
                const degradedDelivery = !queueAccepted && queued && !fallbackSent;
                const warning = String((res as any).warning || "").trim();

                setMessages((prev) => {
                    const next = prev.map((message) => {
                        const isTarget = matchesByCorrelation(message as any, {
                            messageId: optimisticMessageId,
                            clientMessageId: optimisticClientMessageId,
                        });
                        if (!isTarget) return message;

                        return {
                            ...message,
                            ...(ackMessageId ? { id: ackMessageId } : {}),
                            clientMessageId: ackClientMessageId,
                            status: fallbackSent ? 'sent' : (queued ? 'sending' : 'sent'),
                            sendState: fallbackSent ? 'sent' : (degradedDelivery ? 'retrying' : (queued ? 'queued' : 'sent')),
                            outboxState: {
                                id: outboxJobId || (message as any)?.outboxState?.id || null,
                                status: fallbackSent ? 'completed' : (degradedDelivery ? 'failed' : (queued ? 'pending' : 'completed')),
                            },
                        } as Message;
                    });

                    syncPendingMessagesForConversation(capturedConversationId, next);
                    return next;
                });

                if (warning) {
                    toast({
                        title: 'WhatsApp delivery degraded',
                        description: warning,
                    });
                } else if (degradedDelivery) {
                    toast({
                        title: 'WhatsApp delivery degraded',
                        description: 'Queue enqueue failed. Durable auto-recovery is active for this message.',
                    });
                }
            }
        } catch (e: any) {
            markOptimisticMessageFailed();
            if (!sendFailureToastShown) {
                toast({
                    title: 'Failed to send message',
                    description: e?.message || 'Unknown error occurred',
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

        setMessages((prev) => prev.map((message) => {
            if (String(message.id || "") !== normalizedMessageId) return message;
            return {
                ...message,
                detectedLanguage: result.translation?.sourceLanguage || null,
                translation: {
                    active: result.translation,
                    available: result.translation ? [result.translation] : [],
                    viewDefault: result.translation?.sourceLanguage ? "translated" : "original",
                },
                translations: result.translation ? [result.translation] : [],
            };
        }));

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
            const refreshed = await fetchMessages(activeConversationId);
            if (activeIdRef.current === activeConversationId) {
                setMessages(refreshed);
                messageSignatureRef.current = getMessageSignature(refreshed);
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

    const handleContactMerged = useCallback(async (conversationId: string, targetContactId: string, targetConversationId?: string | null) => {
        const normalizedConversationId = String(conversationId || "").trim();
        if (!normalizedConversationId || !targetContactId) return;

        // 1. Remove the old (source) conversation from the list — it's been deleted/merged
        setConversations(prev => prev.filter(c => c.id !== normalizedConversationId));
        setSearchResults(prev => prev.filter(c => c.id !== normalizedConversationId));

        // 2. Invalidate workspace cache for the old conversation
        workspaceCoreCacheRef.current.delete(normalizedConversationId);

        // 3. Keep local state coherent while we navigate away from the merged source contact
        const targetConvId = targetConversationId ? String(targetConversationId).trim() : null;
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

        // Optimistic UI update for media
        const optimisticClientMessageId = (
            typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                ? `cmid_${crypto.randomUUID()}`
                : `cmid_${Date.now()}_${Math.random().toString(36).slice(2)}`
        );
        const optimisticMessageId = `opt-media-${optimisticClientMessageId}`;
        const objectUrl = URL.createObjectURL(file);
        const optimisticMessage: any = {
            id: optimisticMessageId,
            clientMessageId: optimisticClientMessageId,
            conversationId: conversationTarget.id,
            contactId: conversationTarget.contactId,
            body: caption,
            type: 'WhatsApp',
            direction: 'outbound',
            status: 'sending',
            sendState: 'queued',
            outboxState: { id: null, status: 'pending' },
            dateAdded: new Date().toISOString(),
            createdAt: new Date(),
            updatedAt: new Date(),
            attachments: [
                {
                    id: `opt-att-${Date.now()}`,
                    url: objectUrl,
                    fileName: file.name,
                    mimeType: file.type || 'application/octet-stream',
                }
            ]
        };

        if (viewMode === 'chats' && activeIdRef.current === conversationTarget.id) {
            setMessages((prev) => {
                const next = [...prev, optimisticMessage];
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
                if (viewMode === 'chats' && activeIdRef.current === conversationTarget.id) {
                    setMessages((prev) => {
                        const next = prev.map((m) =>
                            m.id === optimisticMessageId
                                ? { ...m, status: 'failed', sendState: 'failed', outboxState: { ...(m as any).outboxState, status: 'dead' } }
                                : m
                        );
                        syncPendingMessagesForConversation(conversationTarget.id, next);
                        return next;
                    });
                }
                toast({
                    title: 'Failed to prepare media upload',
                    description: typeof prep.error === 'string' ? prep.error : 'Unknown error',
                    variant: 'destructive',
                });
                return;
            }

            if (!prep.uploadUrl || !prep.upload) {
                if (viewMode === 'chats' && activeIdRef.current === conversationTarget.id) {
                    setMessages((prev) => {
                        const next = prev.map((m) =>
                            m.id === optimisticMessageId
                                ? { ...m, status: 'failed', sendState: 'failed', outboxState: { ...(m as any).outboxState, status: 'dead' } }
                                : m
                        );
                        syncPendingMessagesForConversation(conversationTarget.id, next);
                        return next;
                    });
                }
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
                if (viewMode === 'chats' && activeIdRef.current === conversationTarget.id) {
                    setMessages((prev) => {
                        const next = prev.map((m) =>
                            m.id === optimisticMessageId
                                ? { ...m, status: 'failed', sendState: 'failed', outboxState: { ...(m as any).outboxState, status: 'dead' } }
                                : m
                        );
                        syncPendingMessagesForConversation(conversationTarget.id, next);
                        return next;
                    });
                }
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
                    const ackMessageId = String((sendRes as any).messageId || "").trim();
                    const ackClientMessageId = String((sendRes as any).clientMessageId || optimisticClientMessageId).trim();
                    const outboxJobId = String((sendRes as any).outboxJobId || "").trim();
                    const queueAccepted = (sendRes as any).queueAccepted !== false;
                    const dispatchMode = String((sendRes as any).dispatchMode || "queued").trim();
                    const fallbackSent = dispatchMode === "inline_fallback_sent";
                    const degradedDelivery = !queueAccepted && !fallbackSent;
                    const warning = String((sendRes as any).warning || "").trim();

                    setMessages((prev) => {
                        const next = prev.map((message) => {
                            const isTarget = matchesByCorrelation(message as any, {
                                messageId: optimisticMessageId,
                                clientMessageId: optimisticClientMessageId,
                            });
                            if (!isTarget) return message;

                            return {
                                ...message,
                                ...(ackMessageId ? { id: ackMessageId } : {}),
                                clientMessageId: ackClientMessageId,
                                status: fallbackSent ? 'sent' : 'sending',
                                sendState: fallbackSent ? 'sent' : (degradedDelivery ? 'retrying' : 'queued'),
                                outboxState: {
                                    id: outboxJobId || (message as any)?.outboxState?.id || null,
                                    status: fallbackSent ? 'completed' : (degradedDelivery ? 'failed' : 'pending'),
                                },
                            } as Message;
                        });

                        syncPendingMessagesForConversation(conversationTarget.id, next);
                        return next;
                    });

                    if (warning) {
                        toast({
                            title: 'WhatsApp delivery degraded',
                            description: warning,
                        });
                    } else if (degradedDelivery) {
                        toast({
                            title: 'WhatsApp delivery degraded',
                            description: 'Queue enqueue failed. Durable auto-recovery is active for this media message.',
                        });
                    }
                }
            } else {
                if (viewMode === 'chats' && activeIdRef.current === conversationTarget.id) {
                    setMessages((prev) => {
                        const next = prev.map((m) =>
                            m.id === optimisticMessageId
                                ? { ...m, status: 'failed', sendState: 'failed', outboxState: { ...(m as any).outboxState, status: 'dead' } }
                                : m
                        );
                        syncPendingMessagesForConversation(conversationTarget.id, next);
                        return next;
                    });
                }
                toast({
                    title: 'Failed to send media',
                    description: typeof sendRes.error === 'string' ? sendRes.error : 'Unknown error',
                    variant: 'destructive',
                });
            }
        } catch (e: any) {
            if (viewMode === 'chats' && activeIdRef.current === conversationTarget.id) {
                setMessages((prev) => {
                    const next = prev.map((m) =>
                        m.id === optimisticMessageId
                            ? { ...m, status: 'failed', sendState: 'failed', outboxState: { ...(m as any).outboxState, status: 'dead' } }
                            : m
                    );
                    syncPendingMessagesForConversation(conversationTarget.id, next);
                    return next;
                });
            }
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
                const next = prev.map((m) => m.id === messageId ? { ...m, status: 'sending', sendState: 'queued' } : m);
                syncPendingMessagesForConversation(conversationTarget.id, next);
                return next;
            });
        }

        try {
            const resendClientMessageId = (
                typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                    ? `cmid_${crypto.randomUUID()}`
                    : `cmid_${Date.now()}_${Math.random().toString(36).slice(2)}`
            );
            const hasAttachments = originalMsg.attachments && originalMsg.attachments.length > 0;
            const res = hasAttachments 
              // Basic retry for text for now, media retry requires original file which we don't store on client.
              // We'll fallback to alerting for media if we can't reconstruct.
              ? { success: false, error: "Retrying media messages is not supported without re-uploading the file" }
              : await sendReply(
                  conversationTarget.id,
                  conversationTarget.contactId,
                  originalMsg.body,
                  originalMsg.type as 'SMS'|'Email'|'WhatsApp',
                  { clientMessageId: resendClientMessageId }
              );

            if (!res.success) {
                if (viewMode === 'chats' && activeIdRef.current === conversationTarget.id) {
                    setMessages((prev) => {
                        const next = prev.map((m) => m.id === messageId ? { ...m, status: 'failed', sendState: 'failed' } : m);
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
                const ackMessageId = String((res as any).messageId || "").trim();
                const ackClientMessageId = String((res as any).clientMessageId || resendClientMessageId).trim();
                const outboxJobId = String((res as any).outboxJobId || "").trim();
                const queued = !!(res as any).queued;
                const queueAccepted = (res as any).queueAccepted !== false;
                const dispatchMode = String((res as any).dispatchMode || "queued").trim();
                const fallbackSent = dispatchMode === "inline_fallback_sent";
                const degradedDelivery = !queueAccepted && queued && !fallbackSent;
                const warning = String((res as any).warning || "").trim();

                setMessages((prev) => {
                    const next = prev.map((m) => {
                        if (m.id !== messageId) return m;
                        return {
                            ...m,
                            ...(ackMessageId ? { id: ackMessageId } : {}),
                            clientMessageId: ackClientMessageId,
                            status: fallbackSent ? 'sent' : (queued ? 'sending' : 'sent'),
                            sendState: fallbackSent ? 'sent' : (degradedDelivery ? 'retrying' : (queued ? 'queued' : 'sent')),
                            outboxState: fallbackSent
                                ? { id: outboxJobId || null, status: 'completed' }
                                : degradedDelivery
                                    ? { id: outboxJobId || null, status: 'failed' }
                                    : queued
                                        ? { id: outboxJobId || null, status: 'pending' }
                                        : { id: outboxJobId || null, status: 'completed' },
                        } as Message;
                    });
                    syncPendingMessagesForConversation(conversationTarget.id, next);
                    return next;
                });

                if (warning) {
                    toast({
                        title: 'WhatsApp delivery degraded',
                        description: warning,
                    });
                } else if (degradedDelivery) {
                    toast({
                        title: 'WhatsApp delivery degraded',
                        description: 'Queue enqueue failed. Durable auto-recovery is active for this resend.',
                    });
                }
            }
        } catch (e: any) {
            if (viewMode === 'chats' && activeIdRef.current === conversationTarget.id) {
                setMessages((prev) => {
                    const next = prev.map((m) => m.id === messageId ? { ...m, status: 'failed', sendState: 'failed' } : m);
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
    const suggestedResponseQueueIdleHandleRef = useRef<number | null>(null);
    const suggestedResponseQueueTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Reset suggestions when active conversation changes
    useEffect(() => {
        setSuggestions([]);
    }, [activeId]);

    useEffect(() => {
        setChatTimelineInitialPainted(false);
    }, [viewMode, activeId]);

    useEffect(() => {
        setComposerInsertSeed(null);
    }, [viewMode, activeId, activeDealId]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const globalWindow = window as any;
        globalWindow.__ESTIO_INSERT_COMPOSER_DRAFT__ = (payload: {
            key?: string;
            body?: string;
            conversationId?: string | null;
        }) => {
            const body = String(payload?.body || "").trim();
            if (!body) return false;

            const targetConversationId = String(payload?.conversationId || "").trim();
            const activeConversationId = String(activeIdRef.current || "").trim();
            if (targetConversationId && activeConversationId && targetConversationId !== activeConversationId) {
                return false;
            }

            setComposerInsertSeed({
                key: String(payload?.key || `${Date.now()}`),
                body,
            });
            return true;
        };

        return () => {
            if (globalWindow.__ESTIO_INSERT_COMPOSER_DRAFT__) {
                delete globalWindow.__ESTIO_INSERT_COMPOSER_DRAFT__;
            }
        };
    }, []);

    const suggestedResponseQueueConversationId = viewMode === 'chats' ? String(activeId || "").trim() : "";
    const suggestedResponseQueueDealId = viewMode === 'deals' ? String(activeDealId || "").trim() : "";
    const suggestedResponseQueueScopeKey = suggestedResponseQueueConversationId
        ? `chat:${suggestedResponseQueueConversationId}`
        : suggestedResponseQueueDealId
            ? `deal:${suggestedResponseQueueDealId}`
            : "";
    const suggestedResponseQueueReady = viewMode === 'chats'
        ? (!!suggestedResponseQueueConversationId && chatTimelineInitialPainted)
        : (!!suggestedResponseQueueDealId && dealTimelineInitialPainted);

    const clearSuggestedResponseQueueAutoLoad = useCallback(() => {
        if (
            suggestedResponseQueueIdleHandleRef.current !== null
            && typeof window !== 'undefined'
            && 'cancelIdleCallback' in window
        ) {
            (window as any).cancelIdleCallback(suggestedResponseQueueIdleHandleRef.current);
            suggestedResponseQueueIdleHandleRef.current = null;
        }
        if (suggestedResponseQueueTimeoutRef.current) {
            clearTimeout(suggestedResponseQueueTimeoutRef.current);
            suggestedResponseQueueTimeoutRef.current = null;
        }
    }, []);

    const refreshSuggestedResponseQueue = useCallback(async (options?: { trigger?: string }) => {
        if (!suggestedResponseQueueConversationId && !suggestedResponseQueueDealId) {
            setSuggestedResponseQueue([]);
            setLoadingSuggestedResponseQueue(false);
            return;
        }

        const requestId = suggestedResponseQueueRequestIdRef.current + 1;
        suggestedResponseQueueRequestIdRef.current = requestId;
        trackClientRequest("suggested_response_queue_load", {
            scopeKey: suggestedResponseQueueScopeKey,
            trigger: options?.trigger || "manual",
        });
        setLoadingSuggestedResponseQueue(true);

        try {
            const rows = await listSuggestedResponses({
                conversationId: suggestedResponseQueueConversationId || undefined,
                dealId: suggestedResponseQueueDealId || undefined,
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
    }, [
        suggestedResponseQueueConversationId,
        suggestedResponseQueueDealId,
        suggestedResponseQueueScopeKey,
        trackClientRequest,
    ]);

    useEffect(() => {
        clearSuggestedResponseQueueAutoLoad();
        suggestedResponseQueueRequestIdRef.current += 1;
        setSuggestedResponseQueue([]);
        setLoadingSuggestedResponseQueue(false);
    }, [clearSuggestedResponseQueueAutoLoad, suggestedResponseQueueScopeKey]);

    useEffect(() => {
        if (!suggestedResponseQueueScopeKey || !suggestedResponseQueueReady) return;

        clearSuggestedResponseQueueAutoLoad();

        const runAutoLoad = () => {
            suggestedResponseQueueIdleHandleRef.current = null;
            suggestedResponseQueueTimeoutRef.current = null;
            void refreshSuggestedResponseQueue({ trigger: "auto" });
        };

        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
            suggestedResponseQueueIdleHandleRef.current = (window as any).requestIdleCallback(runAutoLoad, { timeout: 1200 });
        } else {
            suggestedResponseQueueTimeoutRef.current = setTimeout(runAutoLoad, 250);
        }

        return clearSuggestedResponseQueueAutoLoad;
    }, [
        clearSuggestedResponseQueueAutoLoad,
        refreshSuggestedResponseQueue,
        suggestedResponseQueueReady,
        suggestedResponseQueueScopeKey,
    ]);

    useEffect(() => {
        return () => {
            clearSuggestedResponseQueueAutoLoad();
        };
    }, [clearSuggestedResponseQueueAutoLoad]);

    const handleMissionSuggestionsGenerated = useCallback((nextSuggestions: string[]) => {
        setSuggestions(Array.isArray(nextSuggestions) ? nextSuggestions : []);
        void refreshSuggestedResponseQueue({ trigger: "mission" });
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

        await refreshSuggestedResponseQueue({ trigger: "accept" });
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
        await refreshSuggestedResponseQueue({ trigger: "reject" });
    }, [refreshSuggestedResponseQueue]);

    const streamDraftViaApi = useCallback(async (args: {
        conversationId: string;
        contactId: string;
        instruction?: string;
        model?: string;
        mode: "chat" | "deal";
        dealId?: string;
        draftLanguage?: string | null;
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
                    draftLanguage: args.draftLanguage ?? null,
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
                if (select) {
                    setSelectedIds((prev) => new Set([...Array.from(prev), ...visibleIds]));
                } else {
                    setSelectedIds((prev) => {
                        const next = new Set(prev);
                        visibleIds.forEach((id) => next.delete(id));
                        return next;
                    });
                }
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
        activeConversation ? (
            <ChatWindow
                key={activeConversation.id} // Force remount to reset internal state/scroll
                conversation={activeConversation}
                messages={messages}
                activityLog={activityLog}
                loading={isChatLoading}
                onBack={isMobileViewport ? handleBackToList : undefined}
                onOpenMissionControl={isMobileViewport ? handleOpenMissionControl : undefined}
                onSendMessage={handleSendMessage}
                composerDraft={getComposerDraft(activeConversation.id)}
                onComposerDraftChange={(draft) => setComposerDraftForConversation(activeConversation.id, draft)}
                onComposerDraftClear={() => clearComposerDraftForConversation(activeConversation.id)}
                onTranslateMessage={handleTranslateMessage}
                onTranslateVisibleThread={handleTranslateVisibleThread}
                onPreviewTranslatedReply={handlePreviewTranslatedReply}
                translationReadEnabled={featureFlags.conversationTranslationRead}
                translationWriteEnabled={featureFlags.conversationTranslationWrite}
                translationBannerEnabled={featureFlags.conversationTranslationBanner}
                onResendMessage={handleResendMessage}
                onSendMedia={handleSendMedia}
                onRefetchMedia={handleRefetchMedia}
                onRequestTranscript={handleRequestTranscript}
                onExtractViewingNotes={handleExtractViewingNotes}
                onRetryTranscript={handleRetryTranscript}
                onBulkTranscribeUnprocessedAudio={handleBulkTranscribeUnprocessedAudio}
                transcriptOnDemandEnabled={transcriptOnDemandEnabled}
                onSync={handleSync}
                onAddActivityEntry={async (entryText: string, dateIso: string) => {
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
                    draftLanguage?: string | null,
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
                                    draftLanguage,
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
                                { mode: "chat", draftLanguage }
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
                onInitialPaintReady={() => {
                    if (activeIdRef.current === activeConversation.id) {
                        setChatTimelineInitialPainted(true);
                        const loadedAt = initialWorkspaceLoadedAtRef.current[activeConversation.id] || 0;
                        trackClientMetric("thread_messages_ready_ms", loadedAt ? Date.now() - loadedAt : 0, {
                            conversationId: activeConversation.id,
                            message_count: messages.length,
                            cache_hit: !!getCachedWorkspaceCoreSnapshot(activeConversation.id),
                        });
                    }
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
                title={activeDealTitle}
                timelineEvents={dealTimelineEvents}
                loading={isDealLoading}
                hydrationStatus={dealTimelineHydrationStatus}
                composerConversation={selectedDealConversation}
                onBack={isMobileViewport ? handleBackToList : undefined}
                onOpenMissionControl={isMobileViewport ? handleOpenMissionControl : undefined}
                onInitialPaintReady={() => {
                    if (activeDealIdRef.current === activeDealId) {
                        setDealTimelineInitialPainted(true);
                    }
                }}
                onSendMessage={(text, type, options) => handleSendMessage(text, type, options, selectedDealConversation || undefined)}
                composerDraft={getComposerDraft(selectedDealConversation?.id)}
                onComposerDraftChange={(draft) => setComposerDraftForConversation(selectedDealConversation?.id, draft)}
                onComposerDraftClear={() => clearComposerDraftForConversation(selectedDealConversation?.id)}
                onResendMessage={handleResendMessage}
                onSendMedia={(file, caption) => handleSendMedia(file, caption, selectedDealConversation || undefined)}
                onPreviewTranslatedReply={async (sourceText, channel, targetLanguage) => {
                    if (!selectedDealConversation) {
                        return { success: false as const, error: "No conversation selected." };
                    }
                    return previewTranslatedReply(selectedDealConversation.id, sourceText, channel, targetLanguage || null);
                }}
                translationWriteEnabled={featureFlags.conversationTranslationWrite}
                onGenerateDraft={async (
                    instruction?: string,
                    model?: string,
                    draftLanguage?: string | null,
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
                                    draftLanguage,
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
                                { mode: "deal", dealId: activeDealId, draftLanguage }
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
                        ? "Loading recent deal timeline..."
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
                onDraftApproved={(text) => handleSendMessage(text, getMessageType(dealMissionConversation), undefined, dealMissionConversation)}
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
