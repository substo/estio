'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { MessageCirclePlus, Loader2, Phone, Users, Search, CheckCircle2, MessageCircle, ArrowRight } from 'lucide-react';
import { fetchEvolutionChats, startNewConversation, parseLeadFromText, createParsedLead, importLeadFromText, getPasteLeadImportCapability, type ParsedLeadData } from '../actions';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Clipboard, BadgeAlert, Sparkles, AlertTriangle } from 'lucide-react';
import { searchGoogleContactsAction, importNewGoogleContactAction } from '@/app/(main)/admin/contacts/actions';
import { useToast } from '@/components/ui/use-toast';


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
    locationId?: string; // Needed for Google Import
}

export function NewConversationDialog({ open, onOpenChange, onConversationCreated, locationId }: NewConversationDialogProps) {
    const { toast } = useToast();
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
    const [pasteLeadCanImportOldCrmProperties, setPasteLeadCanImportOldCrmProperties] = useState(false);

    // Google Contacts State
    const [googleSearch, setGoogleSearch] = useState('');
    const [googleResults, setGoogleResults] = useState<any[]>([]);
    const [loadingGoogle, setLoadingGoogle] = useState(false);
    const [googleNotConnected, setGoogleNotConnected] = useState(false);
    const [googleAuthExpired, setGoogleAuthExpired] = useState(false);
    const leadParseCacheRef = useRef<{
        key: string;
        result: Awaited<ReturnType<typeof parseLeadFromText>> | null;
        promise: Promise<Awaited<ReturnType<typeof parseLeadFromText>>> | null;
    }>({ key: '', result: null, promise: null });

    const requestLeadPreview = useCallback((text: string) => {
        const key = text.trim();
        if (!key || key.length < 5) {
            return Promise.resolve({ success: false as const, error: "Text is too short" });
        }

        const cached = leadParseCacheRef.current;
        if (cached.key === key) {
            if (cached.result) return Promise.resolve(cached.result);
            if (cached.promise) return cached.promise;
        }

        const promise = parseLeadFromText(key)
            .then((res) => {
                if (leadParseCacheRef.current.key === key) {
                    leadParseCacheRef.current.result = res;
                    leadParseCacheRef.current.promise = null;
                }
                return res;
            })
            .catch((error) => {
                if (leadParseCacheRef.current.key === key) {
                    leadParseCacheRef.current.promise = null;
                }
                throw error;
            });

        leadParseCacheRef.current = {
            key,
            result: null,
            promise,
        };

        return promise;
    }, []);

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
        setGoogleSearch('');
        setGoogleResults([]);
        setGoogleNotConnected(false);
        setGoogleAuthExpired(false);
        leadParseCacheRef.current = { key: '', result: null, promise: null };
        onOpenChange(false);
    };

    // Reset state when dialog opens
    useEffect(() => {
        if (open) {
            setChatsLoaded(false);
            setChats([]);
            setError(null);
            setGoogleSearch('');
            setGoogleResults([]);
        }
    }, [open]);

    useEffect(() => {
        if (!open || parsedLead) return;
        const text = leadText.trim();
        if (text.length < 5) return;

        const timer = window.setTimeout(() => {
            void requestLeadPreview(text).catch(() => {});
        }, 250);

        return () => window.clearTimeout(timer);
    }, [open, leadText, parsedLead, requestLeadPreview]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;

        void getPasteLeadImportCapability()
            .then((res) => {
                if (cancelled) return;
                setPasteLeadCanImportOldCrmProperties(Boolean(res.success && res.capability?.canImportOldCrmProperties));
            })
            .catch(() => {
                if (cancelled) return;
                setPasteLeadCanImportOldCrmProperties(false);
            });

        return () => {
            cancelled = true;
        };
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
                        {locationId && (
                            <TabsTrigger value="google" className="flex-1 gap-1.5">
                                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                </svg>
                                Google
                            </TabsTrigger>
                        )}
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

                    {/* Tab 2.5: Pick from Google Contacts */}
                    {locationId && (
                        <TabsContent value="google" className="mt-4">
                            <div className="space-y-3">
                                {googleAuthExpired && (
                                    <div className="flex items-center gap-2 text-red-700 bg-red-50 p-2 rounded text-xs border border-red-200">
                                        <AlertTriangle className="h-4 w-4 shrink-0" />
                                        <span>Your Google connection expired. <a href="/api/google/auth" className="underline font-medium hover:text-red-900">Reconnect</a></span>
                                    </div>
                                )}
                                {googleNotConnected && (
                                    <div className="flex items-center gap-2 text-orange-700 bg-orange-50 p-2 rounded text-xs border border-orange-200">
                                        <AlertTriangle className="h-4 w-4 shrink-0" />
                                        <span>Google Contacts not connected. <a href="/admin/integrations" className="underline font-medium hover:text-orange-900">Connect now</a></span>
                                    </div>
                                )}

                                {/* Search */}
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                        <Input
                                            placeholder="Search Google Contacts..."
                                            value={googleSearch}
                                            onChange={(e) => setGoogleSearch(e.target.value)}
                                            onKeyDown={async (e) => {
                                                if (e.key === 'Enter' && googleSearch.trim()) {
                                                    setLoadingGoogle(true);
                                                    setGoogleNotConnected(false);
                                                    try {
                                                        const res = await searchGoogleContactsAction(googleSearch);
                                                        if (res.success && res.data) {
                                                            setGoogleResults(res.data);
                                                        } else if (res.message === 'GOOGLE_NOT_CONNECTED') {
                                                            setGoogleNotConnected(true);
                                                        } else if (res.message === 'GOOGLE_AUTH_EXPIRED') {
                                                            setGoogleAuthExpired(true);
                                                        }
                                                    } finally {
                                                        setLoadingGoogle(false);
                                                    }
                                                }
                                            }}
                                            className="pl-9"
                                            disabled={loadingGoogle}
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        disabled={loadingGoogle || !googleSearch.trim()}
                                        onClick={async () => {
                                            setLoadingGoogle(true);
                                            setGoogleNotConnected(false);
                                            try {
                                                const res = await searchGoogleContactsAction(googleSearch);
                                                if (res.success && res.data) {
                                                    setGoogleResults(res.data);
                                                } else if (res.message === 'GOOGLE_NOT_CONNECTED') {
                                                    setGoogleNotConnected(true);
                                                } else if (res.message === 'GOOGLE_AUTH_EXPIRED') {
                                                    setGoogleAuthExpired(true);
                                                }
                                            } finally {
                                                setLoadingGoogle(false);
                                            }
                                        }}
                                    >
                                        <Search className="h-4 w-4" />
                                    </Button>
                                </div>

                                {/* Results List */}
                                <div className="max-h-[320px] overflow-y-auto border rounded-lg divide-y">
                                    {loadingGoogle && (
                                        <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
                                            <Loader2 className="w-5 h-5 animate-spin" />
                                            <span className="text-sm">Searching Google...</span>
                                        </div>
                                    )}

                                    {!loadingGoogle && googleResults.length === 0 && googleSearch && (
                                        <div className="py-8 text-center text-gray-500 text-sm">
                                            Press enter to search. No results found yet.
                                        </div>
                                    )}
                                    {!loadingGoogle && googleResults.length === 0 && !googleSearch && (
                                        <div className="py-8 text-center text-gray-500 text-sm">
                                            Search by name, email, or phone.
                                        </div>
                                    )}

                                    {!loadingGoogle && googleResults.map((contact) => (
                                        <div key={contact.resourceName} className="w-full flex items-center justify-between p-3 hover:bg-slate-50 transition-colors">
                                            <div className="flex items-center gap-3 overflow-hidden">
                                                {contact.photo ? (
                                                    <img src={contact.photo} alt={contact.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                                                ) : (
                                                    <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                                                        <span className="text-slate-500 font-medium text-xs">{contact.name?.charAt(0) || '?'}</span>
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium truncate">{contact.name || 'Unnamed'}</p>
                                                    <div className="text-xs text-muted-foreground truncate flex gap-2">
                                                        {contact.email && <span>{contact.email}</span>}
                                                        {contact.phone && <span>{contact.phone}</span>}
                                                    </div>
                                                </div>
                                            </div>

                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                disabled={creating || !contact.phone}
                                                className="shrink-0 ml-2"
                                                onClick={async () => {
                                                    setCreating(true);
                                                    setError(null);
                                                    try {
                                                        const res = await importNewGoogleContactAction(contact.resourceName, locationId!);
                                                        if (res.success && res.contactId) {
                                                            // We successfully imported, now start conversation
                                                            // We know they have a phone number since button is disabled without it
                                                            const startRes = await startNewConversation(contact.phone);
                                                            if (startRes.success && startRes.conversationId) {
                                                                toast({ title: "Imported & Messaging", description: "Contact created successfully." });
                                                                onConversationCreated?.(startRes.conversationId);
                                                                handleClose();
                                                            } else {
                                                                toast({ title: "Imported, but chat failed", description: startRes.error, variant: "destructive" });
                                                                // You could redirect to contact view here, but we are inside a dialog. Let's just close it.
                                                                handleClose();
                                                            }
                                                        } else {
                                                            setError(res.message || 'Failed to import Google contact');
                                                        }
                                                    } catch (err: any) {
                                                        setError(err.message);
                                                    } finally {
                                                        setCreating(false);
                                                    }
                                                }}
                                            >
                                                {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MessageCircle className="h-4 w-4 mr-2" />}
                                                Message
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </TabsContent>
                    )}

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
                                    <span>
                                        AI will extract contact & requirements
                                        {pasteLeadCanImportOldCrmProperties
                                            ? " and queue Downtown Cyprus property import in background"
                                            : ""}
                                    </span>
                                    <Button
                                        size="sm"
                                        onClick={async () => {
                                            if (!leadText.trim()) return;
                                            setIsAnalyzing(true);
                                            setError(null);
                                            const res = await requestLeadPreview(leadText);
                                            setIsAnalyzing(false);
                                            if (res.success && res.data) {
                                                setParsedLead(res.data);
                                            } else {
                                                setError(res.error || "Failed to parse text");
                                            }
                                        }}
                                        disabled={!leadText.trim() || isAnalyzing}
                                        variant="outline"
                                        className="gap-2"
                                    >
                                        {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                        Review First
                                    </Button>
                                </div>
                                <Button
                                    onClick={async () => {
                                        if (!leadText.trim()) return;
                                        setCreating(true);
                                        setError(null);
                                        try {
                                            const res = await importLeadFromText(leadText);
                                            if (res.success && res.conversationId) {
                                                toast({
                                                    title: "Lead imported",
                                                    description: res.backgroundJobsQueued?.length
                                                        ? "Lead imported, enriching in background."
                                                        : "Conversation is ready.",
                                                });
                                                onConversationCreated?.(res.conversationId);
                                                handleClose();
                                            } else {
                                                setError(res.error || "Failed to import lead");
                                            }
                                        } catch (err: any) {
                                            setError(err.message);
                                        } finally {
                                            setCreating(false);
                                        }
                                    }}
                                    disabled={!leadText.trim() || isAnalyzing || creating}
                                    className="w-full bg-green-600 hover:bg-green-700 gap-2"
                                >
                                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                                    Import Lead
                                </Button>
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
                                                const res = await createParsedLead(parsedLead, leadText);
                                                if (res.success && res.conversationId) {
                                                    toast({
                                                        title: "Lead imported",
                                                        description: res.backgroundJobsQueued?.length
                                                            ? "Lead imported, enriching in background."
                                                            : "Conversation is ready.",
                                                    });
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
