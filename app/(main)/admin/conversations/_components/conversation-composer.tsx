import { useEffect, useRef, useState } from "react";
import { Conversation } from "@/lib/ghl/conversations";
import {
    getReplyLanguageLabel,
    normalizeReplyLanguage,
    REPLY_LANGUAGE_AUTO_VALUE,
    REPLY_LANGUAGE_OPTIONS,
} from "@/lib/ai/reply-language-options";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, ChevronsUpDown, Loader2, Send, Paperclip, Mic, Square, Sparkles } from "lucide-react";
import { SuggestionBubbles } from "./suggestion-bubbles";
import { AiModelSelect } from "@/components/ai/ai-model-select";
import {
    getSmsChannelEligibility,
    getWhatsAppChannelEligibility,
} from "@/app/(main)/admin/conversations/actions";
import { useAiModelCatalog } from "@/components/ai/use-ai-model-catalog";
import { toast } from "sonner";

type ComposerChannel = "SMS" | "Email" | "WhatsApp";

type WhatsAppEligibilityState =
    | { status: "checking" }
    | { status: "eligible" }
    | { status: "ineligible"; reason?: string }
    | { status: "unknown"; reason?: string };

type SmsEligibilityState =
    | { status: "checking" }
    | { status: "eligible" }
    | { status: "ineligible"; reason?: string }
    | { status: "unknown"; reason?: string };

interface ConversationComposerProps {
    conversation: Conversation | null;
    onSendMessage: (text: string, type: ComposerChannel) => void | Promise<void>;
    onSendMedia?: (file: File, caption: string) => void | Promise<void>;
    onGenerateDraft?: (
        instruction?: string,
        model?: string,
        replyLanguage?: string | null,
        onChunk?: (chunk: string) => void
    ) => Promise<string | null>;
    onSetReplyLanguageOverride?: (replyLanguage: string | null) => Promise<{ success: boolean; error?: string; replyLanguageOverride?: string | null }>;
    suggestions?: string[];
    disabled?: boolean;
    disabledReason?: string;
    replyingToLabel?: string;
    onModelChange?: (model: string) => void;
    insertDraftSeed?: { key: string; body: string } | null;
}

function getInitialChannel(conversation: Conversation | null): ComposerChannel {
    const typeUpper = (conversation?.lastMessageType || conversation?.type || "").toUpperCase();
    if (typeUpper.includes("EMAIL")) return "Email";
    if (typeUpper.includes("WHATSAPP")) return "WhatsApp";
    return "SMS";
}

function getPlaceholderText(channel: ComposerChannel): string {
    const channelHints: Record<ComposerChannel, string> = {
        WhatsApp: "Message or AI instruction...",
        Email: "Email or AI instruction...",
        SMS: "Text or AI instruction...",
    };
    return channelHints[channel] || channelHints.SMS;
}

function getFallbackChannelWithoutWhatsApp(conversation: Conversation | null): "SMS" | "Email" {
    return getInitialChannel(conversation) === "Email" ? "Email" : "SMS";
}

export function ConversationComposer({
    conversation,
    onSendMessage,
    onSendMedia,
    onGenerateDraft,
    onSetReplyLanguageOverride,
    suggestions = [],
    disabled = false,
    disabledReason,
    replyingToLabel,
    onModelChange,
    insertDraftSeed,
}: ConversationComposerProps) {
    const [draft, setDraft] = useState("");
    const [sending, setSending] = useState(false);
    const [generatingDraft, setGeneratingDraft] = useState(false);
    const [selectedChannel, setSelectedChannel] = useState<ComposerChannel>(getInitialChannel(conversation));
    const [selectedModel, setSelectedModel] = useState("");
    const [hasUserSelectedModel, setHasUserSelectedModel] = useState(false);
    const { models: availableModels, resolveModelForKind } = useAiModelCatalog();
    const [selectedReplyLanguage, setSelectedReplyLanguage] = useState<string>(
        conversation?.replyLanguageOverride || REPLY_LANGUAGE_AUTO_VALUE
    );
    const [replyLanguageOpen, setReplyLanguageOpen] = useState(false);
    const [savingReplyLanguage, setSavingReplyLanguage] = useState(false);
    const [whatsAppEligibility, setWhatsAppEligibility] = useState<WhatsAppEligibilityState>({ status: "checking" });
    const [smsEligibility, setSmsEligibility] = useState<SmsEligibilityState>({ status: "checking" });
    const [isRecording, setIsRecording] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const mediaChunksRef = useRef<Blob[]>([]);
    const hasUserSelectedModelRef = useRef(false);

    const isUnavailable = disabled || !conversation;

    useEffect(() => {
        onModelChange?.(selectedModel);
    }, [selectedModel, onModelChange]);

    useEffect(() => {
        if (hasUserSelectedModelRef.current) return;
        const preferredModel = resolveModelForKind("general") || resolveModelForKind("draft");
        if (!preferredModel) return;
        setSelectedModel(preferredModel);
    }, [resolveModelForKind]);

    useEffect(() => {
        setSelectedChannel(getInitialChannel(conversation));
        setDraft("");
        setIsRecording(false);
        setSelectedReplyLanguage(conversation?.replyLanguageOverride || REPLY_LANGUAGE_AUTO_VALUE);
    }, [conversation?.id]);

    useEffect(() => {
        if (!insertDraftSeed?.key) return;
        const nextBody = String(insertDraftSeed.body || "");
        setDraft(nextBody);
    }, [insertDraftSeed?.key, insertDraftSeed?.body]);

    useEffect(() => {
        setSelectedReplyLanguage(conversation?.replyLanguageOverride || REPLY_LANGUAGE_AUTO_VALUE);
    }, [conversation?.replyLanguageOverride]);

    useEffect(() => {
        if (!conversation?.id) {
            setWhatsAppEligibility({ status: "unknown", reason: "No conversation selected." });
            return;
        }

        let cancelled = false;
        setWhatsAppEligibility({ status: "checking" });

        getWhatsAppChannelEligibility(conversation.id)
            .then((res) => {
                if (cancelled) return;

                if (!res?.success) {
                    setWhatsAppEligibility({ status: "unknown", reason: res?.reason });
                    return;
                }

                if (res.status === "eligible") {
                    setWhatsAppEligibility({ status: "eligible" });
                    return;
                }

                if (res.status === "ineligible") {
                    setWhatsAppEligibility({ status: "ineligible", reason: res.reason });
                    setSelectedChannel((prev) => (prev === "WhatsApp" ? getFallbackChannelWithoutWhatsApp(conversation) : prev));
                    return;
                }

                setWhatsAppEligibility({ status: "unknown", reason: res.reason });
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("Failed to check WhatsApp eligibility:", err);
                setWhatsAppEligibility({ status: "unknown", reason: "Could not verify WhatsApp availability." });
            });

        return () => {
            cancelled = true;
        };
    }, [conversation?.id]);

    useEffect(() => {
        if (!conversation?.id) {
            setSmsEligibility({ status: "unknown", reason: "No conversation selected." });
            return;
        }

        let cancelled = false;
        setSmsEligibility({ status: "checking" });

        getSmsChannelEligibility(conversation.id)
            .then((res) => {
                if (cancelled) return;

                if (!res?.success) {
                    setSmsEligibility({ status: "unknown", reason: res?.reason });
                    return;
                }

                if (res.status === "eligible") {
                    setSmsEligibility({ status: "eligible" });
                    return;
                }

                if (res.status === "ineligible") {
                    setSmsEligibility({ status: "ineligible", reason: res.reason });
                    setSelectedChannel((prev) => (prev === "SMS" ? "Email" : prev));
                    return;
                }

                setSmsEligibility({ status: "unknown", reason: res.reason });
            })
            .catch((err) => {
                if (cancelled) return;
                console.error("Failed to check SMS eligibility:", err);
                setSmsEligibility({ status: "unknown", reason: "Could not verify SMS availability." });
            });

        return () => {
            cancelled = true;
        };
    }, [conversation?.id]);

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
                // ignore recorder stop race on unmount
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

    const handleSend = async () => {
        if (isUnavailable || isRecording || !draft.trim()) return;
        setSending(true);
        try {
            await Promise.resolve(onSendMessage(draft, selectedChannel));
            setDraft("");
        } finally {
            setSending(false);
        }
    };

    const handleMediaPickClick = () => {
        if (isUnavailable || selectedChannel !== "WhatsApp" || !onSendMedia) return;
        fileInputRef.current?.click();
    };

    const handleMediaSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !onSendMedia || isUnavailable) return;

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
        if (isUnavailable || selectedChannel !== "WhatsApp" || !onSendMedia || sending) return;

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
        if (!onGenerateDraft || generatingDraft || isUnavailable) return;
        setGeneratingDraft(true);
        try {
            const instruction = instructionOverride || draft.trim();
            const modelOverride = hasUserSelectedModel ? selectedModel : undefined;
            const replyLanguageOverride = selectedReplyLanguage === REPLY_LANGUAGE_AUTO_VALUE
                ? null
                : selectedReplyLanguage;
            let streamedBuffer = "";
            const text = await onGenerateDraft(
                instruction,
                modelOverride,
                replyLanguageOverride,
                (chunk) => {
                    if (!chunk) return;
                    streamedBuffer += chunk;
                    setDraft(streamedBuffer);
                }
            );
            if (text) {
                setDraft(text);
            } else if (streamedBuffer) {
                setDraft(streamedBuffer);
            }
        } catch (e) {
            console.error("Draft generation failed", e);
        } finally {
            setGeneratingDraft(false);
        }
    };

    const handleReplyLanguageSelect = async (value: string) => {
        const nextSelection = value || REPLY_LANGUAGE_AUTO_VALUE;
        setReplyLanguageOpen(false);
        if (isUnavailable || !conversation || !onSetReplyLanguageOverride || savingReplyLanguage) return;

        const previousSelection = selectedReplyLanguage || REPLY_LANGUAGE_AUTO_VALUE;
        const normalizedReplyLanguage = normalizeReplyLanguage(nextSelection);

        setSelectedReplyLanguage(nextSelection);
        setSavingReplyLanguage(true);
        try {
            const result = await onSetReplyLanguageOverride(normalizedReplyLanguage);
            if (!result?.success) {
                setSelectedReplyLanguage(previousSelection);
                toast.error(result?.error || "Failed to save reply language.");
                return;
            }
            setSelectedReplyLanguage(result.replyLanguageOverride || REPLY_LANGUAGE_AUTO_VALUE);
        } catch (error: any) {
            setSelectedReplyLanguage(previousSelection);
            toast.error(error?.message || "Failed to save reply language.");
        } finally {
            setSavingReplyLanguage(false);
        }
    };

    const selectedReplyLanguageLabel = selectedReplyLanguage === REPLY_LANGUAGE_AUTO_VALUE
        ? "Reply: Auto"
        : `Reply: ${getReplyLanguageLabel(selectedReplyLanguage) || selectedReplyLanguage}`;
    const replyLanguageSourceHint = selectedReplyLanguage !== REPLY_LANGUAGE_AUTO_VALUE
        ? `Source: Conversation override (${getReplyLanguageLabel(selectedReplyLanguage) || selectedReplyLanguage})`
        : conversation?.contactPreferredLanguage
            ? `Source: Contact default (${getReplyLanguageLabel(conversation.contactPreferredLanguage) || conversation.contactPreferredLanguage})`
            : "Source: Auto-detected";

    const isWhatsAppDisabled = whatsAppEligibility.status === "ineligible";
    const isSmsDisabled = smsEligibility.status === "ineligible";
    const channelSelectorTitle =
        selectedChannel === "SMS" && isSmsDisabled
            ? (smsEligibility.reason || "SMS not available for this contact")
            : isWhatsAppDisabled
                ? (whatsAppEligibility.reason || "WhatsApp not available for this contact")
                : undefined;

    return (
        <div className="border-t bg-white pb-[env(safe-area-inset-bottom)]" data-no-pane-swipe>
            <SuggestionBubbles
                suggestions={suggestions}
                onSelect={(text) => handleAiDraft(text)}
            />

            <div className="px-3 py-2 max-w-4xl mx-auto min-w-0">
                {replyingToLabel ? (
                    <div className="px-1 pb-1 text-[11px] text-slate-500">
                        Replying to <span className="font-medium text-slate-700">{replyingToLabel}</span>
                    </div>
                ) : null}

                {isUnavailable && (
                    <div className="px-1 pb-1 text-[11px] text-amber-700">
                        {disabledReason || "Composer unavailable until a contact is selected."}
                    </div>
                )}

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,audio/*"
                    className="hidden"
                    onChange={handleMediaSelected}
                />

                <div className="relative rounded-xl border bg-white shadow-sm focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-300 transition-all min-w-0">
                    <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={getPlaceholderText(selectedChannel)}
                        className="min-h-[36px] max-h-[200px] w-full resize-none border-0 focus-visible:ring-0 bg-transparent py-2.5 px-3 text-sm"
                        style={{ height: draft ? "auto" : "36px" }}
                        disabled={isUnavailable || sending || isRecording}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                handleSend();
                            }
                        }}
                    />

                    <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5 sm:flex-nowrap sm:justify-between">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 sm:flex-nowrap">
                            <Select
                                value={selectedChannel}
                                onValueChange={(v: ComposerChannel) => {
                                    if (isUnavailable) return;
                                    if (v === "SMS" && isSmsDisabled) return;
                                    if (v === "WhatsApp" && isWhatsAppDisabled) return;
                                    setSelectedChannel(v);
                                }}
                                disabled={isUnavailable}
                            >
                                <SelectTrigger
                                    className="h-7 w-[78px] sm:w-auto sm:min-w-[85px] text-[11px] border-0 bg-slate-50 hover:bg-slate-100 focus:ring-0 px-2"
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

                            {onGenerateDraft && (
                                <>
                                    <div className="w-px h-4 bg-slate-200" />
                                    <AiModelSelect
                                        value={selectedModel}
                                        onValueChange={(value) => {
                                            hasUserSelectedModelRef.current = true;
                                            setHasUserSelectedModel(true);
                                            setSelectedModel(value);
                                        }}
                                        disabled={isUnavailable}
                                        triggerClassName="h-7 w-[94px] sm:w-[110px] text-[11px] border-0 bg-slate-50 hover:bg-slate-100 focus:ring-0 px-2"
                                        itemClassName="text-xs"
                                        models={availableModels}
                                    />
                                    <Popover open={replyLanguageOpen} onOpenChange={setReplyLanguageOpen}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="h-7 w-[118px] sm:w-[144px] justify-between text-[11px] border-0 bg-slate-50 hover:bg-slate-100 px-2"
                                                disabled={isUnavailable || !onSetReplyLanguageOverride || savingReplyLanguage}
                                            >
                                                <span className="truncate">{selectedReplyLanguageLabel}</span>
                                                {savingReplyLanguage ? (
                                                    <Loader2 className="ml-1 h-3 w-3 animate-spin shrink-0" />
                                                ) : (
                                                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-60" />
                                                )}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[240px] p-0" align="start">
                                            <Command>
                                                <CommandInput placeholder="Search language..." />
                                                <CommandList>
                                                    <CommandEmpty>No language found.</CommandEmpty>
                                                    <CommandGroup>
                                                        <CommandItem
                                                            value={`auto ${REPLY_LANGUAGE_AUTO_VALUE}`}
                                                            onSelect={() => handleReplyLanguageSelect(REPLY_LANGUAGE_AUTO_VALUE)}
                                                        >
                                                            <Check className={cn("mr-2 h-3.5 w-3.5", selectedReplyLanguage === REPLY_LANGUAGE_AUTO_VALUE ? "opacity-100" : "opacity-0")} />
                                                            Auto (detect from conversation)
                                                        </CommandItem>
                                                        {REPLY_LANGUAGE_OPTIONS.map((option) => (
                                                            <CommandItem
                                                                key={option.value}
                                                                value={`${option.label} ${option.value}`}
                                                                onSelect={() => handleReplyLanguageSelect(option.value)}
                                                            >
                                                                <Check className={cn("mr-2 h-3.5 w-3.5", selectedReplyLanguage === option.value ? "opacity-100" : "opacity-0")} />
                                                                {option.label}
                                                            </CommandItem>
                                                        ))}
                                                    </CommandGroup>
                                                </CommandList>
                                            </Command>
                                        </PopoverContent>
                                    </Popover>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleAiDraft()}
                                        disabled={isUnavailable || generatingDraft}
                                        className="h-7 text-[11px] font-medium text-purple-600 hover:text-purple-700 hover:bg-purple-50 gap-1 px-1.5 sm:px-2"
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

                        <div className="ml-auto flex w-full items-center justify-end gap-1.5 sm:w-auto">
                            <span className="text-[10px] text-slate-400 hidden sm:inline">⌘↵</span>
                            {selectedChannel === "WhatsApp" && onSendMedia && (
                                <>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 w-7 p-0 text-slate-500 hover:text-slate-700"
                                        onClick={handleMediaPickClick}
                                        title="Send media"
                                        disabled={isUnavailable || sending || isRecording}
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
                                        disabled={isUnavailable || sending}
                                    >
                                        {isRecording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                                    </Button>
                                </>
                            )}
                            {selectedChannel === "SMS" && draft.length > 0 && (
                                <span className="text-[10px] text-slate-400">{draft.length}</span>
                            )}
                            <Button
                                size="sm"
                                className={cn(
                                    "h-7 rounded-lg px-3 transition-all duration-150",
                                    draft.trim() ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                                )}
                                onClick={handleSend}
                                disabled={isUnavailable || sending || isRecording || !draft.trim()}
                            >
                                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                            </Button>
                        </div>
                    </div>
                </div>
                {onGenerateDraft && (
                    <div className="px-1 pt-1 text-[10px] text-slate-500">
                        {replyLanguageSourceHint}
                    </div>
                )}
            </div>
        </div>
    );
}
