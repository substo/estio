import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Conversation, Message } from "@/lib/ghl/conversations";
import { GEMINI_FLASH_LATEST_ALIAS } from "@/lib/ai/models";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MessageSquare, RefreshCw, FileText, Trash2, Search, AudioLines, NotebookPen } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ActivityLogEntry } from "./activity-log-entry";

export interface ActivityLogItem {
    id: string;
    type: 'activity';
    createdAt: string;
    action: string;
    changes?: any;
    user?: { name: string | null; email: string | null } | null;
}

interface ChatWindowProps {
    conversation: Conversation;
    messages: Message[];
    activityLog?: ActivityLogItem[];
    loading: boolean;
    onSendMessage: (text: string, type: 'SMS' | 'Email' | 'WhatsApp') => void | Promise<void>;
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
    onGenerateDraft?: (instruction?: string, model?: string) => Promise<string | null>;
    onAddActivityEntry?: (entryText: string, dateIso: string) => Promise<void>;
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

import {
    summarizeSelectionToCrmLog,
    searchConversationTranscriptMatches,
} from "@/app/(main)/admin/conversations/actions";
import type { SelectionBatchInput, SelectionBatchItem } from "./message-selection-actions";
import { ConversationComposer } from "./conversation-composer";

type TranscriptSearchResult = Awaited<ReturnType<typeof searchConversationTranscriptMatches>>;
type TranscriptSearchSuccess = Extract<TranscriptSearchResult, { success: true }>;
type TranscriptSearchMatch = TranscriptSearchSuccess["results"][number];

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

function normalizeSelectionForBatch(text: string) {
    return String(text || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function hashString(input: string) {
    let hash = 5381;
    for (let i = 0; i < input.length; i += 1) {
        hash = ((hash << 5) + hash) + input.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

function buildSelectionBatchId(conversationId: string, item: SelectionBatchInput, normalizedText: string) {
    return `${conversationId}:${item.messageId || "no-message"}:${hashString(`${item.source}:${normalizedText.toLowerCase()}`)}`;
}

function buildBatchContextText(items: SelectionBatchItem[]) {
    return items.map((item, index) => `Snippet ${index + 1}:\n${item.text}`).join("\n\n");
}

export function ChatWindow({
    conversation,
    messages,
    activityLog = [],
    loading,
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
    onFetchHistory,
    onAddActivityEntry,
    suggestions = [],
}: ChatWindowProps & { suggestions?: string[] }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [selectedModel, setSelectedModel] = useState(GEMINI_FLASH_LATEST_ALIAS);
    const [selectionBatch, setSelectionBatch] = useState<SelectionBatchItem[]>([]);
    const [isSummarizingBatch, setIsSummarizingBatch] = useState(false);
    const [bulkTranscriptWindow, setBulkTranscriptWindow] = useState<"30d" | "all">("30d");
    const [isBulkTranscribingAudio, setIsBulkTranscribingAudio] = useState(false);
    const [showTranscriptSearch, setShowTranscriptSearch] = useState(false);
    const [transcriptSearchQuery, setTranscriptSearchQuery] = useState("");
    const [isTranscriptSearching, setIsTranscriptSearching] = useState(false);
    const [transcriptSearchError, setTranscriptSearchError] = useState<string | null>(null);
    const [transcriptSearchTotal, setTranscriptSearchTotal] = useState(0);
    const [transcriptSearchResults, setTranscriptSearchResults] = useState<TranscriptSearchMatch[]>([]);
    const [jumpMessageId, setJumpMessageId] = useState<string | null>(null);
    const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const jumpHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const shouldStickToBottomRef = useRef(true);
    const canUseTranscriptOnDemand = transcriptOnDemandEnabled !== false;
    const [addNoteOpen, setAddNoteOpen] = useState(false);
    const [addNoteText, setAddNoteText] = useState("");
    const [addNoteDate, setAddNoteDate] = useState(new Date().toISOString().slice(0, 16));
    const [addingNote, setAddingNote] = useState(false);

    // Merge messages and activity log into a single timeline
    const timelineItems = useMemo(() => {
        const msgItems = messages.map(m => ({
            kind: 'message' as const,
            sortDate: new Date(m.dateAdded).getTime(),
            message: m,
        }));
        const actItems = activityLog.map(a => ({
            kind: 'activity' as const,
            sortDate: new Date(a.createdAt).getTime(),
            activity: a,
        }));
        return [...msgItems, ...actItems].sort((a, b) => a.sortDate - b.sortDate);
    }, [messages, activityLog]);

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

    // Reset transient state when conversation changes
    useEffect(() => {
        setSelectionBatch([]);
        setIsBulkTranscribingAudio(false);
        setTranscriptSearchQuery("");
        setTranscriptSearchError(null);
        setTranscriptSearchResults([]);
        setTranscriptSearchTotal(0);
        setShowTranscriptSearch(false);
        setJumpMessageId(null);
        messageRefs.current = {};
        shouldStickToBottomRef.current = true;
    }, [conversation.id]);

    useEffect(() => {
        return () => {
            if (jumpHighlightTimeoutRef.current) {
                clearTimeout(jumpHighlightTimeoutRef.current);
                jumpHighlightTimeoutRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        const container = scrollRef.current;
        if (!container) return;

        const handleScroll = () => {
            const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            shouldStickToBottomRef.current = distanceFromBottom <= 80;
        };

        handleScroll();
        container.addEventListener("scroll", handleScroll, { passive: true });
        return () => container.removeEventListener("scroll", handleScroll);
    }, [conversation.id]);

    // Snap to the latest message before paint on initial thread load.
    useLayoutEffect(() => {
        if (loading) return;
        if (!messages.length && !activityLog.length) return;
        if (!shouldStickToBottomRef.current) return;

        const container = scrollRef.current;
        if (!container) return;
        container.scrollTop = container.scrollHeight;
    }, [conversation.id, messages, activityLog, loading]);

    const handleAddSelectionToBatch = useCallback((item: SelectionBatchInput) => {
        const normalizedText = normalizeSelectionForBatch(item.text);
        if (!normalizedText) {
            return { added: false, total: selectionBatch.length };
        }

        const id = buildSelectionBatchId(conversation.id, item, normalizedText);
        if (selectionBatch.some((existing) => existing.id === id)) {
            return { added: false, total: selectionBatch.length };
        }

        const next = [
            ...selectionBatch,
            {
                id,
                messageId: item.messageId || null,
                text: normalizedText,
                source: item.source,
                addedAt: Date.now(),
            },
        ];
        setSelectionBatch(next);
        return { added: true, total: next.length };
    }, [conversation.id, selectionBatch]);

    const handleRemoveSelectionBatchItem = useCallback((id: string) => {
        setSelectionBatch((prev) => prev.filter((item) => item.id !== id));
    }, []);

    const handleClearSelectionBatch = useCallback(() => {
        setSelectionBatch([]);
    }, []);

    const handleBulkTranscribeUnprocessedAudio = useCallback(async (window: "30d" | "all") => {
        if (!onBulkTranscribeUnprocessedAudio || isBulkTranscribingAudio) return;
        setIsBulkTranscribingAudio(true);
        try {
            await Promise.resolve(onBulkTranscribeUnprocessedAudio({ window }));
        } finally {
            setIsBulkTranscribingAudio(false);
        }
    }, [isBulkTranscribingAudio, onBulkTranscribeUnprocessedAudio]);

    const jumpToMessage = useCallback((messageId: string) => {
        const target = messageRefs.current[messageId];
        if (!target) {
            toast.error("Message not found in current view.");
            return;
        }

        target.scrollIntoView({ behavior: "smooth", block: "center" });
        setJumpMessageId(messageId);
        if (jumpHighlightTimeoutRef.current) {
            clearTimeout(jumpHighlightTimeoutRef.current);
        }
        jumpHighlightTimeoutRef.current = setTimeout(() => {
            setJumpMessageId((current) => current === messageId ? null : current);
            jumpHighlightTimeoutRef.current = null;
        }, 2200);
    }, []);

    const handleTranscriptSearch = useCallback(async (overrideQuery?: string) => {
        const query = String(overrideQuery ?? transcriptSearchQuery).trim();
        if (!query) {
            setTranscriptSearchError(null);
            setTranscriptSearchResults([]);
            setTranscriptSearchTotal(0);
            return;
        }

        setIsTranscriptSearching(true);
        setTranscriptSearchError(null);
        try {
            const result = await searchConversationTranscriptMatches(conversation.id, {
                query,
                limit: 20,
            });

            if (!result?.success) {
                setTranscriptSearchResults([]);
                setTranscriptSearchTotal(0);
                setTranscriptSearchError(result?.error || "Failed to search transcripts.");
                return;
            }

            setTranscriptSearchResults(result.results || []);
            setTranscriptSearchTotal(Number(result.totalMatches || 0));
        } catch (error: any) {
            setTranscriptSearchResults([]);
            setTranscriptSearchTotal(0);
            setTranscriptSearchError(String(error?.message || "Failed to search transcripts."));
        } finally {
            setIsTranscriptSearching(false);
        }
    }, [conversation.id, transcriptSearchQuery]);

    const handleTranscriptKeyword = useCallback((keyword: string) => {
        setTranscriptSearchQuery(keyword);
        void handleTranscriptSearch(keyword);
    }, [handleTranscriptSearch]);

    const batchContextText = useMemo(() => buildBatchContextText(selectionBatch), [selectionBatch]);

    const handleSummarizeBatch = async () => {
        if (!selectionBatch.length) return;
        setIsSummarizingBatch(true);
        try {
            const modelOverride = typeof selectedModel === "string" && selectedModel.trim() ? selectedModel.trim() : undefined;
            const res = await summarizeSelectionToCrmLog(conversation.id, batchContextText, modelOverride);
            if (!res?.success || !res?.entry) {
                toast.error(res?.error || "Failed to summarize batch");
                return;
            }
            if (res?.skipped) {
                toast.message("No new info found. Skipped duplicate CRM log entry.");
            } else {
                toast.success("Batch summary saved to CRM log");
            }
            setSelectionBatch([]);
        } catch (error: any) {
            toast.error(error?.message || "Failed to summarize batch");
        } finally {
            setIsSummarizingBatch(false);
        }
    };

    const isWhatsAppConversation = String(conversation.lastMessageType || conversation.type || "").toUpperCase().includes("WHATSAPP");

    return (
        <div className="h-full flex flex-col bg-white min-w-0 overflow-hidden">
            {/* Header */}
            <div className="h-16 border-b flex items-center px-6 shrink-0 justify-between bg-white z-10 shadow-sm">
                <div>
                    <h3 className="font-bold text-gray-900">{conversation.contactName || "Unknown Contact"}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className="flex h-2 w-2 rounded-full bg-green-500" />
                        <p className="text-xs text-gray-500 font-medium">
                            {getChannelName(conversation.lastMessageType || conversation.type)} • {conversation.status}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {selectionBatch.length > 0 && (
                        <>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1.5 px-2 text-[11px]"
                                onClick={handleSummarizeBatch}
                                disabled={isSummarizingBatch}
                                title="Summarize all queued snippets into one CRM log entry"
                            >
                                {isSummarizingBatch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                                {isSummarizingBatch ? "Summarizing..." : `Summarize Batch (${selectionBatch.length})`}
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={handleClearSelectionBatch}
                                title="Clear queued summary snippets"
                            >
                                <Trash2 className="h-3.5 w-3.5 text-gray-500" />
                            </Button>
                        </>
                    )}
                    {isWhatsAppConversation && onSync && (
                        <Button variant="ghost" size="icon" onClick={onSync} title="Sync WhatsApp History">
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
                                        className="h-8 w-8"
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
                                        className="w-full h-7 text-xs"
                                        onClick={handleAddNote}
                                        disabled={addingNote || !addNoteText.trim()}
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
                    {(conversation.type === 'Email' || conversation.lastMessageType === 'TYPE_EMAIL') && onFetchHistory && (
                        <Button variant="ghost" size="icon" onClick={onFetchHistory} title="Fetch Gmail History">
                            <RefreshCw className="h-4 w-4 text-gray-500" />
                        </Button>
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

            {/* Messages Area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/50 scroll-smooth">
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
                            <ActivityLogEntry
                                key={`activity-${item.activity.id}`}
                                item={item.activity}
                                contactName={conversation.contactName}
                            />
                        );
                    }
                    const m = item.message!;
                    return (
                        <div
                            key={m.id}
                            ref={(node) => {
                                messageRefs.current[m.id] = node;
                            }}
                            className={cn(
                                "rounded-xl transition-colors",
                                jumpMessageId === m.id && "ring-2 ring-blue-300 bg-blue-50/60"
                            )}
                        >
                            <MessageBubble
                                message={m}
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
                            />
                        </div>
                    );
                })}
            </div>

            <ConversationComposer
                conversation={conversation}
                onSendMessage={onSendMessage}
                onSendMedia={onSendMedia}
                onGenerateDraft={onGenerateDraft}
                suggestions={suggestions}
                onModelChange={setSelectedModel}
            />
        </div>
    );
}
