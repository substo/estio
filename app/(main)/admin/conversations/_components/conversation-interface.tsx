'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDebounce } from 'use-debounce';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Conversation, Message } from '@/lib/ghl/conversations';
import {
    fetchConversations,
    fetchMessages,
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
    getWhatsAppTranscriptOnDemandEligibility,
    searchConversations,
} from '../actions';
import { toast } from '@/components/ui/use-toast';
import { getDealContexts, createPersistentDeal } from '../../deals/actions';
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


interface ConversationInterfaceProps {
    locationId: string;
    initialConversations: Conversation[];
    initialConversationListPageInfo?: {
        hasMore: boolean;
        nextCursor: string | null;
    };
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

export function ConversationInterface({ locationId, initialConversations, initialConversationListPageInfo }: ConversationInterfaceProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

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
    const [conversationListHasMore, setConversationListHasMore] = useState<boolean>(!!initialConversationListPageInfo?.hasMore);
    const [conversationListNextCursor, setConversationListNextCursor] = useState<string | null>(initialConversationListPageInfo?.nextCursor || null);
    const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
    const loadingMoreConversationsRef = useRef(false);
    const liveSyncInFlightRef = useRef(false);

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
    const [activeDealId, setActiveDealId] = useState<string | null>(initialDealId);
    const [transcriptOnDemandEnabled, setTranscriptOnDemandEnabled] = useState(false);

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

    // Fetch Deals when switching mode
    useEffect(() => {
        if (viewMode === 'deals' && deals.length === 0) {
            getDealContexts().then(setDeals).catch(console.error);
        }
    }, [viewMode]);

    // Multi-selection (what shows in the Context Builder)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isSelectionMode, setIsSelectionMode] = useState(false);

    const isFirstLoad = useRef(true);

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
    }, []);

    const appendConversationPageFromResponse = useCallback((data: any) => {
        setConversations(prev => mergeConversationLists(prev, Array.isArray(data?.conversations) ? data.conversations : []));
        setConversationListHasMore(!!data?.hasMore);
        setConversationListNextCursor(typeof data?.nextCursor === 'string' ? data.nextCursor : null);
    }, [mergeConversationLists]);

    // Fetch Conversations when View Filter changes
    useEffect(() => {
        // Tasks view uses its own data source (GlobalTaskList), skip conversation fetching.
        if (viewFilter === 'tasks') return;

        // Preserve a deep-linked/off-window selection during the initial hydration fetch and view switches.
        // fetchConversations() can include the selected conversation even if it falls outside the top list window.
        fetchConversations(viewFilter, activeIdRef.current || undefined)
            .then(data => {
                replaceConversationListFromResponse(data);

                if (isFirstLoad.current) {
                    isFirstLoad.current = false;
                    // Preserve deep linked ID on first load
                } else {
                    setActiveId(null); // Deselect when switching views manually
                }
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

    // Find active deal object
    const activeDeal = deals.find(d => d.id === activeDealId);

    // If in Deal Mode, we might want to "select" the conversations that are part of the deal for the Coordinator
    // But CoordinatorPanel handles dealContextId mostly.

    // For the Right Panel in Deal Mode:
    // We need a dummy conversation or modify CoordinatorPanel to accept just a DealContext?
    // Currently CoordinatorPanel requires `conversation`.
    // If we are in Deal Mode, we might want to pick the "Last Active" conversation of the deal to act as the primary context?
    // OR we update CoordinatorPanel to be optional conversation.

    // Let's find a proxy conversation for the Coordinator if in Deal Mode
    const dealProxyConversation = activeDeal ? conversations.find(c => activeDeal.conversationIds.includes(c.id)) : null;

    useEffect(() => {
        let cancelled = false;
        if (!activeConversation) {
            setTranscriptOnDemandEnabled(false);
            return;
        }

        getWhatsAppTranscriptOnDemandEligibility(activeConversation.id)
            .then((res) => {
                if (cancelled) return;
                setTranscriptOnDemandEnabled(!!res?.success && !!res?.enabled);
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("Failed to resolve transcript on-demand eligibility:", err);
                setTranscriptOnDemandEnabled(false);
            });

        return () => {
            cancelled = true;
        };
    }, [activeConversation?.id]);

    // Fetch Messages when active selection changes
    useEffect(() => {
        if (!activeId) return;

        const selectedConversationId = activeId;
        setMessages([]); // Clear previous messages immediately!
        setLoadingMessages(true);
        fetchMessages(selectedConversationId)
            .then(msgs => {
                if (activeIdRef.current !== selectedConversationId) return;
                setMessages(msgs); // Keep chronological order (Oldest -> Newest)
                messageSignatureRef.current = getMessageSignature(msgs);
                void markConversationReadInUi(selectedConversationId);

                // Refresh conversation details (status, suggests, etc)
                refreshConversation(selectedConversationId).then(fresh => {
                    if (activeIdRef.current !== selectedConversationId) return;
                    if (fresh) {
                        setConversations(prev => prev.map(c => c.id === selectedConversationId ? { ...c, ...fresh } : c));
                    }
                });

                // [Background Sync] Smart Sync for selected conversation
                // This answers: "conversation that is highlighted selected get to be synched in the background"
                // It runs silently and stops after finding duplicates.
                if (msgs && msgs.length >= 0) {
                    // We run this without awaiting or loading state
                    syncWhatsAppHistory(selectedConversationId, 20).then(res => {
                        if (res.success && res.count && res.count > 0) {
                            console.log(`[Smart Sync] Found ${res.count} new messages.`);
                            // Refresh quietly
                            fetchMessages(selectedConversationId).then((freshMessages) => {
                                if (activeIdRef.current !== selectedConversationId) return;
                                setMessages(freshMessages);
                                messageSignatureRef.current = getMessageSignature(freshMessages);
                                void markConversationReadInUi(selectedConversationId);
                            });
                        }
                    }).catch(err => console.error("[Smart Sync] Error:", err));
                }
            })
            .catch(err => console.error(err))
            .finally(() => setLoadingMessages(false));
    }, [activeId, markConversationReadInUi]);

    useEffect(() => {
        if (viewMode !== 'chats' || viewFilter !== 'active') return;

        let cancelled = false;

        const runLiveSync = async () => {
            if (liveSyncInFlightRef.current) return;
            liveSyncInFlightRef.current = true;

            try {
                const selectedConversationId = activeIdRef.current;
                const currentList = conversationsRef.current;
                const currentActive = selectedConversationId
                    ? currentList.find((c) => c.id === selectedConversationId)
                    : null;

                const data = await fetchConversations('active', selectedConversationId || undefined);
                if (cancelled) return;

                const incoming = Array.isArray(data?.conversations) ? data.conversations : [];
                if (incoming.length === 0) return;

                setConversations(prev => mergeConversationListsWithIncomingFirst(prev, incoming));

                if (!selectedConversationId) return;

                const incomingActive = incoming.find((c) => c.id === selectedConversationId);
                if (!incomingActive) return;

                const hasActiveConversationChanged =
                    !currentActive ||
                    incomingActive.lastMessageDate !== currentActive.lastMessageDate ||
                    incomingActive.lastMessageBody !== currentActive.lastMessageBody;

                const shouldPollPendingTranscripts = hasPendingTranscripts(messagesRef.current);

                if (!hasActiveConversationChanged && !shouldPollPendingTranscripts) {
                    if ((incomingActive.unreadCount || 0) > 0) {
                        void markConversationReadInUi(selectedConversationId);
                    }
                    return;
                }

                const latestMessages = await fetchMessages(selectedConversationId);
                if (cancelled || activeIdRef.current !== selectedConversationId) return;

                const latestSignature = getMessageSignature(latestMessages);
                if (latestSignature !== messageSignatureRef.current) {
                    messageSignatureRef.current = latestSignature;
                    setMessages(latestMessages);
                }

                if ((incomingActive.unreadCount || 0) > 0) {
                    void markConversationReadInUi(selectedConversationId);
                }
            } catch (err) {
                console.error("Live conversation sync failed:", err);
            } finally {
                liveSyncInFlightRef.current = false;
            }
        };

        runLiveSync();
        const intervalId = setInterval(runLiveSync, 3000);

        return () => {
            cancelled = true;
            clearInterval(intervalId);
        };
    }, [viewMode, viewFilter, mergeConversationListsWithIncomingFirst, markConversationReadInUi]);

    // Handle clicking a conversation in the list
    const handleSelect = (id: string) => {
        setActiveId(id);
    };

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


    const handleSendMessage = async (text: string, type: 'SMS' | 'Email' | 'WhatsApp') => {
        if (!activeConversation) return;

        // Optimistic Update (Optional)
        // For now, we wait for server confirmation to ensure it actually sent via GHL
        const res = await sendReply(activeConversation.id, activeConversation.contactId, text, type);

        if (res.success) {
            // refresh messages
            const newMsgs = await fetchMessages(activeConversation.id);
            setMessages(newMsgs); // Keep chronological order
        } else {
            alert('Failed to send message: ' + JSON.stringify(res.error));
        }
    };

    const handleSendMedia = async (file: File, caption: string) => {
        if (!activeConversation) return;

        try {
            const prep = await createWhatsAppMediaUploadUrl(activeConversation.id, activeConversation.contactId, {
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
                activeConversation.id,
                activeConversation.contactId,
                uploadRef,
                { caption }
            );

            if (sendRes.success) {
                const newMsgs = await fetchMessages(activeConversation.id);
                setMessages(newMsgs);
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

    return (
        <>
            <PanelGroup orientation="horizontal" className="h-full w-full max-w-full overflow-hidden">
                {/* Left: List */}
                <Panel
                    defaultSize={24}
                    minSize={18}
                    className="overflow-hidden min-w-0"
                >
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
                        onSelectDeal={setActiveDealId}
                        onImportClick={() => setImportModalOpen(true)}
                        onBind={handleBindClick}
                        onArchive={viewFilter === 'active' ? handleArchive : undefined}
                        onNewConversationClick={() => setNewConversationOpen(true)}
                        onSyncAllClick={() => setSyncAllOpen(true)}
                    />
                </Panel>

                <PanelResizeHandle
                    className="w-1 bg-gray-200 hover:bg-blue-400 transition-colors z-50 flex flex-col justify-center"
                    style={{ width: '2px', cursor: 'col-resize' }}
                />

                {/* Center: Chat */}
                <Panel defaultSize={52} minSize={36} className="overflow-hidden min-w-0">
                    {viewMode === 'chats' ? (
                        activeConversation ? (
                            <ChatWindow
                                key={activeConversation.id} // Force remount to reset internal state/scroll
                                conversation={activeConversation}
                                messages={messages}
                                loading={loadingMessages}
                                onSendMessage={handleSendMessage}
                                onSendMedia={handleSendMedia}
                                onRefetchMedia={handleRefetchMedia}
                                onRequestTranscript={handleRequestTranscript}
                                onExtractViewingNotes={handleExtractViewingNotes}
                                onRetryTranscript={handleRetryTranscript}
                                onBulkTranscribeUnprocessedAudio={handleBulkTranscribeUnprocessedAudio}
                                transcriptOnDemandEnabled={transcriptOnDemandEnabled}
                                onSync={handleSync}
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
                                        const res = await generateAIDraft(activeConversation.id, activeConversation.contactId, instruction, model);
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
                        // Deal Mode
                        activeDealId ? (
                            <UnifiedTimeline dealId={activeDealId} />
                        ) : (
                            <div className="h-full flex items-center justify-center text-gray-400 bg-slate-50">
                                Select a deal to view timeline
                            </div>
                        )
                    )}
                </Panel>

                <PanelResizeHandle
                    className="w-1 bg-gray-200 hover:bg-blue-400 transition-colors z-50"
                    style={{ width: '1px', cursor: 'col-resize' }}
                />

                {/* Right: AI Coordinator */}
                <Panel defaultSize={24} minSize={20} className="min-w-0">
                    {viewMode === 'chats' ? (
                        activeConversation ? (
                            <CoordinatorPanel
                                locationId={locationId}
                                conversation={activeConversation}
                                selectedConversations={isSelectionMode ? selectedConversations : undefined}
                                onDraftApproved={(text) => handleSendMessage(text, getMessageType(activeConversation))}
                                onDeselect={(id) => handleToggleSelect(id, false)}
                                onSuggestionsGenerated={setSuggestions}
                            />
                        ) : <div className="h-full bg-slate-50" />
                    ) : (
                        // Deal Mode - Coordinator
                        activeDeal && dealProxyConversation ? (
                            <CoordinatorPanel
                                locationId={locationId}
                                conversation={dealProxyConversation}
                                // Mocking selectedConversations to match the deal's participants so it looks like "Context Mode"
                                selectedConversations={conversations.filter(c => activeDeal.conversationIds.includes(c.id))}
                                onDraftApproved={(text) => handleSendMessage(text, 'Email')}
                                onDeselect={() => undefined} // No deselect in deal mode
                                onSuggestionsGenerated={setSuggestions}
                            />
                        ) : (
                            <div className="h-full bg-slate-50 p-4 text-center text-gray-400 text-xs flex flex-col items-center justify-center">
                                Select a deal to view context.
                            </div>
                        )
                    )}
                </Panel>
            </PanelGroup>

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
