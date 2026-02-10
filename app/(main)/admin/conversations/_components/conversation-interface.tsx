'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Conversation, Message } from '@/lib/ghl/conversations';
import { fetchConversations, fetchMessages, sendReply, generateAIDraft, deleteConversations, restoreConversations, archiveConversations, unarchiveConversations, permanentlyDeleteConversations, syncWhatsAppHistory, refreshConversation } from '../actions';
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
    initialConversations: Conversation[];
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

export function ConversationInterface({ initialConversations }: ConversationInterfaceProps) {
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
    const initialViewFilter = (searchParams.get('view') as 'active' | 'archived' | 'trash') || 'active';
    // Map URL 'inbox' to internal 'active' if needed, but 'active' is the internal string. 
    // Let's support 'inbox' in URL for user friendliness
    const urlView = searchParams.get('view');
    const normalizedViewFilter = (urlView === 'inbox' ? 'active' : urlView) as 'active' | 'archived' | 'trash' || 'active';

    const [conversations, setConversations] = useState<Conversation[]>(initialConversations);

    // Initialize Active ID from URL
    const initialActiveId = searchParams.get('id') || (initialConversations.length > 0 ? initialConversations[0].id : null);
    const [activeId, setActiveId] = useState<string | null>(initialActiveId);

    // View Mode State (inbox, archived, trash)
    const [viewFilter, setViewFilter] = useState<'active' | 'archived' | 'trash'>(normalizedViewFilter);

    // Deal Mode State
    const initialViewMode = (searchParams.get('mode') as 'chats' | 'deals') || 'chats';
    const [viewMode, setViewMode] = useState<'chats' | 'deals'>(initialViewMode);

    const [deals, setDeals] = useState<any[]>([]);

    const initialDealId = searchParams.get('dealId');
    const [activeDealId, setActiveDealId] = useState<string | null>(initialDealId);

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

    // Fetch Conversations when View Filter changes
    useEffect(() => {
        fetchConversations(viewFilter)
            .then(data => {
                setConversations(data.conversations);

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
    }, [viewFilter]);

    const [messages, setMessages] = useState<Message[]>([]);
    const [loadingMessages, setLoadingMessages] = useState(false);

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

    // Fetch Messages when active selection changes
    useEffect(() => {
        if (!activeId) return;

        setMessages([]); // Clear previous messages immediately!
        setLoadingMessages(true);
        fetchMessages(activeId)
            .then(msgs => {
                setMessages(msgs); // Keep chronological order (Oldest -> Newest)

                // Refresh conversation details (status, suggests, etc)
                refreshConversation(activeId).then(fresh => {
                    if (fresh) {
                        setConversations(prev => prev.map(c => c.id === activeId ? { ...c, ...fresh } : c));
                    }
                });

                // [Background Sync] Smart Sync for selected conversation
                // This answers: "conversation that is highlighted selected get to be synched in the background"
                // It runs silently and stops after finding duplicates.
                if (msgs && msgs.length >= 0) {
                    // We run this without awaiting or loading state
                    syncWhatsAppHistory(activeId, 20).then(res => {
                        if (res.success && res.count && res.count > 0) {
                            console.log(`[Smart Sync] Found ${res.count} new messages.`);
                            // Refresh quietly
                            fetchMessages(activeId).then(setMessages);
                        }
                    }).catch(err => console.error("[Smart Sync] Error:", err));
                }
            })
            .catch(err => console.error(err))
            .finally(() => setLoadingMessages(false));
    }, [activeId]);

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


    const handleSync = async () => {
        if (!activeId) return;
        // Don't clear messages, just show loading overlay if supported or just toast
        // We set loadingMessages to true which shows spinner, consistent with initial load
        setLoadingMessages(true);
        try {
            toast({ title: "Syncing WhatsApp...", description: "Checking for missed messages." });
            const res = await syncWhatsAppHistory(activeId);

            if (res.success) {
                const count = res.count || 0;
                if (count > 0) {
                    toast({ title: "Sync Complete", description: `Recovered ${count} messages.` });
                    // Re-fetch to display them
                    const msgs = await fetchMessages(activeId);
                    setMessages(msgs);
                } else {
                    toast({ title: "Up to date", description: "No new messages found." });
                    // Optional: Re-fetch anyway just in case DB had updates from elsewhere?
                    // But usually not needed if count is 0. 
                    // However, to be safe and clear loading state correctly:
                    const msgs = await fetchMessages(activeId);
                    setMessages(msgs);
                }
            } else {
                toast({ title: "Sync Failed", description: String(res.error), variant: "destructive" });
                // Re-fetch to reset loading state and show what we have
                const msgs = await fetchMessages(activeId);
                setMessages(msgs);
            }
        } catch (e) {
            console.error("Sync error:", e);
            toast({ title: "Sync Error", description: "An unexpected error occurred.", variant: "destructive" });
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
                    defaultSize={25}
                    minSize={25}
                    className="border-r"
                >
                    <ConversationList
                        conversations={conversations}
                        selectedId={viewMode === 'chats' ? activeId : activeDealId}
                        onSelect={handleSelect}

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
                <Panel defaultSize={60} minSize={30} className="overflow-hidden">
                    {viewMode === 'chats' ? (
                        activeConversation ? (
                            <ChatWindow
                                key={activeConversation.id} // Force remount to reset internal state/scroll
                                conversation={activeConversation}
                                messages={messages}
                                loading={loadingMessages}
                                onSendMessage={handleSendMessage}
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
                <Panel defaultSize={25} minSize={25}>
                    {viewMode === 'chats' ? (
                        activeConversation ? (
                            <CoordinatorPanel
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
                    const data = await fetchConversations(viewFilter);
                    setConversations(data.conversations);
                }}
            />

            {/* New Conversation Dialog */}
            <NewConversationDialog
                open={newConversationOpen}
                onOpenChange={setNewConversationOpen}
                onConversationCreated={async (conversationId) => {
                    // Refresh conversations list
                    const data = await fetchConversations(viewFilter);
                    setConversations(data.conversations);
                    // Select the new conversation
                    setActiveId(conversationId);
                    toast({ title: "Conversation Created", description: "You can now send messages." });
                }}
            />
        </>
    );
}

