'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { MessageCirclePlus, Loader2, Phone, Users, Search, CheckCircle2, MessageCircle, ArrowRight } from 'lucide-react';
import { fetchEvolutionChats, startNewConversation, parseLeadFromText, createParsedLead, type ParsedLeadData, type LeadAnalysisTrace } from '../actions';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Clipboard, BadgeAlert, Sparkles, AlertTriangle } from 'lucide-react';


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

    // Paste Lead State
    const [leadText, setLeadText] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [parsedLead, setParsedLead] = useState<ParsedLeadData | null>(null);
    const [analysisTrace, setAnalysisTrace] = useState<LeadAnalysisTrace | undefined>(undefined);

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
        setLeadText('');

        setParsedLead(null);
        setAnalysisTrace(undefined);
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
            <DialogContent className={cn("sm:max-w-lg transition-all duration-300",
                parsedLead ? "sm:max-w-2xl" : "sm:max-w-lg"
            )}>
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
                            <Phone className="w-3.5 h-3.5" /> Phone
                        </TabsTrigger>
                        <TabsTrigger value="pick" className="flex-1 gap-1.5">
                            <Users className="w-3.5 h-3.5" /> WhatsApp
                        </TabsTrigger>
                        <TabsTrigger value="paste" className="flex-1 gap-1.5">
                            <Clipboard className="w-3.5 h-3.5" /> Paste Lead
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

                    {/* Tab 3: Paste Lead */}
                    <TabsContent value="paste" className="mt-4 space-y-4">
                        {!parsedLead ? (
                            <div className="space-y-3">
                                <Textarea
                                    placeholder="Paste lead details here (e.g. from Bazaraki, Facebook, WhatsApp)..."
                                    className="min-h-[150px] font-mono text-sm"
                                    value={leadText}
                                    onChange={(e) => setLeadText(e.target.value)}
                                    disabled={isAnalyzing}
                                />
                                <div className="flex justify-between items-center text-xs text-gray-500 px-1">
                                    <span>AI will extract contact & requirements</span>
                                    <Button
                                        size="sm"
                                        onClick={async () => {
                                            if (!leadText.trim()) return;
                                            setIsAnalyzing(true);
                                            setError(null);
                                            const res = await parseLeadFromText(leadText);
                                            setIsAnalyzing(false);
                                            if (res.success && res.data) {
                                                setParsedLead(res.data);
                                                setAnalysisTrace(res.trace);
                                            } else {
                                                setError(res.error || "Failed to parse text");
                                            }
                                        }}
                                        disabled={!leadText.trim() || isAnalyzing}
                                        className="gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white border-0"
                                    >
                                        {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                        Analyze Text
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                <div className="grid grid-cols-2 gap-3">
                                    <Card className="p-3 bg-slate-50 space-y-1">
                                        <div className="text-xs font-medium text-gray-500 uppercase">Contact</div>
                                        <div className="font-medium text-sm">{parsedLead.contact?.name || "Unknown Name"}</div>
                                        <div className="text-sm">{parsedLead.contact?.phone || "No Phone"}</div>
                                        <div className="text-xs text-gray-500">{parsedLead.contact?.email}</div>
                                    </Card>
                                    <Card className="p-3 bg-slate-50 space-y-1">
                                        <div className="text-xs font-medium text-gray-500 uppercase">Requirements</div>
                                        <div className="text-sm font-medium">{parsedLead.requirements?.type || "Any Type"}</div>
                                        <div className="text-xs">{parsedLead.requirements?.location}</div>
                                        <div className="text-xs">{parsedLead.requirements?.budget ? `Budget: ${parsedLead.requirements.budget}` : ''}</div>
                                    </Card>
                                </div>

                                {/* Message vs Notes Distinction */}
                                {parsedLead.messageContent ? (
                                    <div className="bg-indigo-50 border border-indigo-100 rounded-md p-3">
                                        <div className="flex items-center gap-2 mb-1">
                                            <MessageCircle className="w-3.5 h-3.5 text-indigo-600" />
                                            <span className="text-xs font-semibold text-indigo-900">Inbound Message (Will Trigger AI)</span>
                                        </div>
                                        <p className="text-sm text-indigo-800 italic">"{parsedLead.messageContent}"</p>
                                    </div>
                                ) : (
                                    <div className="bg-amber-50 border border-amber-100 rounded-md p-3">
                                        <div className="flex items-center gap-2 mb-1">
                                            <BadgeAlert className="w-3.5 h-3.5 text-amber-600" />
                                            <span className="text-xs font-semibold text-amber-900">Internal Notes Only (No Auto-Reply)</span>
                                        </div>
                                        <p className="text-sm text-amber-800">{parsedLead.internalNotes || "No notes extracted"}</p>
                                    </div>
                                )}

                                {(parsedLead.contact?.phone === undefined || parsedLead.contact?.phone === null) && (
                                    <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 p-2 rounded">
                                        <AlertTriangle className="w-3 h-3" />
                                        Warning: No phone number detected. Contact creation may fail if required.
                                    </div>
                                )}

                                <div className="flex gap-2 justify-end pt-2">
                                    <Button variant="ghost" size="sm" onClick={() => setParsedLead(null)}>Back to Edit</Button>
                                    <Button
                                        size="sm"
                                        onClick={async () => {
                                            setCreating(true);

                                            try {
                                                const res = await createParsedLead(parsedLead, leadText, analysisTrace);
                                                if (res.success && res.conversationId) {
                                                    onConversationCreated?.(res.conversationId);
                                                    handleClose();
                                                } else {
                                                    setError(res.error || "Failed to create conversation");
                                                }
                                            } catch (err: any) {
                                                setError(err.message);
                                            } finally {
                                                setCreating(false);
                                            }
                                        }}
                                        disabled={creating}
                                        className="bg-green-600 hover:bg-green-700"
                                    >
                                        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirm & Import"}
                                    </Button>
                                </div>
                            </div>
                        )}
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
