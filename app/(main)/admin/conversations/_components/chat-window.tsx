import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Conversation, Message } from "@/lib/ghl/conversations";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MessageSquare, RefreshCw, FileText, Trash2, Search, AudioLines, NotebookPen, ArrowLeft, ListTodo, MoreHorizontal, Wand2, Languages } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ActivityLogEntry } from "./activity-log-entry";
import { SuggestedResponseQueue, type SuggestedResponseQueueItem } from "./suggested-response-queue";
import { getReplyLanguageLabel } from "@/lib/ai/reply-language-options";
import { useChatWindowTimelineScroll, type ActivityLogItem } from "./use-chat-window-timeline-scroll";
import { useChatWindowTranscriptSearch } from "./use-chat-window-transcript-search";
import { useChatWindowSelectionBatch } from "./use-chat-window-selection-batch";

interface ChatWindowProps {
    conversation: Conversation;
    messages: Message[];
    activityLog?: ActivityLogItem[];
    loading: boolean;
    onInitialPaintReady?: () => void;
    onBack?: () => void;
    onOpenMissionControl?: () => void;
    onSendMessage: (
        text: string,
        type: 'SMS' | 'Email' | 'WhatsApp',
        options?: {
            translationSourceText?: string | null;
            translationTargetLanguage?: string | null;
            translationDetectedSourceLanguage?: string | null;
        }
    ) => void | Promise<void>;
    onSendMedia?: (file: File, caption: string) => void | Promise<void>;
    onRefetchMedia?: (messageId: string) => void | Promise<void>;
    onRequestTranscript?: (
        messageId: string,
        attachmentId: string,
        options?: { force?: boolean }
    ) => void | Promise<void>;
    onExtractViewingNotes?: (
        messageId: string,
        attachmentId: string,
        options?: { force?: boolean }
    ) => void | Promise<void>;
    onRetryTranscript?: (messageId: string, attachmentId: string) => void | Promise<void>;
    onBulkTranscribeUnprocessedAudio?: (options?: { window?: "30d" | "all" }) => void | Promise<void>;
    transcriptOnDemandEnabled?: boolean;
    onSync?: () => void;
    onFetchHistory?: () => void;
    onGenerateDraft?: (
        instruction?: string,
        model?: string,
        draftLanguage?: string | null,
        onChunk?: (chunk: string) => void
    ) => Promise<string | null>;
    onSetReplyLanguageOverride?: (replyLanguage: string | null) => Promise<{ success: boolean; error?: string; replyLanguageOverride?: string | null }>;
    onTranslateMessage?: (messageId: string, targetLanguage?: string | null) => Promise<{
        success: boolean;
        error?: string;
        messageId?: string;
        translation?: {
            targetLanguage: string;
            sourceLanguage?: string | null;
            sourceText: string;
            translatedText: string;
            status: "completed" | "failed";
            provider?: string | null;
            model?: string | null;
            updatedAt?: string | null;
        } | null;
    }>;
    onTranslateVisibleThread?: (visibleMessageIds: string[], targetLanguage?: string | null) => Promise<{
        success: boolean;
        error?: string;
        translatedCount?: number;
        failedCount?: number;
    }>;
    onPreviewTranslatedReply?: (
        sourceText: string,
        channel: "SMS" | "Email" | "WhatsApp",
        targetLanguage?: string | null
    ) => Promise<{
        success: boolean;
        error?: string;
        targetLanguage?: string;
        sourceText?: string;
        translatedText?: string;
        detectedSourceLanguage?: string | null;
    }>;
    translationReadEnabled?: boolean;
    translationWriteEnabled?: boolean;
    translationBannerEnabled?: boolean;
    onAddActivityEntry?: (entryText: string, dateIso: string) => Promise<void>;
    suggestedResponseQueue?: SuggestedResponseQueueItem[];
    suggestedResponseQueueLoading?: boolean;
    onAcceptSuggestedResponse?: (id: string, mode: "insertOnly" | "sendNow") => Promise<void>;
    onRejectSuggestedResponse?: (id: string, reason?: string | null) => Promise<void>;
    composerDraft: string;
    onComposerDraftChange: (draft: string) => void;
    onComposerDraftClear: () => void;
    composerInsertSeed?: { key: string; body: string } | null;
    onResendMessage?: (messageId: string) => void | Promise<void>;
    smsRelayEnabled?: boolean;
}

/**
 * Map GHL type codes to friendly channel names
 */
function getChannelName(type: string): string {
    const typeUpper = type?.toUpperCase() || '';
    if (typeUpper.includes('EMAIL')) return 'Email';
    if (typeUpper.includes('WHATSAPP')) return 'WhatsApp';
    if (typeUpper.includes('PHONE') || typeUpper.includes('SMS') || typeUpper.includes('CALL')) return 'SMS';
    if (typeUpper.includes('WEBCHAT') || typeUpper.includes('LIVE')) return 'Live Chat';
    return type || 'Unknown';
}

import { MessageBubble } from "./message-bubble";

import { improveInternalNoteText } from "@/app/(main)/admin/conversations/actions";
import { ConversationComposer } from "./conversation-composer";
import {
    buildMessageTranslationState,
    getBrowserLanguage,
    isLikelyForeignLanguageMessage,
    getResolvedConversationTranslationLanguage,
} from "@/lib/conversations/translation-view";

const TRANSCRIPT_SEARCH_KEYWORDS = [
    "budget",
    "requirements",
    "location",
    "viewing",
    "objection",
    "next action",
    "bedroom",
    "villa",
];

function getThreadTranslationPreferenceKey(conversationId: string, targetLanguage: string) {
    return `conversation-thread-translation:${conversationId}:${targetLanguage.toLowerCase()}`;
}

export function ChatWindow({
    conversation,
    messages,
    activityLog = [],
    loading,
    onInitialPaintReady,
    onBack,
    onOpenMissionControl,
    onSendMessage,
    onSendMedia,
    onRefetchMedia,
    onRequestTranscript,
    onExtractViewingNotes,
    onRetryTranscript,
    onBulkTranscribeUnprocessedAudio,
    transcriptOnDemandEnabled,
    onSync,
    onGenerateDraft,
    onSetReplyLanguageOverride,
    onTranslateMessage,
    onTranslateVisibleThread,
    onPreviewTranslatedReply,
    translationReadEnabled = false,
    translationWriteEnabled = false,
    translationBannerEnabled = false,
    onFetchHistory,
    onAddActivityEntry,
    suggestedResponseQueue = [],
    suggestedResponseQueueLoading = false,
    onAcceptSuggestedResponse,
    onRejectSuggestedResponse,
    composerDraft,
    onComposerDraftChange,
    onComposerDraftClear,
    composerInsertSeed,
    suggestions = [],
    onResendMessage,
    smsRelayEnabled,
}: ChatWindowProps & { suggestions?: string[] }) {
    const {
        scrollRef,
        timelineContentRef,
        timelineItems,
        isTimelineReady,
        getEnableMountAnimation,
    } = useChatWindowTimelineScroll({
        conversationId: conversation.id,
        messages,
        activityLog,
        loading,
        onInitialPaintReady,
    });
    const [selectedModel, setSelectedModel] = useState("");
    const {
        selectionBatch,
        isSummarizingBatch,
        handleAddSelectionToBatch,
        handleRemoveSelectionBatchItem,
        handleClearSelectionBatch,
        handleSummarizeBatch,
    } = useChatWindowSelectionBatch({
        conversationId: conversation.id,
        selectedModel,
    });
    const [bulkTranscriptWindow, setBulkTranscriptWindow] = useState<"30d" | "all">("30d");
    const [isBulkTranscribingAudio, setIsBulkTranscribingAudio] = useState(false);
    const {
        showTranscriptSearch,
        setShowTranscriptSearch,
        transcriptSearchQuery,
        setTranscriptSearchQuery,
        isTranscriptSearching,
        transcriptSearchError,
        transcriptSearchTotal,
        transcriptSearchResults,
        highlightedMessageId,
        messageRefs,
        jumpToMessage,
        handleTranscriptSearch,
    } = useChatWindowTranscriptSearch({ conversationId: conversation.id });
    const canUseTranscriptOnDemand = transcriptOnDemandEnabled !== false;
    const [addNoteOpen, setAddNoteOpen] = useState(false);
    const [addNoteText, setAddNoteText] = useState("");
    const [addNoteDate, setAddNoteDate] = useState(new Date().toISOString().slice(0, 16));
    const [addingNote, setAddingNote] = useState(false);
    const [improvingNote, setImprovingNote] = useState(false);
    const [translatingVisibleThread, setTranslatingVisibleThread] = useState(false);
    const [translationBannerDismissed, setTranslationBannerDismissed] = useState(false);
    const [threadTranslationMode, setThreadTranslationMode] = useState<"original" | "translated">("original");
    const [autoTranslatingThread, setAutoTranslatingThread] = useState(false);
    const autoTranslationAttemptedRef = useRef<string | null>(null);

    const handleAddNote = async () => {
        if (!addNoteText.trim() || !onAddActivityEntry) return;
        setAddingNote(true);
        try {
            await onAddActivityEntry(addNoteText.trim(), new Date(addNoteDate).toISOString());
            setAddNoteText("");
            setAddNoteDate(new Date().toISOString().slice(0, 16));
            setAddNoteOpen(false);
            toast.success("Note added to activity log");
        } catch (e: any) {
            toast.error(e?.message || "Failed to add note");
        } finally {
            setAddingNote(false);
        }
    };

    const handleImproveNote = async () => {
        const sourceText = addNoteText.trim();
        if (!sourceText || improvingNote) return;

        setImprovingNote(true);
        try {
            const result = await improveInternalNoteText({
                text: sourceText,
                noteType: "activity",
                conversationId: conversation.id,
                contactId: conversation.contactId,
                modelOverride: selectedModel || undefined,
            });
            if (!result.success) {
                toast.error(result.error || "Failed to improve note");
                return;
            }
            setAddNoteText(result.improvedText);
            toast.success("Note improved");
        } catch (error: any) {
            toast.error(error?.message || "Failed to improve note");
        } finally {
            setImprovingNote(false);
        }
    };

    // Reset transient state when conversation changes
    useEffect(() => {
        setIsBulkTranscribingAudio(false);
        setTranslationBannerDismissed(false);
        setThreadTranslationMode("original");
        setAutoTranslatingThread(false);
        autoTranslationAttemptedRef.current = null;
    }, [conversation.id]);

    const handleBulkTranscribeUnprocessedAudio = useCallback(async (window: "30d" | "all") => {
        if (!onBulkTranscribeUnprocessedAudio || isBulkTranscribingAudio) return;
        setIsBulkTranscribingAudio(true);
        try {
            await Promise.resolve(onBulkTranscribeUnprocessedAudio({ window }));
        } finally {
            setIsBulkTranscribingAudio(false);
        }
    }, [isBulkTranscribingAudio, onBulkTranscribeUnprocessedAudio]);

    const handleTranscriptKeyword = useCallback((keyword: string) => {
        setTranscriptSearchQuery(keyword);
        void handleTranscriptSearch(keyword);
    }, [handleTranscriptSearch]);

    const [agentDisplayLanguage, setAgentDisplayLanguage] = useState("en");
    useEffect(() => {
        setAgentDisplayLanguage(getBrowserLanguage());
    }, []);
    const resolvedTranslationTargetLanguage = agentDisplayLanguage || "en";
    const resolvedReplyLanguage = useMemo(
        () => getResolvedConversationTranslationLanguage(conversation),
        [conversation.locationDefaultReplyLanguage, conversation.replyLanguageOverride]
    );
    const inboundForeignCandidates = useMemo(() => {
        return messages.filter((message) => isLikelyForeignLanguageMessage(message, resolvedTranslationTargetLanguage));
    }, [messages, resolvedTranslationTargetLanguage]);
    const eligibleInboundTranslationIds = useMemo(() => {
        return messages
            .filter((message) => {
                if (!isLikelyForeignLanguageMessage(message, resolvedTranslationTargetLanguage)) return false;
                return buildMessageTranslationState(message, message.translations || [], resolvedTranslationTargetLanguage).viewDefault !== "translated";
            })
            .map((message) => String(message.id || "").trim())
            .filter(Boolean);
    }, [messages, resolvedTranslationTargetLanguage]);
    const threadSupportsTranslatedDefault = useMemo(() => {
        const inboundForeignCount = messages.filter((message) => isLikelyForeignLanguageMessage(message, resolvedTranslationTargetLanguage)).length;
        if (inboundForeignCount < 2) return false;
        return messages.some((message) => buildMessageTranslationState(message, message.translations || [], resolvedTranslationTargetLanguage).viewDefault === "translated");
    }, [messages, resolvedTranslationTargetLanguage]);
    const threadShouldPreferTranslated = threadSupportsTranslatedDefault || inboundForeignCandidates.length >= 2;
    const resolvedTranslationTargetLanguageLabel = getReplyLanguageLabel(resolvedTranslationTargetLanguage) || resolvedTranslationTargetLanguage;
    const shouldShowTranslationBanner = translationReadEnabled
        && translationBannerEnabled
        && !translationBannerDismissed
        && inboundForeignCandidates.length >= 2
        && !!onTranslateVisibleThread;

    useEffect(() => {
        if (typeof window === "undefined") return;
        const storageKey = getThreadTranslationPreferenceKey(conversation.id, resolvedTranslationTargetLanguage);
        const stored = window.localStorage.getItem(storageKey);
        if (stored === "original" || stored === "translated") {
            setThreadTranslationMode(stored);
            return;
        }
        setThreadTranslationMode(threadShouldPreferTranslated ? "translated" : "original");
    }, [conversation.id, resolvedTranslationTargetLanguage, threadShouldPreferTranslated]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const storageKey = getThreadTranslationPreferenceKey(conversation.id, resolvedTranslationTargetLanguage);
        window.localStorage.setItem(storageKey, threadTranslationMode);
    }, [conversation.id, resolvedTranslationTargetLanguage, threadTranslationMode]);

    const handleTranslateVisibleThread = useCallback(async (options?: { silent?: boolean; auto?: boolean }) => {
        if (!onTranslateVisibleThread || translatingVisibleThread || autoTranslatingThread) return;
        const visibleInboundIds = eligibleInboundTranslationIds.length > 0
            ? eligibleInboundTranslationIds
            : messages
                .filter((message) => message.direction === "inbound" && String(message.body || "").trim().length > 0)
                .map((message) => String(message.id || "").trim())
                .filter(Boolean);
        if (visibleInboundIds.length === 0) return;

        if (options?.auto) {
            setAutoTranslatingThread(true);
        } else {
            setTranslatingVisibleThread(true);
        }
        try {
            const result = await onTranslateVisibleThread(
                visibleInboundIds,
                resolvedTranslationTargetLanguage
            );
            if (!result?.success) {
                if (!options?.silent) {
                    toast.error(result?.error || "Failed to translate visible messages.");
                }
                return;
            }
            setThreadTranslationMode("translated");
            setTranslationBannerDismissed(true);
            if (!options?.silent) {
                toast.success(`Translated ${Number(result.translatedCount || 0)} messages.`);
            }
        } finally {
            if (options?.auto) {
                setAutoTranslatingThread(false);
            } else {
                setTranslatingVisibleThread(false);
            }
        }
    }, [autoTranslatingThread, eligibleInboundTranslationIds, messages, onTranslateVisibleThread, resolvedTranslationTargetLanguage, translatingVisibleThread]);

    useEffect(() => {
        if (!translationReadEnabled || !onTranslateVisibleThread) return;
        if (threadTranslationMode !== "translated") return;
        if (inboundForeignCandidates.length < 2) return;
        if (eligibleInboundTranslationIds.length === 0) return;

        const autoKey = `${conversation.id}:${resolvedTranslationTargetLanguage}`;
        if (autoTranslationAttemptedRef.current === autoKey) return;
        autoTranslationAttemptedRef.current = autoKey;
        void handleTranslateVisibleThread({ silent: true, auto: true });
    }, [
        conversation.id,
        eligibleInboundTranslationIds.length,
        handleTranslateVisibleThread,
        inboundForeignCandidates.length,
        onTranslateVisibleThread,
        resolvedTranslationTargetLanguage,
        threadTranslationMode,
        translationReadEnabled,
    ]);
    const conversationType = String(conversation.lastMessageType || conversation.type || "").toUpperCase();
    const isWhatsAppConversation = conversationType.includes("WHATSAPP");
    const isEmailConversation = conversation.type === 'Email' || conversation.lastMessageType === 'TYPE_EMAIL' || conversationType.includes("EMAIL");
    const hasMobileMoreActions = (
        selectionBatch.length > 0
        || (!!isWhatsAppConversation && !!onSync)
        || (!!isWhatsAppConversation && !!canUseTranscriptOnDemand && !!onBulkTranscribeUnprocessedAudio)
        || (!!isEmailConversation && !!onFetchHistory)
    );

    return (
        <div
            data-chat-active-conversation-id={conversation.id}
            data-chat-initial-paint-ready={isTimelineReady ? "true" : "false"}
            className="h-full flex flex-col bg-white min-w-0 overflow-hidden"
        >
            {/* Header */}
            <div className="h-16 border-b flex items-center px-3 sm:px-6 shrink-0 justify-between bg-white z-10 shadow-sm gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    {onBack && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={onBack}
                            title="Back to conversations"
                        >
                            <ArrowLeft className="h-4 w-4 text-gray-500" />
                        </Button>
                    )}
                    <div className="w-0 flex-1 min-w-0 overflow-hidden">
                        <h3 className="block w-full truncate font-bold text-gray-900">{conversation.contactName || "Unknown Contact"}</h3>
                        <div className="flex items-center gap-2 mt-0.5 min-w-0">
                            <span className="flex h-2 w-2 rounded-full bg-green-500 shrink-0" />
                            <p className="text-xs text-gray-500 font-medium truncate min-w-0 flex-1">
                                {getChannelName(conversation.lastMessageType || conversation.type)} • {conversation.status}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-1 sm:gap-2 shrink-0 min-w-0">
                    {onOpenMissionControl && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={onOpenMissionControl}
                            title="Open Mission Control"
                        >
                            <ListTodo className="h-4 w-4 text-gray-500" />
                        </Button>
                    )}
                    {selectionBatch.length > 0 && (
                        <>
                            <TooltipProvider delayDuration={200}>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 gap-1 px-2 text-[11px]"
                                            onClick={handleSummarizeBatch}
                                            disabled={isSummarizingBatch}
                                            title="Summarize all queued snippets into one CRM log entry"
                                        >
                                            {isSummarizingBatch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                                            {isSummarizingBatch ? (
                                                "..."
                                            ) : (
                                                <>
                                                    <span className="sm:hidden">Batch ({selectionBatch.length})</span>
                                                    <span className="hidden sm:inline">Summarize Batch ({selectionBatch.length})</span>
                                                </>
                                            )}
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Summarize all queued snippets</TooltipContent>
                                </Tooltip>
                            </TooltipProvider>

                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 hidden sm:inline-flex"
                                onClick={handleClearSelectionBatch}
                                title="Clear queued summary snippets"
                            >
                                <Trash2 className="h-3.5 w-3.5 text-gray-500" />
                            </Button>
                        </>
                    )}
                    {isWhatsAppConversation && onSync && (
                        <Button variant="ghost" size="icon" className="hidden sm:inline-flex" onClick={onSync} title="Sync WhatsApp History">
                            <RefreshCw className="h-4 w-4 text-gray-500" />
                        </Button>
                    )}
                    {isWhatsAppConversation
                        && canUseTranscriptOnDemand
                        && onBulkTranscribeUnprocessedAudio && (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 hidden sm:inline-flex"
                                        disabled={isBulkTranscribingAudio}
                                        title="Transcribe unprocessed audio"
                                    >
                                        {isBulkTranscribingAudio ? (
                                            <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
                                        ) : (
                                            <AudioLines className="h-4 w-4 text-gray-500" />
                                        )}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                                        Backfill Transcripts
                                    </DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => handleBulkTranscribeUnprocessedAudio("30d")} className="text-xs">
                                        Last 30 days
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleBulkTranscribeUnprocessedAudio("all")} className="text-xs">
                                        All in conversation
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                    {onAddActivityEntry && (
                        <Popover open={addNoteOpen} onOpenChange={setAddNoteOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant={addNoteOpen ? "secondary" : "ghost"}
                                    size="icon"
                                    className="h-8 w-8"
                                    title="Add activity note"
                                >
                                    <NotebookPen className="h-4 w-4 text-gray-500" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-80 p-3">
                                <div className="space-y-2">
                                    <p className="text-xs font-semibold text-slate-700">Add Activity Note</p>
                                    <Textarea
                                        value={addNoteText}
                                        onChange={(e) => setAddNoteText(e.target.value)}
                                        placeholder="What happened?"
                                        className="min-h-[60px] text-xs resize-none"
                                    />
                                    <Input
                                        type="datetime-local"
                                        step={300}
                                        value={addNoteDate}
                                        onChange={(e) => setAddNoteDate(e.target.value)}
                                        className="text-xs h-8"
                                    />
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="w-full h-7 text-xs"
                                        onClick={handleImproveNote}
                                        disabled={improvingNote || addingNote || !addNoteText.trim()}
                                    >
                                        {improvingNote ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Wand2 className="h-3 w-3 mr-1" />}
                                        {improvingNote ? "Improving..." : "Improve"}
                                    </Button>
                                    <Button
                                        size="sm"
                                        className="w-full h-7 text-xs"
                                        onClick={handleAddNote}
                                        disabled={addingNote || improvingNote || !addNoteText.trim()}
                                    >
                                        {addingNote ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                                        {addingNote ? "Saving..." : "Save Note"}
                                    </Button>
                                </div>
                            </PopoverContent>
                        </Popover>
                    )}
                    <Button
                        variant={showTranscriptSearch ? "secondary" : "ghost"}
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setShowTranscriptSearch((prev) => !prev)}
                        title="Search conversation"
                    >
                        <Search className="h-4 w-4 text-gray-500" />
                    </Button>
                    {isEmailConversation && onFetchHistory && (
                        <Button variant="ghost" size="icon" className="hidden sm:inline-flex" onClick={onFetchHistory} title="Fetch Gmail History">
                            <RefreshCw className="h-4 w-4 text-gray-500" />
                        </Button>
                    )}

                    {hasMobileMoreActions && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 sm:hidden" title="More actions">
                                    <MoreHorizontal className="h-4 w-4 text-gray-500" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                                {selectionBatch.length > 0 && (
                                    <DropdownMenuItem onClick={handleClearSelectionBatch} className="gap-2">
                                        <Trash2 className="h-4 w-4" />
                                        Clear batch snippets
                                    </DropdownMenuItem>
                                )}
                                {isWhatsAppConversation && onSync && (
                                    <DropdownMenuItem onClick={onSync} className="gap-2">
                                        <RefreshCw className="h-4 w-4" />
                                        Sync WhatsApp History
                                    </DropdownMenuItem>
                                )}
                                {isWhatsAppConversation && canUseTranscriptOnDemand && onBulkTranscribeUnprocessedAudio && (
                                    <>
                                        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
                                            Backfill transcripts
                                        </DropdownMenuLabel>
                                        <DropdownMenuItem onClick={() => handleBulkTranscribeUnprocessedAudio("30d")} className="text-xs">
                                            Last 30 days
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleBulkTranscribeUnprocessedAudio("all")} className="text-xs">
                                            All in conversation
                                        </DropdownMenuItem>
                                    </>
                                )}
                                {isEmailConversation && onFetchHistory && (
                                    <DropdownMenuItem onClick={onFetchHistory} className="gap-2">
                                        <RefreshCw className="h-4 w-4" />
                                        Fetch Gmail History
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
            </div>

            {showTranscriptSearch && (
                <div className="border-b bg-slate-50/80 px-4 py-3 space-y-3" data-no-pane-swipe>
                    {showTranscriptSearch && (
                        <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
                            <div className="flex items-center gap-2">
                                <Search className="h-4 w-4 text-slate-600" />
                                <p className="text-xs font-semibold text-slate-800">Search</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Input
                                    value={transcriptSearchQuery}
                                    onChange={(e) => setTranscriptSearchQuery(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            void handleTranscriptSearch();
                                        }
                                    }}
                                    placeholder="Search messages..."
                                    className="h-8 text-xs"
                                />
                                <Button
                                    type="button"
                                    size="sm"
                                    className="h-8 px-2 text-[11px]"
                                    onClick={() => void handleTranscriptSearch()}
                                    disabled={isTranscriptSearching}
                                >
                                    {isTranscriptSearching ? "Searching..." : "Search"}
                                </Button>
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {TRANSCRIPT_SEARCH_KEYWORDS.map((keyword) => (
                                    <button
                                        key={keyword}
                                        type="button"
                                        className={cn(
                                            "rounded border px-2 py-0.5 text-[10px] transition-colors",
                                            transcriptSearchQuery.trim().toLowerCase() === keyword.toLowerCase()
                                                ? "border-blue-300 bg-blue-50 text-blue-700"
                                                : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                                        )}
                                        onClick={() => handleTranscriptKeyword(keyword)}
                                        disabled={isTranscriptSearching}
                                    >
                                        {keyword}
                                    </button>
                                ))}
                            </div>
                            {transcriptSearchError && (
                                <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
                                    {transcriptSearchError}
                                </div>
                            )}
                            {!transcriptSearchError && transcriptSearchQuery.trim() && !isTranscriptSearching && (
                                <div className="text-[11px] text-slate-500">
                                    {transcriptSearchTotal > 0
                                        ? `Showing ${transcriptSearchResults.length} of ${transcriptSearchTotal} matches.`
                                        : "No matches found for this query."}
                                </div>
                            )}
                            {transcriptSearchResults.length > 0 && (
                                <div className="max-h-52 space-y-1 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-1.5">
                                    {transcriptSearchResults.map((match) => (
                                        <button
                                            key={`${match.transcriptId}:${match.messageId}`}
                                            type="button"
                                            onClick={() => jumpToMessage(match.messageId)}
                                            className="w-full rounded border border-transparent bg-white px-2 py-1.5 text-left text-[11px] hover:border-blue-200 hover:bg-blue-50"
                                        >
                                            <div className="flex items-center gap-2 text-[10px] text-slate-500">
                                                <span>{new Date(match.messageDate).toLocaleString()}</span>
                                                <span className="uppercase">{match.direction}</span>
                                                {match.source === "transcript" && <span className="text-purple-500">transcript</span>}
                                            </div>
                                            <p className="mt-0.5 text-slate-700 line-clamp-2">{match.snippet || "(empty snippet)"}</p>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {shouldShowTranslationBanner && (
                <div className="border-b bg-amber-50/70 px-4 py-2.5" data-no-pane-swipe>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-amber-900">
                        <Languages className="h-3.5 w-3.5" />
                        <span className="font-medium">Some inbound messages appear to be in another language.</span>
                        <Button
                            type="button"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => void handleTranslateVisibleThread()}
                            disabled={translatingVisibleThread}
                        >
                            {translatingVisibleThread ? "Translating..." : "Translate visible thread"}
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => setTranslationBannerDismissed(true)}
                        >
                            Not now
                        </Button>
                    </div>
                </div>
            )}

            {translationReadEnabled && inboundForeignCandidates.length >= 2 && (
                <div className="border-b bg-slate-50 px-4 py-2" data-no-pane-swipe>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                        <Languages className="h-3.5 w-3.5" />
                        <span className="font-medium">
                            {threadTranslationMode === "translated"
                                ? `Viewing translated to ${resolvedTranslationTargetLanguageLabel}.`
                                : "Viewing original client text."}
                        </span>
                        {(translatingVisibleThread || autoTranslatingThread) && (
                            <span className="inline-flex items-center gap-1 text-slate-500">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Preparing translation
                            </span>
                        )}
                        <Button
                            type="button"
                            size="sm"
                            variant={threadTranslationMode === "translated" ? "secondary" : "ghost"}
                            className="h-7 px-2 text-[11px]"
                            onClick={() => setThreadTranslationMode("translated")}
                        >
                            Show translation
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant={threadTranslationMode === "original" ? "secondary" : "ghost"}
                            className="h-7 px-2 text-[11px]"
                            onClick={() => setThreadTranslationMode("original")}
                        >
                            Show original
                        </Button>
                    </div>
                </div>
            )}

            {/* Messages Area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6 bg-slate-50/50">
                <div
                    ref={timelineContentRef}
                    className={cn(
                        "space-y-4 sm:space-y-6 min-w-0 max-w-full",
                        !loading && timelineItems.length > 0 && !isTimelineReady && "opacity-0"
                    )}
                >
                    {loading && (
                        <div className="flex justify-center p-8">
                            <Loader2 className="h-8 w-8 animate-spin text-blue-500/50" />
                        </div>
                    )}

                    {!loading && messages.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 space-y-4">
                            <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center">
                                <MessageSquare className="h-6 w-6 text-gray-300" />
                            </div>
                            <p>No messages yet. Start the conversation!</p>
                        </div>
                    )}

                    {timelineItems.map((item) => {
                        if (item.kind === 'activity') {
                            return (
                                <div key={`activity-${item.activity.id}`} className="min-w-0 max-w-full overflow-x-hidden">
                                    <ActivityLogEntry
                                        item={item.activity}
                                        contactName={conversation.contactName}
                                    />
                                </div>
                            );
                        }
                        const m = item.message!;
                        const enableMountAnimation = getEnableMountAnimation(m.id);
                        return (
                            <div
                                key={m.id}
                                ref={(node) => {
                                    messageRefs.current[m.id] = node;
                                }}
                                className={cn(
                                    "rounded-xl transition-colors min-w-0 max-w-full overflow-x-hidden",
                                    highlightedMessageId === m.id && "ring-2 ring-blue-300 bg-blue-50/60"
                                )}
                            >
                                <MessageBubble
                                    message={m}
                                    locationId={conversation.locationId}
                                    contactPhone={conversation.contactPhone}
                                    contactEmail={conversation.contactEmail}
                                    contactName={conversation.contactName}
                                    onRefetchMedia={onRefetchMedia}
                                    onRequestTranscript={canUseTranscriptOnDemand ? onRequestTranscript : undefined}
                                    onExtractViewingNotes={canUseTranscriptOnDemand ? onExtractViewingNotes : undefined}
                                    onRetryTranscript={canUseTranscriptOnDemand ? onRetryTranscript : undefined}
                                    aiModel={selectedModel}
                                    selectionBatch={selectionBatch}
                                    onAddSelectionToBatch={handleAddSelectionToBatch}
                                    onRemoveSelectionBatchItem={handleRemoveSelectionBatchItem}
                                    onClearSelectionBatch={handleClearSelectionBatch}
                                    enableMountAnimation={enableMountAnimation}
                                    onResendMessage={onResendMessage}
                                    translationReadEnabled={translationReadEnabled}
                                    threadTranslationMode={threadTranslationMode}
                                    preferredDisplayLanguage={resolvedTranslationTargetLanguage}
                                    onTranslateMessage={onTranslateMessage}
                                />
                            </div>
                        );
                    })}
                </div>
            </div>

            <SuggestedResponseQueue
                items={suggestedResponseQueue}
                loading={suggestedResponseQueueLoading}
                onAccept={async (id, mode) => {
                    if (!onAcceptSuggestedResponse) return;
                    await onAcceptSuggestedResponse(id, mode);
                }}
                onReject={async (id, reason) => {
                    if (!onRejectSuggestedResponse) return;
                    await onRejectSuggestedResponse(id, reason);
                }}
                allowSendNow={true}
            />

            <ConversationComposer
                conversation={conversation}
                draft={composerDraft}
                onDraftChange={onComposerDraftChange}
                onDraftClear={onComposerDraftClear}
                onSendMessage={onSendMessage}
                onSendMedia={onSendMedia}
                onGenerateDraft={onGenerateDraft}
                onSetReplyLanguageOverride={onSetReplyLanguageOverride}
                onPreviewTranslatedReply={onPreviewTranslatedReply}
                translationWriteEnabled={translationWriteEnabled}
                suggestions={suggestions}
                onModelChange={setSelectedModel}
                insertDraftSeed={composerInsertSeed}
                translationTargetLanguageLabel={resolvedReplyLanguage}
                viewingLanguageLabel={resolvedTranslationTargetLanguage}
                smsRelayEnabled={smsRelayEnabled}
            />
        </div>
    );
}
