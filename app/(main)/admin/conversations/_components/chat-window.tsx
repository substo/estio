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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ActivityLogEntry } from "./activity-log-entry";
import { SuggestedResponseQueue, type SuggestedResponseQueueItem } from "./suggested-response-queue";
import { useChatWindowTimelineScroll, type ActivityLogItem } from "./use-chat-window-timeline-scroll";
import { useChatWindowTranscriptSearch } from "./use-chat-window-transcript-search";
import { useChatWindowSelectionBatch } from "./use-chat-window-selection-batch";
import { useChatWindowThreadTranslation } from "./use-chat-window-thread-translation";
import { useChatWindowActivityNote } from "./use-chat-window-activity-note";
import {
    getConversationTimelineContentClassName,
    getConversationTimelineScrollClassName,
    getConversationSurfaceTheme,
    type ConversationSurfaceChannel,
} from "./message-bubble-theme";
import { getConversationChannelInfo } from "./conversation-channel-info";
import { getConversationLifecycleUi } from "@/lib/conversations/conversation-status-ui";
import type { ComposerChannel } from "./use-conversation-composer-translation-preview";

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
        type: ComposerChannel,
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
        baseDraft?: string | null,
        onChunk?: (chunk: string) => void
    ) => Promise<string | null>;
    onSetReplyLanguageOverride?: (replyLanguage: string | null) => Promise<{ success: boolean; error?: string; replyLanguageOverride?: string | null }>;
    onTranslateMessage?: (messageId: string, targetLanguage?: string | null) => Promise<{
        success: boolean;
        error?: string;
        messageId?: string;
        cached?: boolean;
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
        channel: ComposerChannel,
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
    onActivityEntryUpdated?: (activityEntry: ActivityLogItem) => void;
    onActivityEntryDeleted?: (activityId: string) => void;
    suggestedResponseQueue?: SuggestedResponseQueueItem[];
    suggestedResponseQueueLoading?: boolean;
    onAcceptSuggestedResponse?: (id: string, mode: "insertOnly" | "sendNow") => Promise<void>;
    onRejectSuggestedResponse?: (id: string, reason?: string | null) => Promise<void>;
    composerDraft: string;
    onComposerDraftChange: (draft: string) => void;
    onComposerDraftClear: () => void;
    composerInsertSeed?: { key: string; body: string } | null;
    onResendMessage?: (messageId: string) => void | Promise<void>;
    onSendSmsFallback?: (messageId: string) => void | Promise<void>;
    smsRelayEnabled?: boolean;
}

import { MessageBubble } from "./message-bubble";
import { MessageImageGroup } from "./message-image-group";
import { groupAdjacentWhatsAppImageMessages } from "./message-image-grouping";

import { ConversationComposer } from "./conversation-composer";

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

function getInitialSurfaceChannel(conversation: Conversation): ConversationSurfaceChannel {
    const channel = getConversationChannelInfo(conversation).channel;
    if (channel === "WhatsApp" || channel === "Email" || channel === "SMS" || channel === "SMS_RELAY") {
        return channel;
    }
    return "default";
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
    onActivityEntryUpdated,
    onActivityEntryDeleted,
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
    onSendSmsFallback,
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
    const [activeSurfaceChannel, setActiveSurfaceChannel] = useState<ConversationSurfaceChannel>(() => getInitialSurfaceChannel(conversation));
    const lastTimelineCountLogRef = useRef<string | null>(null);
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
    const {
        addNoteOpen,
        setAddNoteOpen,
        addNoteText,
        setAddNoteText,
        addNoteDate,
        setAddNoteDate,
        addingNote,
        improvingNote,
        handleAddNote,
        handleImproveNote,
    } = useChatWindowActivityNote({
        conversationId: conversation.id,
        contactId: conversation.contactId,
        selectedModel,
        onAddActivityEntry,
    });
    const {
        translatingVisibleThread,
        autoTranslatingThread,
        dismissTranslationBanner,
        threadTranslationMode,
        setThreadTranslationMode,
        resolvedTranslationTargetLanguage,
        inboundForeignCandidates,
        resolvedTranslationTargetLanguageLabel,
        shouldShowTranslationBanner,
        handleTranslateVisibleThread,
    } = useChatWindowThreadTranslation({
        conversation,
        messages,
        onTranslateVisibleThread,
        translationReadEnabled,
        translationBannerEnabled,
    });

    useEffect(() => {
        if (process.env.NODE_ENV === "production") return;
        const mountedMessageCount = timelineItems.filter((item) => item.kind === "message").length;
        const mountedActivityCount = timelineItems.length - mountedMessageCount;
        const logKey = [
            conversation.id,
            timelineItems.length,
            mountedMessageCount,
            mountedActivityCount,
            loading ? "loading" : "ready",
            isTimelineReady ? "painted" : "hidden",
        ].join(":");
        if (lastTimelineCountLogRef.current === logKey) return;
        lastTimelineCountLogRef.current = logKey;
        console.debug("[perf:conversations.chat_timeline_mount_count]", {
            conversationId: conversation.id,
            mountedItemCount: timelineItems.length,
            mountedMessageCount,
            mountedActivityCount,
            sourceMessageCount: messages.length,
            sourceActivityCount: activityLog.length,
            loading,
            initialPaintReady: isTimelineReady,
        });
    }, [activityLog.length, conversation.id, isTimelineReady, loading, messages.length, timelineItems]);

    // Reset transient state when conversation changes
    useEffect(() => {
        setIsBulkTranscribingAudio(false);
        setActiveSurfaceChannel(getInitialSurfaceChannel(conversation));
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

    const conversationType = String(conversation.lastMessageType || conversation.type || "").toUpperCase();
    const isWhatsAppConversation = conversationType.includes("WHATSAPP");
    const isEmailConversation = conversation.type === 'Email' || conversation.lastMessageType === 'TYPE_EMAIL' || conversationType.includes("EMAIL");
    const conversationChannelInfo = getConversationChannelInfo(conversation);
    const conversationChannelLabel = conversationChannelInfo.name;
    const conversationLifecycle = getConversationLifecycleUi(conversation.status);
    const surfaceTheme = getConversationSurfaceTheme(activeSurfaceChannel);
    const groupedTimelineItems = useMemo(
        () => groupAdjacentWhatsAppImageMessages(timelineItems),
        [timelineItems]
    );
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
            data-chat-mounted-timeline-items={timelineItems.length}
            data-chat-mounted-messages={messages.length}
            data-chat-mounted-activity-items={activityLog.length}
            className={cn("h-full min-h-0 flex flex-col min-w-0 overflow-hidden", surfaceTheme.rootClassName)}
        >
            {/* Header */}
            <div className="h-12 border-b flex items-center px-3 sm:h-16 sm:px-6 shrink-0 justify-between bg-white z-10 shadow-sm gap-2">
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
                            <span className={cn("flex h-2 w-2 rounded-full shrink-0", conversationLifecycle.dotClassName)} />
                            <p className="text-xs text-gray-500 font-medium truncate min-w-0 flex-1">
                                {conversationChannelLabel} • {conversationLifecycle.label}
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
                            title="Open AI Coordinator"
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
                <div className="border-b bg-slate-50/80 px-4 py-3 space-y-3">
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
                                                ? surfaceTheme.searchActiveChipClassName
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
                                            className={cn("w-full rounded border border-transparent bg-white px-2 py-1.5 text-left text-[11px]", surfaceTheme.searchResultHoverClassName)}
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
                <div className="border-b bg-amber-50/70 px-3 py-1.5 sm:px-4 sm:py-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs text-amber-900 sm:hidden">
                        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                            <Languages className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">Translate thread?</span>
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                            <Button
                                type="button"
                                size="sm"
                                className="h-7 px-2 text-[11px]"
                                onClick={() => void handleTranslateVisibleThread()}
                                disabled={translatingVisibleThread}
                            >
                                {translatingVisibleThread ? "Translating..." : "Translate"}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-[11px]"
                                onClick={dismissTranslationBanner}
                            >
                                Hide
                            </Button>
                        </div>
                    </div>
                    <div className="hidden flex-wrap items-center gap-2 text-xs text-amber-900 sm:flex">
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
                            onClick={dismissTranslationBanner}
                        >
                            Not now
                        </Button>
                    </div>
                </div>
            )}

            {translationReadEnabled && inboundForeignCandidates.length >= 2 && (
                <div className="border-b bg-slate-50 px-3 py-1.5 sm:px-4 sm:py-2">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-600 sm:hidden">
                        <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                            <Languages className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">
                                {threadTranslationMode === "translated"
                                    ? `Viewing ${resolvedTranslationTargetLanguageLabel}`
                                    : "Viewing original"}
                            </span>
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                            {(translatingVisibleThread || autoTranslatingThread) && (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
                            )}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7"
                                        aria-label="Change message language view"
                                    >
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                    <DropdownMenuLabel>Message view</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => setThreadTranslationMode("translated")}>
                                        Show translation
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => setThreadTranslationMode("original")}>
                                        Show original
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                    <div className="hidden flex-wrap items-center gap-2 text-[11px] text-slate-600 sm:flex">
                        <Languages className="h-3.5 w-3.5" />
                        <span className="font-medium">
                            {threadTranslationMode === "translated"
                                ? `View messages in: ${resolvedTranslationTargetLanguageLabel}.`
                                : "Viewing original customer text."}
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
            <div
                ref={scrollRef}
                className={cn(
                    "flex-1 min-h-0 overflow-y-auto overflow-x-hidden",
                    getConversationTimelineScrollClassName(),
                    surfaceTheme.timelineClassName
                )}
            >
                <div
                    ref={timelineContentRef}
                    className={cn(
                        getConversationTimelineContentClassName(),
                        !loading && timelineItems.length > 0 && !isTimelineReady && "opacity-0"
                    )}
                >
                    {loading && (
                        <div className="flex justify-center p-8">
                            <Loader2 className={cn("h-8 w-8 animate-spin", surfaceTheme.loadingIconClassName)} />
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

                    {groupedTimelineItems.map((item) => {
                        if (item.kind === 'activity') {
                            return (
                                <div key={`activity-${item.activity.id}`} className="min-w-0 max-w-full overflow-x-hidden">
                                    <ActivityLogEntry
                                        item={item.activity}
                                        contactName={conversation.contactName}
                                        surfaceTheme={surfaceTheme}
                                        onActivityUpdated={onActivityEntryUpdated}
                                        onActivityDeleted={onActivityEntryDeleted}
                                    />
                                </div>
                            );
                        }
                        if (item.kind === "image-group") {
                            const latestMessage = item.group.messages[item.group.messages.length - 1];
                            const enableMountAnimation = getEnableMountAnimation(latestMessage.id);
                            return (
                                <div
                                    key={item.group.id}
                                    ref={(node) => {
                                        for (const message of item.group.messages) {
                                            messageRefs.current[message.id] = node;
                                        }
                                    }}
                                    className={cn(
                                        "rounded-xl transition-colors min-w-0 max-w-full overflow-x-hidden",
                                        item.group.messages.some((message) => highlightedMessageId === message.id) && surfaceTheme.highlightedMessageClassName,
                                        enableMountAnimation && "animate-in fade-in slide-in-from-bottom-2 duration-300"
                                    )}
                                >
                                    <MessageImageGroup
                                        group={item.group}
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
                                    highlightedMessageId === m.id && surfaceTheme.highlightedMessageClassName
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
                                    onSendSmsFallback={onSendSmsFallback}
                                    smsRelayEnabled={smsRelayEnabled}
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
                surfaceTheme={surfaceTheme}
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
                viewingLanguageLabel={resolvedTranslationTargetLanguage}
                smsRelayEnabled={smsRelayEnabled}
                surfaceTheme={surfaceTheme}
                onSelectedChannelChange={(channel) => setActiveSurfaceChannel(channel)}
            />
        </div>
    );
}
