'use client';

import { useState, useEffect } from 'react';
import { Conversation, Message } from '@/lib/ghl/conversations';
import { fetchMessages, sendReply, generateAIDraft, deleteConversations, syncWhatsAppHistory, refreshConversation } from '../actions';
import { toast } from '@/components/ui/use-toast';
import { getDealContexts } from '../../deals/actions';
import { UnifiedTimeline } from './unified-timeline';
import { ConversationList } from './conversation-list';
import { ChatWindow } from './chat-window';
import { CoordinatorPanel } from './coordinator-panel';
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
    const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
    // Primary selection (what shows in the chat window)
    const [activeId, setActiveId] = useState<string | null>(initialConversations.length > 0 ? initialConversations[0].id : null);

    // Deal Mode State
    const [viewMode, setViewMode] = useState<'chats' | 'deals'>('chats');
    const [deals, setDeals] = useState<any[]>([]);
    const [activeDealId, setActiveDealId] = useState<string | null>(null);

    // Fetch Deals when switching mode
    useEffect(() => {
        if (viewMode === 'deals' && deals.length === 0) {
            getDealContexts().then(setDeals).catch(console.error);
        }
    }, [viewMode]);

    // Multi-selection (what shows in the Context Builder)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isSelectionMode, setIsSelectionMode] = useState(false);

    const [messages, setMessages] = useState<Message[]>([]);
    const [loadingMessages, setLoadingMessages] = useState(false);

    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [idsToDelete, setIdsToDelete] = useState<string[]>([]);

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
        setIdsToDelete(ids);
        setDeleteDialogOpen(true);
    };

    const executeDelete = async () => {
        const ids = idsToDelete;
        if (ids.length === 0) return;

        try {
            const res = await deleteConversations(ids);
            if (res.success) {
                toast({ title: "Deleted", description: `Successfully deleted ${res.count} conversations.` });

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
            setDeleteDialogOpen(false);
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
                        deals={deals}
                        onSelectDeal={setActiveDealId}
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
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete {idsToDelete.length} conversation{idsToDelete.length > 1 ? 's' : ''} and remove the data from our servers.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={executeDelete} className="bg-red-600 hover:bg-red-700">
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

