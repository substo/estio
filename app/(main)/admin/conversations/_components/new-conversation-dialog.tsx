'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { MessageCirclePlus, Loader2, Phone, Users, Search, CheckCircle2, MessageCircle, ArrowRight } from 'lucide-react';
import { fetchEvolutionChats, startNewConversation } from '../actions';
import { cn } from '@/lib/utils';

interface EvolutionChat {
    jid: string;
    phone: string;
    name: string;
    isGroup: boolean;
    alreadySynced: boolean;
    lastMessageTimestamp: number | null;
}

interface NewConversationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConversationCreated?: (conversationId: string) => void;
}

export function NewConversationDialog({ open, onOpenChange, onConversationCreated }: NewConversationDialogProps) {
    const [phoneInput, setPhoneInput] = useState('');
    const [search, setSearch] = useState('');
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Chat picker state
    const [chats, setChats] = useState<EvolutionChat[]>([]);
    const [loadingChats, setLoadingChats] = useState(false);
    const [chatsLoaded, setChatsLoaded] = useState(false);

    // Load chats when "Pick from WhatsApp" tab is activated
    const handleTabChange = async (tab: string) => {
        if (tab === 'pick' && !chatsLoaded) {
            setLoadingChats(true);
            try {
                const res = await fetchEvolutionChats();
                if (res.success && res.chats) {
                    setChats(res.chats);
                } else {
                    setError(res.error || 'Failed to load chats');
                }
                setChatsLoaded(true);
            } catch (err: any) {
                setError(err.message);
            } finally {
                setLoadingChats(false);
            }
        }
    };

    // Start a new conversation by phone number
    const handleStartByPhone = async () => {
        if (!phoneInput.trim()) return;

        setCreating(true);
        setError(null);

        try {
            const res = await startNewConversation(phoneInput.trim());
            if (res.success && res.conversationId) {
                onConversationCreated?.(res.conversationId);
                handleClose();
            } else {
                setError(res.error || 'Failed to create conversation');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setCreating(false);
        }
    };

    // Start a conversation from a picked chat
    const handlePickChat = async (chat: EvolutionChat) => {
        setCreating(true);
        setError(null);

        try {
            const phoneNumber = chat.phone.startsWith('+') ? chat.phone : `+${chat.phone}`;
            const res = await startNewConversation(phoneNumber);
            if (res.success && res.conversationId) {
                onConversationCreated?.(res.conversationId);
                handleClose();
            } else {
                setError(res.error || 'Failed to create conversation');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setCreating(false);
        }
    };

    const handleClose = () => {
        setPhoneInput('');
        setSearch('');
        setError(null);
        setCreating(false);
        onOpenChange(false);
    };

    // Reset state when dialog opens
    useEffect(() => {
        if (open) {
            setChatsLoaded(false);
            setChats([]);
            setError(null);
        }
    }, [open]);

    // Filter chats by search
    const filteredChats = chats.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.phone.includes(search)
    );

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <MessageCirclePlus className="w-5 h-5 text-green-600" />
                        New Conversation
                    </DialogTitle>
                    <DialogDescription>
                        Start a new WhatsApp conversation by entering a phone number or picking an existing chat.
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="phone" onValueChange={handleTabChange}>
                    <TabsList className="w-full">
                        <TabsTrigger value="phone" className="flex-1 gap-1.5">
                            <Phone className="w-3.5 h-3.5" /> Enter Phone
                        </TabsTrigger>
                        <TabsTrigger value="pick" className="flex-1 gap-1.5">
                            <Users className="w-3.5 h-3.5" /> Pick from WhatsApp
                        </TabsTrigger>
                    </TabsList>

                    {/* Tab 1: Enter Phone Number */}
                    <TabsContent value="phone" className="mt-4">
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm font-medium text-gray-700 mb-1.5 block">Phone Number</label>
                                <div className="flex gap-2">
                                    <Input
                                        placeholder="+357 99 045 511"
                                        value={phoneInput}
                                        onChange={(e) => setPhoneInput(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleStartByPhone()}
                                        className="flex-1"
                                        disabled={creating}
                                    />
                                    <Button
                                        onClick={handleStartByPhone}
                                        disabled={!phoneInput.trim() || creating}
                                        className="bg-green-600 hover:bg-green-700 shrink-0"
                                    >
                                        {creating ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <>Start Chat <ArrowRight className="w-4 h-4 ml-1" /></>
                                        )}
                                    </Button>
                                </div>
                                <p className="text-xs text-gray-500 mt-1.5">
                                    Include country code (e.g., +357 for Cyprus, +44 for UK)
                                </p>
                            </div>
                        </div>
                    </TabsContent>

                    {/* Tab 2: Pick from WhatsApp */}
                    <TabsContent value="pick" className="mt-4">
                        <div className="space-y-3">
                            {/* Search */}
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <Input
                                    placeholder="Search by name or phone..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="pl-9"
                                    disabled={loadingChats}
                                />
                            </div>

                            {/* Chat List */}
                            <div className="max-h-[320px] overflow-y-auto border rounded-lg divide-y">
                                {loadingChats && (
                                    <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        <span className="text-sm">Loading chats from WhatsApp...</span>
                                    </div>
                                )}

                                {!loadingChats && filteredChats.length === 0 && chatsLoaded && (
                                    <div className="py-8 text-center text-gray-500 text-sm">
                                        {search ? 'No chats match your search' : 'No WhatsApp chats found'}
                                    </div>
                                )}

                                {!loadingChats && filteredChats.map((chat) => (
                                    <button
                                        key={chat.jid}
                                        className={cn(
                                            "w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50 transition-colors",
                                            creating && "opacity-50 pointer-events-none"
                                        )}
                                        onClick={() => handlePickChat(chat)}
                                        disabled={creating}
                                    >
                                        {/* Avatar */}
                                        <div className={cn(
                                            "w-9 h-9 rounded-full flex items-center justify-center shrink-0",
                                            chat.isGroup ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"
                                        )}>
                                            {chat.isGroup ? (
                                                <Users className="w-4 h-4" />
                                            ) : (
                                                <MessageCircle className="w-4 h-4" />
                                            )}
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-medium truncate">{chat.name}</p>
                                                {chat.alreadySynced && (
                                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                                                        <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                                                        Synced
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-xs text-gray-500 truncate">{chat.phone}</p>
                                        </div>

                                        {/* Action */}
                                        <ArrowRight className="w-4 h-4 text-gray-400 shrink-0" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </TabsContent>
                </Tabs>

                {/* Error Display */}
                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
                        {error}
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={creating}>
                        Cancel
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
