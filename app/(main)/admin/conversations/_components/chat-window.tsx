import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Conversation, Message } from "@/lib/ghl/conversations";
import { GEMINI_FLASH_LATEST_ALIAS, GOOGLE_AI_MODELS } from "@/lib/ai/models";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, MessageSquare, RefreshCw, Paperclip, FileText, Trash2, Mic, Square } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

interface ChatWindowProps {
    conversation: Conversation;
    messages: Message[];
    loading: boolean;
    onSendMessage: (text: string, type: 'SMS' | 'Email' | 'WhatsApp') => void | Promise<void>;
    onSendMedia?: (file: File, caption: string) => void | Promise<void>;
    onRefetchMedia?: (messageId: string) => void | Promise<void>;
    onSync?: () => void;
    onFetchHistory?: () => void;
    onGenerateDraft?: (instruction?: string, model?: string) => Promise<string | null>; // Returns draft text or null if failed
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

function getInitialChannel(conversation: Conversation): 'SMS' | 'Email' | 'WhatsApp' {
    const typeUpper = (conversation.lastMessageType || conversation.type || '').toUpperCase();
    if (typeUpper.includes('EMAIL')) return 'Email';
    if (typeUpper.includes('WHATSAPP')) return 'WhatsApp';
    return 'SMS';
}

/**
 * Get placeholder text based on channel - guides users on both manual typing and AI Draft
 */
function getPlaceholderText(channel: 'SMS' | 'Email' | 'WhatsApp'): string {
    const channelHints: Record<string, string> = {
        WhatsApp: 'Message or AI instruction...',
        Email: 'Email or AI instruction...',
        SMS: 'Text or AI instruction...',
    };
    return channelHints[channel] || channelHints.SMS;
}

import { MessageBubble } from "./message-bubble";
import { SuggestionBubbles } from "./suggestion-bubbles";
import { Sparkles } from "lucide-react";

import {
    getAiDraftModelPickerStateAction,
    getSmsChannelEligibility,
    getWhatsAppChannelEligibility,
    summarizeSelectionToCrmLog,
} from "@/app/(main)/admin/conversations/actions";
import type { SelectionBatchInput, SelectionBatchItem } from "./message-selection-actions";

type WhatsAppEligibilityState =
    | { status: 'checking' }
    | { status: 'eligible' }
    | { status: 'ineligible'; reason?: string }
    | { status: 'unknown'; reason?: string };

type SmsEligibilityState =
    | { status: 'checking' }
    | { status: 'eligible' }
    | { status: 'ineligible'; reason?: string }
    | { status: 'unknown'; reason?: string };

function getFallbackChannelWithoutWhatsApp(conversation: Conversation): 'SMS' | 'Email' {
    return getInitialChannel(conversation) === 'Email' ? 'Email' : 'SMS';
}

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

export function ChatWindow({ conversation, messages, loading, onSendMessage, onSendMedia, onRefetchMedia, onSync, onGenerateDraft, onFetchHistory, suggestions = [] }: ChatWindowProps & { suggestions?: string[] }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [draft, setDraft] = useState("");
    const [sending, setSending] = useState(false);
    const [generatingDraft, setGeneratingDraft] = useState(false);
    const [selectedChannel, setSelectedChannel] = useState<'SMS' | 'Email' | 'WhatsApp'>(getInitialChannel(conversation));
    const [selectedModel, setSelectedModel] = useState(GEMINI_FLASH_LATEST_ALIAS);
    const [hasUserSelectedModel, setHasUserSelectedModel] = useState(false);
    const [availableModels, setAvailableModels] = useState<any[]>([]); // Dynamic list
    const [whatsAppEligibility, setWhatsAppEligibility] = useState<WhatsAppEligibilityState>({ status: 'checking' });
    const [smsEligibility, setSmsEligibility] = useState<SmsEligibilityState>({ status: 'checking' });
    const fileInputRef = useRef<HTMLInputElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const mediaChunksRef = useRef<Blob[]>([]);
    const hasUserSelectedModelRef = useRef(false);
    const [selectionBatch, setSelectionBatch] = useState<SelectionBatchItem[]>([]);
    const [isSummarizingBatch, setIsSummarizingBatch] = useState(false);
    const [isRecording, setIsRecording] = useState(false);

    // Fetch available models on mount
    useEffect(() => {
        let mounted = true;
        getAiDraftModelPickerStateAction().then(({ models, defaultModel }) => {
            if (mounted && models && models.length > 0) {
                setAvailableModels(models);
                if (!hasUserSelectedModelRef.current && defaultModel) {
                    setSelectedModel(defaultModel);
                }
            }
        }).catch(err => console.error("Failed to load AI models:", err));

        return () => { mounted = false; };
    }, []);

    // Update channel if conversation changes
    useEffect(() => {
        setSelectedChannel(getInitialChannel(conversation));
        setSelectionBatch([]);
    }, [conversation.id]);

    useEffect(() => {
        let cancelled = false;
        setWhatsAppEligibility({ status: 'checking' });

        getWhatsAppChannelEligibility(conversation.id)
            .then((res) => {
                if (cancelled) return;

                if (!res?.success) {
                    setWhatsAppEligibility({ status: 'unknown', reason: res?.reason });
                    return;
                }

                if (res.status === 'eligible') {
                    setWhatsAppEligibility({ status: 'eligible' });
                    return;
                }

                if (res.status === 'ineligible') {
                    setWhatsAppEligibility({ status: 'ineligible', reason: res.reason });
                    setSelectedChannel((prev) => prev === 'WhatsApp' ? getFallbackChannelWithoutWhatsApp(conversation) : prev);
                    return;
                }

                setWhatsAppEligibility({ status: 'unknown', reason: res.reason });
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("Failed to check WhatsApp eligibility:", err);
                setWhatsAppEligibility({ status: 'unknown', reason: 'Could not verify WhatsApp availability.' });
            });

        return () => {
            cancelled = true;
        };
    }, [conversation.id]);

    useEffect(() => {
        let cancelled = false;
        setSmsEligibility({ status: 'checking' });

        getSmsChannelEligibility(conversation.id)
            .then((res) => {
                if (cancelled) return;

                if (!res?.success) {
                    setSmsEligibility({ status: 'unknown', reason: res?.reason });
                    return;
                }

                if (res.status === 'eligible') {
                    setSmsEligibility({ status: 'eligible' });
                    return;
                }

                if (res.status === 'ineligible') {
                    setSmsEligibility({ status: 'ineligible', reason: res.reason });
                    setSelectedChannel((prev) => prev === 'SMS' ? 'Email' : prev);
                    return;
                }

                setSmsEligibility({ status: 'unknown', reason: res.reason });
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("Failed to check SMS eligibility:", err);
                setSmsEligibility({ status: 'unknown', reason: 'Could not verify SMS availability.' });
            });

        return () => {
            cancelled = true;
        };
    }, [conversation.id]);

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, loading]);

    const handleSend = async () => {
        if (isRecording || !draft.trim()) return;
        setSending(true);
        try {
            await Promise.resolve(onSendMessage(draft, selectedChannel));
            setDraft("");
        } finally {
            setSending(false);
        }
    };

    const stopRecorderTracks = () => {
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
        }
    };

    useEffect(() => {
        return () => {
            try {
                mediaRecorderRef.current?.stop();
            } catch {
                // ignore stop race during unmount
            }
            stopRecorderTracks();
        };
    }, []);

    useEffect(() => {
        if (selectedChannel !== "WhatsApp" && mediaRecorderRef.current && isRecording) {
            try {
                mediaRecorderRef.current.stop();
            } catch {
                stopRecorderTracks();
                mediaRecorderRef.current = null;
                setIsRecording(false);
            }
        }
    }, [selectedChannel, isRecording]);

    const handleMediaPickClick = () => {
        if (selectedChannel !== "WhatsApp" || !onSendMedia) return;
        fileInputRef.current?.click();
    };

    const handleMediaSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !onSendMedia) return;

        setSending(true);
        try {
            await Promise.resolve(onSendMedia(file, draft));
            setDraft("");
        } catch (err) {
            console.error("Media send failed", err);
            toast.error("Failed to send media");
        } finally {
            setSending(false);
            e.target.value = "";
        }
    };

    const pickRecorderMimeType = () => {
        const candidates = [
            "audio/webm;codecs=opus",
            "audio/webm",
            "audio/ogg;codecs=opus",
            "audio/ogg",
            "audio/mp4",
        ];
        for (const candidate of candidates) {
            if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) {
                return candidate;
            }
        }
        return "";
    };

    const extensionForAudioMimeType = (mimeType: string) => {
        const normalized = String(mimeType || "").toLowerCase();
        if (normalized.includes("ogg")) return "ogg";
        if (normalized.includes("mp4")) return "m4a";
        if (normalized.includes("mpeg")) return "mp3";
        if (normalized.includes("wav")) return "wav";
        if (normalized.includes("aac")) return "aac";
        return "webm";
    };

    const handleRecordToggle = async () => {
        if (selectedChannel !== "WhatsApp" || !onSendMedia || sending) return;

        if (isRecording && mediaRecorderRef.current) {
            try {
                mediaRecorderRef.current.stop();
            } catch (err) {
                console.error("Failed stopping recorder", err);
                stopRecorderTracks();
                mediaRecorderRef.current = null;
                setIsRecording(false);
            }
            return;
        }

        if (typeof window === "undefined" || typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
            toast.error("Audio recording is not supported in this browser.");
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = pickRecorderMimeType();
            const recorder = mimeType
                ? new MediaRecorder(stream, { mimeType })
                : new MediaRecorder(stream);

            mediaStreamRef.current = stream;
            mediaRecorderRef.current = recorder;
            mediaChunksRef.current = [];

            recorder.ondataavailable = (event: BlobEvent) => {
                if (event.data && event.data.size > 0) {
                    mediaChunksRef.current.push(event.data);
                }
            };

            recorder.onerror = (event: Event) => {
                console.error("Recorder error", event);
                toast.error("Recording failed. Please try again.");
                stopRecorderTracks();
                mediaRecorderRef.current = null;
                setIsRecording(false);
            };

            recorder.onstop = async () => {
                const chunks = [...mediaChunksRef.current];
                mediaChunksRef.current = [];

                const recorderMimeType = recorder.mimeType || mimeType || "audio/webm";
                const blob = new Blob(chunks, { type: recorderMimeType });

                stopRecorderTracks();
                mediaRecorderRef.current = null;
                setIsRecording(false);

                if (!blob.size) {
                    toast.error("No audio captured. Please try again.");
                    return;
                }

                const file = new File(
                    [blob],
                    `voice-note-${Date.now()}.${extensionForAudioMimeType(recorderMimeType)}`,
                    { type: recorderMimeType }
                );

                setSending(true);
                try {
                    await Promise.resolve(onSendMedia(file, ""));
                } catch (err) {
                    console.error("Voice note send failed", err);
                    toast.error("Failed to send voice note");
                } finally {
                    setSending(false);
                }
            };

            recorder.start();
            setIsRecording(true);
        } catch (err) {
            console.error("Unable to start audio recording", err);
            toast.error("Microphone access denied or unavailable.");
            stopRecorderTracks();
            mediaRecorderRef.current = null;
            setIsRecording(false);
        }
    };

    const handleAiDraft = async (instructionOverride?: string) => {
        if (!onGenerateDraft || generatingDraft) return;
        setGeneratingDraft(true);
        try {
            // Pass instruction (override or current draft)
            const instruction = instructionOverride || draft.trim();
            const modelOverride = hasUserSelectedModel ? selectedModel : undefined;
            const text = await onGenerateDraft(instruction, modelOverride);

            if (text) {
                // REPLACE content (per user request) instead of appending
                // Also ensures we don't duplicate the instruction if the AI repeated it
                setDraft(text);
            }
        } catch (e) {
            console.error("Draft generation failed", e);
        } finally {
            setGeneratingDraft(false);
        }
    };

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

    const isWhatsAppDisabled = whatsAppEligibility.status === 'ineligible';
    const isSmsDisabled = smsEligibility.status === 'ineligible';
    const channelSelectorTitle =
        selectedChannel === 'SMS' && isSmsDisabled
            ? (smsEligibility.reason || 'SMS not available for this contact')
            : isWhatsAppDisabled
                ? (whatsAppEligibility.reason || 'WhatsApp not available for this contact')
                : undefined;

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
                    {conversation.lastMessageType === 'TYPE_WHATSAPP' && onSync && (
                        <Button variant="ghost" size="icon" onClick={onSync} title="Sync WhatsApp History">
                            <RefreshCw className="h-4 w-4 text-gray-500" />
                        </Button>
                    )}
                    {(conversation.type === 'Email' || conversation.lastMessageType === 'TYPE_EMAIL') && onFetchHistory && (
                        <Button variant="ghost" size="icon" onClick={onFetchHistory} title="Fetch Gmail History">
                            <RefreshCw className="h-4 w-4 text-gray-500" />
                        </Button>
                    )}
                </div>
            </div>

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

                {messages.map((m) => (
                    <MessageBubble
                        key={m.id}
                        message={m}
                        contactPhone={conversation.contactPhone}
                        contactEmail={conversation.contactEmail}
                        contactName={conversation.contactName}
                        onRefetchMedia={onRefetchMedia}
                        aiModel={selectedModel}
                        selectionBatch={selectionBatch}
                        onAddSelectionToBatch={handleAddSelectionToBatch}
                        onRemoveSelectionBatchItem={handleRemoveSelectionBatchItem}
                        onClearSelectionBatch={handleClearSelectionBatch}
                    />
                ))}
            </div>

            {/* Input Area */}
            <div className="border-t bg-white">
                {/* Suggestions Area - Renders if suggestions exist */}
                <SuggestionBubbles
                    suggestions={suggestions}
                    onSelect={(text) => handleAiDraft(text)}
                />

                <div className="px-3 py-2 max-w-4xl mx-auto">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,audio/*"
                        className="hidden"
                        onChange={handleMediaSelected}
                    />
                    <div className="relative rounded-xl border bg-white shadow-sm focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-300 transition-all">
                        <Textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            placeholder={getPlaceholderText(selectedChannel)}
                            className="min-h-[36px] max-h-[200px] w-full resize-none border-0 focus-visible:ring-0 bg-transparent py-2.5 px-3 text-sm"
                            style={{ height: draft ? 'auto' : '36px' }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                    handleSend();
                                }
                            }}
                        />
                        {/* Inline Toolbar */}
                        <div className="flex items-center justify-between px-2 pb-1.5 gap-1">
                            <div className="flex items-center gap-1">
                                {/* Channel Selector */}
                                <Select
                                    value={selectedChannel}
                                    onValueChange={(v: 'SMS' | 'Email' | 'WhatsApp') => {
                                        if (v === 'SMS' && isSmsDisabled) return;
                                        if (v === 'WhatsApp' && isWhatsAppDisabled) return;
                                        setSelectedChannel(v);
                                    }}
                                >
                                    <SelectTrigger
                                        className="h-7 w-auto min-w-[85px] text-[11px] border-0 bg-slate-50 hover:bg-slate-100 focus:ring-0 px-2"
                                        title={channelSelectorTitle}
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="SMS" className="text-xs" disabled={isSmsDisabled}>SMS</SelectItem>
                                        <SelectItem value="Email" className="text-xs">Email</SelectItem>
                                        <SelectItem value="WhatsApp" className="text-xs" disabled={isWhatsAppDisabled}>WhatsApp</SelectItem>
                                    </SelectContent>
                                </Select>

                                {/* AI Toolbar */}
                                {onGenerateDraft && (
                                    <>
                                        <div className="w-px h-4 bg-slate-200" />
                                        <Select
                                            value={selectedModel}
                                            onValueChange={(value) => {
                                                hasUserSelectedModelRef.current = true;
                                                setHasUserSelectedModel(true);
                                                setSelectedModel(value);
                                            }}
                                        >
                                            <SelectTrigger className="h-7 w-[110px] text-[11px] border-0 bg-slate-50 hover:bg-slate-100 focus:ring-0 px-2">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {(availableModels.length > 0 ? availableModels : GOOGLE_AI_MODELS).map(m => (
                                                    <SelectItem key={m.value} value={m.value} className="text-xs">
                                                        {m.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleAiDraft()}
                                            disabled={generatingDraft}
                                            className="h-7 text-[11px] font-medium text-purple-600 hover:text-purple-700 hover:bg-purple-50 gap-1 px-2"
                                        >
                                            {generatingDraft ? (
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : (
                                                <Sparkles className="w-3 h-3" />
                                            )}
                                            {generatingDraft ? "..." : "AI"}
                                        </Button>
                                    </>
                                )}
                            </div>

                            <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-slate-400 hidden sm:inline">⌘↵</span>
                                {selectedChannel === 'WhatsApp' && onSendMedia && (
                                    <>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 w-7 p-0 text-slate-500 hover:text-slate-700"
                                            onClick={handleMediaPickClick}
                                            title="Send media"
                                            disabled={sending || isRecording}
                                        >
                                            <Paperclip className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className={cn(
                                                "h-7 w-7 p-0",
                                                isRecording
                                                    ? "text-red-600 hover:text-red-700"
                                                    : "text-slate-500 hover:text-slate-700"
                                            )}
                                            onClick={handleRecordToggle}
                                            title={isRecording ? "Stop recording and send voice note" : "Record voice note"}
                                            disabled={sending}
                                        >
                                            {isRecording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                                        </Button>
                                    </>
                                )}
                                {selectedChannel === 'SMS' && draft.length > 0 && (
                                    <span className="text-[10px] text-slate-400">{draft.length}</span>
                                )}
                                <Button
                                    size="sm"
                                    className={cn(
                                        "h-7 rounded-lg px-3 transition-all duration-150",
                                        draft.trim() ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                                    )}
                                    onClick={handleSend}
                                    disabled={sending || isRecording || !draft.trim()}
                                >
                                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
