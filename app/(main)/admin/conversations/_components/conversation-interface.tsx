'use client';

import { useState, useEffect, useCallback, useRef, type TouchEvent as ReactTouchEvent, type ReactNode } from 'react';
import { useDebounce } from 'use-debounce';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Conversation, Message } from '@/lib/ghl/conversations';
import type { ContactIdentityPatch } from '../../contacts/_components/contact-form';
import {
    fetchConversations,
    fetchMessages,
    getConversationWorkspace,
    getConversationListDelta,
    refreshConversationOnDemand,
    sendReply,
    createWhatsAppMediaUploadUrl,
    sendWhatsAppMediaReply,
    generateAIDraft,
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
} from '../actions';
import { toast } from '@/components/ui/use-toast';
import { getDealContexts, createPersistentDeal, getDealContext } from '../../deals/actions';
import { UnifiedTimeline } from './unified-timeline';
import { ConversationList } from './conversation-list';
import { ChatWindow } from './chat-window';
import { CoordinatorPanel } from './coordinator-panel';
import { UndoToast } from './undo-toast';
import { WhatsAppImportModal } from './whatsapp-import-modal';
import { CreateDealDialog } from './create-deal-dialog';
import { SyncAllChatsDialog } from './sync-all-chats-dialog';
import { NewConversationDialog } from './new-conversation-dialog';
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
    const mobileTouchStartRef = useRef<{ x: number; y: number } | null>(null);

    // -- Clean Helper for URL updates --
    // We use a callback to ensure we always have the latest params
    const updateUrl = useCallback((updates: Record<string, string | null>) => {
        const params = new URLSearchParams(searchParams.toString());

        Object.entries(updates).forEach(([key, value]) => {
            if (value === null) {
                params.delete(key);
            } else {
                params.set(key, value);
            }
        });

        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, [pathname, router, searchParams]);

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
    const urlConversationId = searchParams.get('id');
    const [activeDealId, setActiveDealId] = useState<string | null>(initialDealId);
    const [transcriptOnDemandEnabled, setTranscriptOnDemandEnabled] = useState(false);

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

    useEffect(() => {
        const onVisibility = () => setIsTabVisible(typeof document === 'undefined' ? true : !document.hidden);
        onVisibility();
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
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

    const markConversationReadInUi = useCallback(async (conversationId: string) => {
        const currentConversation = conversationsRef.current.find((c) => c.id === conversationId);
        if (!currentConversation || (currentConversation.unreadCount || 0) <= 0) return;

        try {
            const res = await markConversationAsRead(conversationId);
            if (!res?.success) return;
            setConversations(prev =>
                prev.map(c => c.id === conversationId ? { ...c, unreadCount: 0 } : c)
            );
        } catch (err) {
            console.error("Failed to mark conversation as read:", err);
        }
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
        setMessages([]);
        setActivityLog([]);
        setTranscriptOnDemandEnabled(false);
        setWorkspaceContactContext(null);
        setWorkspaceTaskSummary(null);
        setWorkspaceViewingSummary(null);
        setWorkspaceAgentSummary(null);
        setLoadingMessages(true);

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
                    if (freshConversation) {
                        setConversations((prev) => prev.map((item) =>
                            item.id === selectedConversationId ? { ...item, ...(freshConversation as any) } : item
                        ));
                    }
                    setWorkspaceContactContext(null);
                    setWorkspaceTaskSummary(null);
                    setWorkspaceViewingSummary(null);
                    setWorkspaceAgentSummary(null);
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

        trackClientRequest("workspace_load", { conversationId: selectedConversationId });
        getConversationWorkspace(selectedConversationId, {
            includeMessages: true,
            includeActivity: true,
            includeContactContext: true,
            includeTaskSummary: true,
            includeViewingSummary: true,
            includeAgentSummary: true,
            messageLimit: 250,
            activityLimit: 180,
        })
            .then(async (workspace) => {
                if (cancelled || activeIdRef.current !== selectedConversationId) return;
                if (!workspace?.success) {
                    throw new Error(workspace?.error || "Failed to load conversation workspace");
                }

                const nextMessages = Array.isArray(workspace?.messages) ? workspace.messages : [];
                const nextActivity = Array.isArray(workspace?.activityTimeline) ? workspace.activityTimeline : [];

                setMessages(nextMessages);
                messageSignatureRef.current = getMessageSignature(nextMessages);
                setActivityLog(nextActivity);

                setWorkspaceContactContext(workspace?.contactContext || null);
                setWorkspaceTaskSummary(workspace?.taskSummary || null);
                setWorkspaceViewingSummary(workspace?.viewingSummary || null);
                setWorkspaceAgentSummary(workspace?.agentSummary || null);
                setTranscriptOnDemandEnabled(!!workspace?.transcriptEligibility?.success && !!workspace?.transcriptEligibility?.enabled);

                const header = workspace?.conversationHeader;
                if (header?.id) {
                    setConversations((prev) => {
                        if (prev.some((item) => item.id === header.id)) {
                            return prev.map((item) => item.id === header.id ? { ...item, ...header } : item);
                        }
                        return [header, ...prev];
                    });
                }

                void markConversationReadInUi(selectedConversationId);

                // Optional background sync for stale threads, throttled per conversation (once / 5 minutes).
                if (featureFlags.workspaceV2 && workspace?.freshness?.threadStale) {
                    const nowMs = Date.now();
                    const lastSyncedMs = backgroundSyncByConversationRef.current[selectedConversationId] || 0;
                    if (nowMs - lastSyncedMs >= 5 * 60 * 1000) {
                        backgroundSyncByConversationRef.current[selectedConversationId] = nowMs;
                        void refreshConversationOnDemand(selectedConversationId, "full_sync")
                            .then(async (syncRes: any) => {
                                if (!syncRes?.success || Number(syncRes?.syncedCount || 0) <= 0) return;
                                const refreshed = await fetchMessages(selectedConversationId);
                                if (activeIdRef.current !== selectedConversationId) return;
                                setMessages(refreshed);
                                messageSignatureRef.current = getMessageSignature(refreshed);
                                void markConversationReadInUi(selectedConversationId);
                            })
                            .catch((err) => console.error("[Workspace Background Sync] Error:", err));
                    }
                }
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("Failed to load conversation workspace:", err);
                toast({ title: "Error", description: "Failed to load conversation workspace.", variant: "destructive" });
            })
            .finally(() => {
                if (!cancelled) setLoadingMessages(false);
            });

        return () => {
            cancelled = true;
        };
    }, [viewMode, activeId, markConversationReadInUi, featureFlags.workspaceV2, trackClientRequest]);

    useEffect(() => {
        if (viewMode !== 'chats' || viewFilter === 'tasks') return;
        if (!isTabVisible) return;
        if (debouncedSearchQuery.trim()) return;

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
    }, [viewMode, viewFilter, isTabVisible, debouncedSearchQuery, featureFlags.balancedPolling, featureFlags.workspaceV2, applyConversationDeltaPayload, markConversationReadInUi, replaceConversationListFromResponse, trackClientRequest]);

    useEffect(() => {
        if (viewMode !== 'chats' || !activeId) return;
        if (!isTabVisible) return;

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

                trackClientRequest("active_delta_poll", { conversationId: selectedConversationId, pendingTranscripts });
                const workspace = await getConversationWorkspace(selectedConversationId, {
                    includeMessages: true,
                    includeActivity: true,
                    includeContactContext: false,
                    includeTaskSummary: false,
                    includeViewingSummary: false,
                    includeAgentSummary: false,
                    messageLimit: 250,
                    activityLimit: 180,
                });
                if (cancelled || !workspace?.success || activeIdRef.current !== selectedConversationId) return;

                if (workspace?.conversationHeader?.id) {
                    setConversations((prev) =>
                        prev.map((conversation) =>
                            conversation.id === workspace.conversationHeader.id
                                ? { ...conversation, ...workspace.conversationHeader }
                                : conversation
                        )
                    );
                }

                const latestMessages = Array.isArray(workspace?.messages) ? workspace.messages : [];
                const latestSignature = getMessageSignature(latestMessages);
                if (latestSignature !== messageSignatureRef.current) {
                    messageSignatureRef.current = latestSignature;
                    setMessages(latestMessages);
                }

                if (Array.isArray(workspace?.activityTimeline)) {
                    setActivityLog(workspace.activityTimeline);
                }

                if (workspace?.transcriptEligibility) {
                    setTranscriptOnDemandEnabled(!!workspace.transcriptEligibility.success && !!workspace.transcriptEligibility.enabled);
                }

                if ((workspace?.conversationHeader?.unreadCount || 0) > 0) {
                    void markConversationReadInUi(selectedConversationId);
                }
            } catch (err) {
                if (!cancelled) {
                    console.error("Active conversation delta sync failed:", err);
                }
            }
        };

        runActiveConversationDelta();
        const intervalId = setInterval(runActiveConversationDelta, intervalMs);

        return () => {
            cancelled = true;
            clearInterval(intervalId);
        };
    }, [viewMode, activeId, isTabVisible, featureFlags.balancedPolling, featureFlags.workspaceV2, markConversationReadInUi, trackClientRequest]);

    // Handle clicking a conversation in the list
    const handleSelect = (id: string) => {
        setActiveId(id);
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
        mobileTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
    }, [isMobileViewport]);

    const handleMobileTouchEnd = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
        if (!isMobileViewport) return;
        const start = mobileTouchStartRef.current;
        mobileTouchStartRef.current = null;
        if (!start) return;

        const touch = event.changedTouches[0];
        if (!touch) return;

        const deltaX = touch.clientX - start.x;
        const deltaY = touch.clientY - start.y;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);

        if (absDeltaX < 70 || absDeltaY > 90) return;

        const hasWindowPane = viewMode === 'deals' ? !!activeDealId : !!activeId;
        if (!hasWindowPane) return;

        if (deltaX < 0) {
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

    const handleConversationContactSaved = useCallback(async (conversationId: string, patch: ContactIdentityPatch) => {
        if (!conversationId || !patch?.id) return;

        const sequence = (contactSaveRefreshSeqRef.current[conversationId] || 0) + 1;
        contactSaveRefreshSeqRef.current[conversationId] = sequence;

        setConversations((prev) => prev.map((conversationItem) => {
            if (conversationItem.id !== conversationId) return conversationItem;

            return {
                ...conversationItem,
                ...(patch.name !== undefined ? { contactName: patch.name || "Unknown" } : {}),
                ...(patch.email !== undefined ? { contactEmail: patch.email || undefined } : {}),
                ...(patch.phone !== undefined ? { contactPhone: patch.phone || undefined } : {}),
            };
        }));

        setActiveDealParticipants((prev) => prev.map((conversationItem) => {
            if (conversationItem.id !== conversationId) return conversationItem;
            return {
                ...conversationItem,
                ...(patch.name !== undefined ? { contactName: patch.name || "Unknown" } : {}),
                ...(patch.email !== undefined ? { contactEmail: patch.email || undefined } : {}),
                ...(patch.phone !== undefined ? { contactPhone: patch.phone || undefined } : {}),
            };
        }));

        setDealContacts((prev) => prev.map((contact) => {
            if (contact.conversationId !== conversationId) return contact;
            return {
                ...contact,
                ...(patch.name !== undefined ? { contactName: patch.name || "Unknown" } : {}),
                ...(patch.email !== undefined ? { contactEmail: patch.email || undefined } : {}),
                ...(patch.phone !== undefined ? { contactPhone: patch.phone || undefined } : {}),
            };
        }));

        try {
            const fresh = await refreshConversation(conversationId);
            if (!fresh) return;
            if (contactSaveRefreshSeqRef.current[conversationId] !== sequence) return;

            setConversations((prev) => prev.map((conversationItem) =>
                conversationItem.id === conversationId ? {
                    ...conversationItem,
                    ...fresh,
                    ...(patch.name !== undefined ? { contactName: patch.name || "Unknown" } : {}),
                    ...(patch.email !== undefined ? { contactEmail: patch.email || undefined } : {}),
                    ...(patch.phone !== undefined ? { contactPhone: patch.phone || undefined } : {}),
                } : conversationItem
            ));
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

    // Reset suggestions when active conversation changes
    useEffect(() => {
        setSuggestions([]);
    }, [activeId]);

    const conversationListPane = (
        <ConversationList
            conversations={debouncedSearchQuery.trim() ? searchResults : conversations}
            selectedId={viewMode === 'chats' ? activeId : activeDealId}
            onSelect={handleSelect}
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
                onGenerateDraft={async (instruction?: string, model?: string) => {
                    try {
                        const res = await generateAIDraft(
                            activeConversation.id,
                            activeConversation.contactId,
                            instruction,
                            model,
                            { mode: "chat" }
                        );
                        if (res.reasoning) {
                            toast({ title: "Draft Generated", description: res.reasoning });
                        }
                        return res.draft;
                    } catch (e: any) {
                        toast({ title: "Draft Failed", description: e.message, variant: "destructive" });
                        return null;
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
                refreshToken={dealTimelineRefreshToken}
                composerConversation={selectedDealConversation}
                onBack={isMobileViewport ? handleBackToList : undefined}
                onOpenMissionControl={isMobileViewport ? handleOpenMissionControl : undefined}
                onSendMessage={(text, type) => handleSendMessage(text, type, selectedDealConversation || undefined)}
                onSendMedia={(file, caption) => handleSendMedia(file, caption, selectedDealConversation || undefined)}
                onGenerateDraft={async (instruction?: string, model?: string) => {
                    if (!selectedDealConversation) return null;
                    try {
                        const res = await generateAIDraft(
                            selectedDealConversation.id,
                            selectedDealConversation.contactId,
                            instruction,
                            model,
                            { mode: "deal", dealId: activeDealId }
                        );
                        if (res.reasoning) {
                            toast({ title: "Draft Generated", description: res.reasoning });
                        }
                        return res.draft;
                    } catch (error: any) {
                        toast({ title: "Draft Failed", description: error?.message || "Failed to generate draft", variant: "destructive" });
                        return null;
                    }
                }}
                suggestions={suggestions}
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
                activityLog={activityLog}
                initialContactContext={workspaceContactContext}
                initialTaskSummary={workspaceTaskSummary}
                initialViewingSummary={workspaceViewingSummary}
                initialAgentSummary={workspaceAgentSummary}
                lazySidebarDataEnabled={featureFlags.lazySidebarData}
                onBackToConversation={isMobileViewport ? handleBackToConversation : undefined}
                onDraftApproved={(text) => handleSendMessage(text, getMessageType(activeConversation))}
                onDeselect={(id) => handleToggleSelect(id, false)}
                onSuggestionsGenerated={setSuggestions}
                onContactSaved={(patch) => handleConversationContactSaved(activeConversation.id, patch)}
            />
        ) : <div className="h-full bg-slate-50" />
    ) : (
        selectedDealConversation ? (
            <CoordinatorPanel
                locationId={locationId}
                conversation={selectedDealConversation}
                selectedConversations={activeDealParticipants}
                activityLog={activityLog}
                initialContactContext={workspaceContactContext}
                initialTaskSummary={workspaceTaskSummary}
                initialViewingSummary={workspaceViewingSummary}
                initialAgentSummary={workspaceAgentSummary}
                lazySidebarDataEnabled={featureFlags.lazySidebarData}
                onBackToConversation={isMobileViewport ? handleBackToConversation : undefined}
                onDraftApproved={(text) => handleSendMessage(text, getMessageType(selectedDealConversation), selectedDealConversation)}
                onDeselect={() => undefined} // No deselect in deal mode
                onSuggestionsGenerated={setSuggestions}
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
            if (mobilePane === 'list') return 'Swipe left to open timeline';
            if (mobilePane === 'window') return 'Swipe left for Mission Control';
            return 'Swipe right to return to timeline';
        }
        if (!activeConversation) return null;
        if (mobilePane === 'list') return 'Swipe left to open conversation';
        if (mobilePane === 'window') return 'Swipe left for Mission Control';
        return 'Swipe right to return to conversation';
    })();

    const currentMobilePane: MobilePane = isMobileThreadOpen
        ? mobilePane
        : 'list';
    const mobilePaneContent: Record<MobilePane, ReactNode> = {
        list: conversationListPane,
        window: conversationMainPane,
        mission: missionControlPane,
    };

    return (
        <>
            {isMobileViewport ? (
                <div
                    className="relative h-full w-full overflow-hidden touch-pan-y"
                    onTouchStart={handleMobileTouchStart}
                    onTouchEnd={handleMobileTouchEnd}
                >
                    {mobilePaneContent[currentMobilePane]}
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
