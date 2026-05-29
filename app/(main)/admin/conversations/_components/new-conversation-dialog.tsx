'use client';

import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { MessageCirclePlus, Loader2, Phone, Users, Search, CheckCircle2, MessageCircle, ArrowRight, Circle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Clipboard, BadgeAlert, Sparkles, AlertTriangle } from 'lucide-react';
import { AiModelSelect } from '@/components/ai/ai-model-select';
import {
    buildPasteLeadProgressSteps,
    type PasteLeadImportStatus,
} from '@/lib/conversations/paste-lead-status';
import {
    buildGoogleRowOutcomeLabel,
    canStartGoogleContactConversation,
    getGoogleContactDisabledReason,
} from './new-conversation-dialog-helpers';
import { useNewConversationPhone } from './use-new-conversation-phone';
import { useNewConversationWhatsAppPicker } from './use-new-conversation-whatsapp-picker';
import { useNewConversationGoogle } from './use-new-conversation-google';
import { useNewConversationPasteLead } from './use-new-conversation-paste-lead';

interface NewConversationDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConversationCreated?: (conversationId: string) => void;
    locationId?: string; // Needed for Google Import
}

function PasteLeadProgressList({ statuses }: { statuses: PasteLeadImportStatus[] }) {
    const steps = buildPasteLeadProgressSteps(statuses);
    const traceId = [...statuses].reverse().find((status) => status.pasteLeadTraceId)?.pasteLeadTraceId;

    return (
        <div className="rounded-md border bg-slate-50 p-2.5 space-y-1.5">
            {traceId && (
                <div className="truncate border-b border-slate-200 pb-1.5 text-[11px] font-mono text-slate-500">
                    Trace {traceId}
                </div>
            )}
            {steps.map((step) => {
                const Icon = step.state === "completed"
                    ? CheckCircle2
                    : step.state === "failed"
                        ? XCircle
                        : step.state === "running"
                            ? Loader2
                            : Circle;
                return (
                    <div key={step.key} className="flex items-start gap-2 text-xs">
                        <Icon className={cn(
                            "mt-0.5 h-3.5 w-3.5 shrink-0",
                            step.state === "completed" && "text-green-600",
                            step.state === "failed" && "text-red-600",
                            step.state === "running" && "animate-spin text-blue-600",
                            step.state === "pending" && "text-slate-300",
                            step.state === "skipped" && "text-slate-400"
                        )} />
                        <div className="min-w-0">
                            <div className="font-medium text-slate-700">{step.label}</div>
                            {step.detail && (
                                <div className="truncate text-slate-500">{step.detail}</div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export function NewConversationDialog({ open, onOpenChange, onConversationCreated, locationId }: NewConversationDialogProps) {
    const [error, setError] = useState<string | null>(null);

    function handleClose() {
        phone.resetPhone();
        whatsApp.resetWhatsAppPicker();
        google.resetGoogle();
        pasteLead.resetPasteLead();
        setError(null);
        onOpenChange(false);
    }

    const closeAfterStatusSettles = useCallback(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        handleClose();
    }, []);

    const phone = useNewConversationPhone({
        onConversationCreated,
        onClose: handleClose,
        setError,
    });
    const whatsApp = useNewConversationWhatsAppPicker({
        onConversationCreated,
        onClose: handleClose,
        setError,
    });
    const google = useNewConversationGoogle({
        locationId,
        onConversationCreated,
        onClose: handleClose,
        setError,
    });
    const pasteLead = useNewConversationPasteLead({
        open,
        onConversationCreated,
        onCloseAfterStatusSettles: closeAfterStatusSettles,
        setError,
    });

    const { phoneInput, setPhoneInput, startByPhone } = phone;
    const { search, setSearch, loadingChats, chatsLoaded, filteredChats, pickChat } = whatsApp;
    const {
        googleSearch,
        setGoogleSearch,
        googleResults,
        loadingGoogle,
        googleNotConnected,
        googleAuthExpired,
        googleSearched,
        googleRowOutcomes,
        searchGoogle,
        importAndOpenGoogleContact,
    } = google;
    const {
        leadText,
        setLeadText,
        parsedLead,
        setParsedLead,
        isAnalyzing,
        pasteLeadCanImportOldCrmProperties,
        selectedPasteLeadModel,
        selectPasteLeadModel,
        pasteLeadStatuses,
        availableModels,
        handleLeadTextareaPaste,
        reviewLeadFirst,
        importLead,
        confirmParsedLeadImport,
    } = pasteLead;
    const creating = phone.creatingPhone || whatsApp.creatingWhatsApp || google.creatingGoogle || pasteLead.creatingPasteLead;

    // Load chats when "Pick from WhatsApp" tab is activated
    const handleTabChange = async (tab: string) => {
        if (tab === 'pick') {
            await whatsApp.loadChats();
        }
    };

    // Reset state when dialog opens
    useEffect(() => {
        if (open) {
            setError(null);
            whatsApp.resetWhatsAppPicker();
            google.resetGoogle();
        }
    }, [open]);

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
                                        onKeyDown={(e) => e.key === 'Enter' && startByPhone()}
                                        className="flex-1"
                                        disabled={creating}
                                    />
                                    <Button
                                        onClick={startByPhone}
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
                                        onClick={() => pickChat(chat)}
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
                                            <p className="text-xs text-gray-500 truncate">
                                                {chat.phone || (chat.identityPending ? "Phone pending" : "WhatsApp identity pending")}
                                            </p>
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
                                                    await searchGoogle();
                                                }
                                            }}
                                            className="pl-9"
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        disabled={loadingGoogle || !googleSearch.trim()}
                                        onClick={() => searchGoogle()}
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

                                    {!loadingGoogle && googleResults.length === 0 && googleSearch && googleSearched && (
                                        <div className="py-8 text-center text-gray-500 text-sm">
                                            No Google contacts found.
                                        </div>
                                    )}
                                    {!loadingGoogle && googleResults.length === 0 && googleSearch && !googleSearched && (
                                        <div className="py-8 text-center text-gray-500 text-sm">
                                            Searching after you stop typing.
                                        </div>
                                    )}
                                    {!loadingGoogle && googleResults.length === 0 && !googleSearch && (
                                        <div className="py-8 text-center text-gray-500 text-sm">
                                            Search by name, email, or phone.
                                        </div>
                                    )}

                                    {!loadingGoogle && googleResults.map((contact) => {
                                        const rowOutcome = googleRowOutcomes[contact.resourceName];
                                        const rowOutcomeLabel = buildGoogleRowOutcomeLabel(rowOutcome);
                                        const disabledReason = getGoogleContactDisabledReason(contact);
                                        const canStartConversation = canStartGoogleContactConversation(contact);

                                        return (
                                            <div key={contact.resourceName} className="w-full flex items-center justify-between gap-3 p-3 hover:bg-slate-50 transition-colors">
                                                <div className="flex items-center gap-3 overflow-hidden">
                                                    {contact.photo ? (
                                                        <img src={contact.photo} alt={contact.name || 'Google contact'} className="w-9 h-9 rounded-full object-cover shrink-0" />
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
                                                            {!contact.email && !contact.phone && <span>No phone or email</span>}
                                                        </div>
                                                        {rowOutcomeLabel && (
                                                            <div className={cn(
                                                                "mt-1 text-[11px] font-medium",
                                                                rowOutcome?.error ? "text-red-600" : "text-green-700"
                                                            )}>
                                                                {rowOutcomeLabel}
                                                            </div>
                                                        )}
                                                        {!rowOutcomeLabel && disabledReason && (
                                                            <div className="mt-1 text-[11px] text-amber-700">
                                                                {disabledReason}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    disabled={creating || !canStartConversation}
                                                    className="shrink-0 ml-2"
                                                    title={disabledReason || 'Import and open a conversation'}
                                                    onClick={() => importAndOpenGoogleContact(contact.resourceName)}
                                                >
                                                    {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <MessageCircle className="h-4 w-4 mr-2" />}
                                                    Message
                                                </Button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </TabsContent>
                    )}

                    {/* Tab 3: Paste Lead */}
                    <TabsContent value="paste" className="mt-4 space-y-4">
                        {!parsedLead ? (
                            <div className="space-y-3">
                                <div className="space-y-1">
                                    <label className="block text-sm font-medium text-gray-700">AI Model</label>
                                    <AiModelSelect
                                        value={selectedPasteLeadModel}
                                        onValueChange={selectPasteLeadModel}
                                        disabled={isAnalyzing || creating}
                                        models={availableModels}
                                        triggerClassName="w-full"
                                        itemClassName="text-xs"
                                        placeholder="Select model"
                                    />
                                </div>
                                <Textarea
                                    placeholder="Paste lead details here (e.g. from Bazaraki, Facebook, WhatsApp)..."
                                    className="min-h-[150px] font-mono text-sm"
                                    value={leadText}
                                    onChange={(e) => setLeadText(e.target.value)}
                                    onPaste={handleLeadTextareaPaste}
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
                                        onClick={reviewLeadFirst}
                                        disabled={!leadText.trim() || isAnalyzing}
                                        variant="outline"
                                        className="gap-2"
                                    >
                                        {isAnalyzing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                        Review First
                                    </Button>
                                </div>
                                <Button
                                    onClick={importLead}
                                    disabled={!leadText.trim() || isAnalyzing || creating}
                                    className="w-full bg-green-600 hover:bg-green-700 gap-2"
                                >
                                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                                    Import Lead
                                </Button>
                                {(creating || pasteLeadStatuses.length > 0) && (
                                    <PasteLeadProgressList statuses={pasteLeadStatuses} />
                                )}
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
                                        onClick={confirmParsedLeadImport}
                                        disabled={creating}
                                        className="bg-green-600 hover:bg-green-700"
                                    >
                                        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirm & Import"}
                                    </Button>
                                </div>
                                {(creating || pasteLeadStatuses.length > 0) && (
                                    <PasteLeadProgressList statuses={pasteLeadStatuses} />
                                )}
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
