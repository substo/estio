import { useEffect, useRef, useState } from "react";
import { Conversation } from "@/lib/ghl/conversations";
import {
    REPLY_LANGUAGE_AUTO_VALUE,
    REPLY_LANGUAGE_OPTIONS,
} from "@/lib/ai/reply-language-options";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarClock, Check, ChevronsUpDown, Loader2, Send, Paperclip, Mic, Square, Sparkles, Wand2, PhoneOutgoing, X, RotateCcw, MessageSquare, NotebookPen, ShieldCheck } from "lucide-react";
import { SuggestionBubbles } from "./suggestion-bubbles";
import { AiModelSelect } from "@/components/ai/ai-model-select";
import { getSmsSegmentInfo } from "@/lib/sms/segments";
import { languagesMatch } from "@/lib/conversations/language-context";
import {
    type ComposerChannel,
    useConversationComposerTranslationPreview,
} from "./use-conversation-composer-translation-preview";
import { useConversationComposerChannel } from "./use-conversation-composer-channel";
import { useConversationComposerMedia } from "./use-conversation-composer-media";
import { useConversationComposerAiDraft } from "./use-conversation-composer-ai-draft";
import { useConversationComposerSend } from "./use-conversation-composer-send";
import {
    getConversationComposerContentClassName,
    getConversationSurfaceTheme,
    type ConversationSurfaceTheme,
} from "./message-bubble-theme";
import { PropertyMessageAssist } from "./property-message-assist";
import type { ComposerAiDraftFeedback, GenerateDraftResult } from "./conversation-draft-generation";
import { buildComposerSuggestionBubbles } from "./conversation-composer-suggestions";
import { useChatWindowActivityNote } from "./use-chat-window-activity-note";

interface ConversationComposerProps {
    conversation: Conversation | null;
    draft: string;
    onDraftChange: (draft: string) => void;
    onDraftClear: () => void;
    onSendMessage: (
        text: string,
        type: ComposerChannel,
        options?: {
            translationSourceText?: string | null;
            translationTargetLanguage?: string | null;
            translationDetectedSourceLanguage?: string | null;
            agentFeedback?: ComposerAiDraftFeedback & { humanOutput: string };
        }
    ) => void | Promise<void>;
    onScheduleMessage?: (args: {
        body: string;
        channel: ComposerChannel;
        scheduledFor: string;
        scheduledTimeZone?: string | null;
        scheduledLocal?: string | null;
    }) => Promise<{ success: boolean; error?: string } | void> | void;
    onSendMedia?: (file: File, caption: string) => void | Promise<void>;
    onGenerateDraft?: (
        instruction?: string,
        model?: string,
        draftLanguage?: string | null,
        baseDraft?: string | null,
        channel?: ComposerChannel | null,
        onChunk?: (chunk: string) => void
    ) => Promise<GenerateDraftResult | null>;
    onSetReplyLanguageOverride?: (replyLanguage: string | null) => Promise<{ success: boolean; error?: string; replyLanguageOverride?: string | null }>;
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
    translationWriteEnabled?: boolean;
    suggestions?: string[];
    disabled?: boolean;
    disabledReason?: string;
    replyingToLabel?: string;
    onModelChange?: (model: string) => void;
    insertDraftSeed?: { key: string; body: string } | null;
    translationTargetLanguageLabel?: string | null;
    viewingLanguageLabel?: string | null;
    smsRelayEnabled?: boolean;
    surfaceTheme?: ConversationSurfaceTheme;
    onSelectedChannelChange?: (channel: ComposerChannel) => void;
    onAddActivityEntry?: (entryText: string, dateIso: string) => Promise<void>;
    suggestedResponseCount?: number;
    suggestedResponsesCollapsed?: boolean;
    onToggleSuggestedResponses?: () => void;
}

function getPlaceholderText(channel: ComposerChannel): string {
    const channelHints: Record<ComposerChannel, string> = {
        WhatsApp: "Write a WhatsApp message...",
        Email: "Write an email...",
        SMS: "Write a text message...",
        SMS_RELAY: "Write an Android SMS...",
    };
    return channelHints[channel] || channelHints.SMS;
}

const EMPTY_COMPOSER_HEIGHT_PX = 36;
const DRAFT_COMPOSER_MIN_ROWS = 1;
const MOBILE_COMPOSER_MAX_VIEWPORT_RATIO = 0.32;
const MOBILE_COMPOSER_MAX_HEIGHT_PX = 188;
const DESKTOP_COMPOSER_MAX_HEIGHT_PX = 320;
const EMPTY_AI_INSTRUCTION = "";

const CREATE_DRAFT_ACTIONS = [
    "Best next reply",
    "Short and direct",
    "Ask for budget",
    "Confirm viewing",
    "Send property options",
];

const REFINE_DRAFT_ACTIONS = [
    "Make conversational",
    "Short and direct",
    "Warmer",
    "More formal",
    "Fix grammar",
    "Add next step",
];

const AI_DRAFT_SKILL_LABELS: Record<string, string> = {
    lead_intake_booking: "Lead intake",
    lead_qualification: "Qualification",
    viewing_management: "Viewing",
    property_search: "Property search",
    objection_handler: "Objection",
    negotiator: "Negotiation",
    closer: "Closing",
};

function toDatetimeLocalValue(date: Date) {
    const pad = (value: number) => String(value).padStart(2, "0");
    return [
        date.getFullYear(),
        "-",
        pad(date.getMonth() + 1),
        "-",
        pad(date.getDate()),
        "T",
        pad(date.getHours()),
        ":",
        pad(date.getMinutes()),
    ].join("");
}

function getDefaultScheduleLocalValue() {
    const date = new Date(Date.now() + 60 * 60 * 1000);
    date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0);
    return toDatetimeLocalValue(date);
}

function getScheduleTimingWarning(localValue: string) {
    const date = new Date(localValue);
    if (!Number.isFinite(date.getTime())) return null;
    const diffMs = date.getTime() - Date.now();
    if (diffMs <= 0) return "Choose a future date and time.";
    if (diffMs < 5 * 60 * 1000) return "This is scheduled within the next few minutes.";
    return null;
}

function formatAiDraftSkillLabel(skillId?: string | null) {
    const normalized = String(skillId || "").trim();
    if (!normalized) return "AI runtime";
    return AI_DRAFT_SKILL_LABELS[normalized] || normalized.replace(/[_-]+/g, " ");
}

function formatAiDraftRouteReason(reason?: string | null) {
    const normalized = String(reason || "").trim();
    if (!normalized) return null;
    return normalized.replace(/[_-]+/g, " ");
}

type WhatsAppCallUiPhase =
    | "starting"
    | "offer_sent"
    | "ringing"
    | "accepted"
    | "ended"
    | "failed"
    | "waiting";

type WhatsAppCallUiState = {
    phase: WhatsAppCallUiPhase;
    label: string;
    detail: string;
    callAttemptId?: string | null;
    bridgeCallId?: string | null;
    whatsappCallId?: string | null;
    fallbackCallLink?: string | null;
    startedAt: number;
    updatedAt?: string | null;
};

const TERMINAL_WHATSAPP_CALL_PHASES = new Set<WhatsAppCallUiPhase>(["accepted", "ended", "failed"]);
const WHATSAPP_CALL_WAITING_AFTER_MS = 25_000;

function mapWhatsAppCallPayloadToState(
    payload: any,
    previous?: WhatsAppCallUiState | null
): WhatsAppCallUiState {
    const call = payload?.call || payload || {};
    const rawStatus = String(call.status || payload?.status || "").toLowerCase();
    const rawEvent = String(call.bridgeEvent || payload?.bridgeEvent || call.event || payload?.event || "").toLowerCase();
    const errorMessage = call.errorMessage || payload?.errorMessage || payload?.error || null;
    const bridgeCallId = call.bridgeCallId || payload?.bridgeCallId || null;
    const whatsappCallId = call.whatsappCallId || payload?.whatsappCallId || payload?.providerCallId || null;
    const callAttemptId = call.id || payload?.callAttemptId || payload?.attemptId || previous?.callAttemptId || null;
    const mediaStatus = call.mediaStatus || payload?.mediaStatus || null;
    const fallbackCallLink = call.fallbackCallLink || payload?.fallbackCallLink || payload?.bridgeCall?.fallbackCallLink || previous?.fallbackCallLink || null;
    const startedAt = previous?.startedAt || Date.now();
    let phase: WhatsAppCallUiPhase = "offer_sent";
    let label = "WhatsApp call offer sent";
    let detail = "Waiting for WhatsApp to report ringing.";

    if (rawStatus === "accepted" || rawEvent === "call_accepted" || rawEvent === "call_media_connected") {
        phase = "accepted";
        label = "WhatsApp call accepted";
        detail = mediaStatus === "audio_connected"
            ? "Audio is connected."
            : "The customer accepted. Waiting for the configured Calling API media path.";
    } else if (rawStatus === "ended" || rawEvent === "call_terminated") {
        phase = "ended";
        label = "WhatsApp call ended";
        detail = "The call lifecycle ended.";
    } else if (rawStatus === "rejected" || rawEvent === "call_rejected") {
        phase = "failed";
        label = "WhatsApp call rejected";
        detail = "The customer or WhatsApp rejected the offer.";
    } else if (rawStatus === "failed" || rawEvent === "call_failed" || rawEvent === "call_timeout" || rawEvent === "call_media_unknown" || errorMessage) {
        phase = "failed";
        label = rawEvent === "call_media_unknown"
            ? "Direct WhatsApp call did not ring"
            : rawEvent === "call_timeout"
                ? "WhatsApp call timed out"
                : "WhatsApp call failed";
        detail = errorMessage || (rawEvent === "call_media_unknown"
            ? "The provider returned a WhatsApp call id, but WhatsApp did not report ringing."
            : "The provider did not complete the call offer.");
    } else if (rawEvent === "call_ringing" || rawStatus === "ringing") {
        phase = "ringing";
        label = "WhatsApp call ringing";
        detail = "Waiting for the customer to answer or reject.";
    } else if (rawEvent === "call_offer_sent" || rawStatus === "call_attempted") {
        phase = "offer_sent";
        label = "WhatsApp call offer sent";
        detail = "Waiting for WhatsApp to report ringing. Microphone is not requested until real audio is wired.";
    }

    return {
        phase,
        label,
        detail,
        callAttemptId,
        bridgeCallId,
        whatsappCallId,
        fallbackCallLink,
        startedAt,
        updatedAt: call.updatedAt || payload?.updatedAt || null,
    };
}

function resizeComposerTextarea(textarea: HTMLTextAreaElement | null, hasDraft: boolean) {
    if (!textarea) return;
    if (typeof window === "undefined") return;

    textarea.style.height = "auto";

    if (!hasDraft) {
        textarea.style.height = `${EMPTY_COMPOSER_HEIGHT_PX}px`;
        textarea.style.overflowY = "hidden";
        return;
    }

    const computed = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 24;
    const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
    const contentMinHeight = Math.ceil((lineHeight * DRAFT_COMPOSER_MIN_ROWS) + paddingTop + paddingBottom);
    const minHeight = Math.max(EMPTY_COMPOSER_HEIGHT_PX, contentMinHeight);
    const mobileViewportMax = Math.floor(window.innerHeight * MOBILE_COMPOSER_MAX_VIEWPORT_RATIO);
    const maxHeight = window.innerWidth < 640
        ? Math.max(minHeight, Math.min(MOBILE_COMPOSER_MAX_HEIGHT_PX, mobileViewportMax))
        : Math.max(minHeight, DESKTOP_COMPOSER_MAX_HEIGHT_PX);
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, textarea.scrollHeight));

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > nextHeight ? "auto" : "hidden";
}

export function ConversationComposer({
    conversation,
    draft,
    onDraftChange,
    onDraftClear,
    onSendMessage,
    onScheduleMessage,
    onSendMedia,
    onGenerateDraft,
    onSetReplyLanguageOverride,
    onPreviewTranslatedReply,
    translationWriteEnabled = false,
    suggestions = [],
    disabled = false,
    disabledReason,
    replyingToLabel,
    onModelChange,
    insertDraftSeed,
    translationTargetLanguageLabel,
    viewingLanguageLabel,
    smsRelayEnabled = false,
    surfaceTheme,
    onSelectedChannelChange,
    onAddActivityEntry,
    suggestedResponseCount = 0,
    suggestedResponsesCollapsed = false,
    onToggleSuggestedResponses,
}: ConversationComposerProps) {
    const isUnavailable = disabled || !conversation;
    const isRecordingRef = useRef(false);
    const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const composerHasDraft = draft.trim().length > 0;
    const [composerMode, setComposerMode] = useState<"reply" | "note">("reply");
    const [aiDraftOpen, setAiDraftOpen] = useState(false);
    const [aiInstruction, setAiInstruction] = useState(EMPTY_AI_INSTRUCTION);
    const [requestingWhatsAppCall, setRequestingWhatsAppCall] = useState(false);
    const [whatsAppCallRequestError, setWhatsAppCallRequestError] = useState<string | null>(null);
    const [whatsAppCallState, setWhatsAppCallState] = useState<WhatsAppCallUiState | null>(null);
    const [latestAiDraftFeedback, setLatestAiDraftFeedback] = useState<ComposerAiDraftFeedback | null>(null);
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const [scheduleLocal, setScheduleLocal] = useState(() => getDefaultScheduleLocalValue());
    const [scheduleError, setScheduleError] = useState<string | null>(null);
    const [scheduling, setScheduling] = useState(false);
    const {
        selectedChannel,
        selectChannel,
        isWhatsAppDisabled,
        isSmsDisabled,
        isSmsRelayDisabled,
        isEmailDisabled,
        channelSelectorTitle,
        noAvailableChannelReason,
    } = useConversationComposerChannel({
        conversation,
        isUnavailable,
        smsRelayEnabled,
    });
    const {
        generatingDraft,
        selectedModel,
        handleModelChange,
        availableModels,
        selectedReplyLanguage,
        replyLanguageOpen,
        setReplyLanguageOpen,
        savingReplyLanguage,
        handleAiDraft,
        canUndoAiDraft,
        undoAiDraft,
        clearAiDraftState,
        handleReplyLanguageSelect,
        selectedReplyLanguageLabel,
        agentWorkingLanguage,
        resolvedSendLanguage,
        resolvedDraftLanguageLabel,
        resolvedViewingLanguageLabel,
        replyLanguageSourceHint,
        autoTranslateTargetLabel,
    } = useConversationComposerAiDraft({
        conversation,
        draft,
        isUnavailable,
        insertDraftSeed,
        onDraftChange,
        onGenerateDraft,
        selectedChannel,
        onAiDraftFeedbackChange: setLatestAiDraftFeedback,
        onSetReplyLanguageOverride,
        onModelChange,
        translationTargetLanguageLabel,
        viewingLanguageLabel,
    });
    const {
        addNoteText,
        setAddNoteText,
        addNoteDate,
        setAddNoteDate,
        addingNote,
        improvingNote,
        handleAddNote,
        handleImproveNote,
    } = useChatWindowActivityNote({
        conversationId: conversation?.id || "",
        contactId: conversation?.contactId,
        onAddActivityEntry,
    });
    const sendUnavailableReason = disabledReason || noAvailableChannelReason || channelSelectorTitle;
    const isSendUnavailable = isUnavailable || !!noAvailableChannelReason || !!channelSelectorTitle;
    const canScheduleChannel = selectedChannel === "WhatsApp" || selectedChannel === "SMS_RELAY";
    const {
        previewingTranslation,
        translationPreviewText,
        translationPreviewLanguage,
        translationPreviewDetectedSource,
        hasTranslationPreview,
        clearTranslationPreview,
        handlePreviewTranslation,
    } = useConversationComposerTranslationPreview({
        draft,
        isUnavailable: isSendUnavailable,
        selectedChannel,
        selectedReplyLanguage,
        autoReplyLanguageValue: REPLY_LANGUAGE_AUTO_VALUE,
        onPreviewTranslatedReply,
    });
    const canUseWriteTranslation = translationWriteEnabled && !!onPreviewTranslatedReply;
    const {
        sending,
        setSending,
        handleSend,
    } = useConversationComposerSend({
        draft,
        isUnavailable,
        isRecording: isRecordingRef,
        selectedChannel,
        selectedReplyLanguage,
        autoReplyLanguageValue: REPLY_LANGUAGE_AUTO_VALUE,
        resolvedSendLanguage,
        agentWorkingLanguage,
        canUseWriteTranslation,
        translationPreviewText,
        translationPreviewLanguage,
        translationPreviewDetectedSource,
        agentFeedback: latestAiDraftFeedback,
        onPreviewTranslatedReply,
        onSendMessage,
        onDraftClear: () => {
            onDraftClear();
            clearAiDraftState();
        },
        clearTranslationPreview,
    });
    const {
        fileInputRef,
        isRecording,
        setIsRecording,
        handleMediaPickClick,
        handleMediaSelected,
        handleRecordToggle,
    } = useConversationComposerMedia({
        draft,
        isUnavailable,
        selectedChannel,
        sending,
        setSending,
        onSendMedia,
        onDraftClear: () => {
            onDraftClear();
            clearAiDraftState();
        },
    });
    isRecordingRef.current = isRecording;
    const isNoteMode = composerMode === "note" && !!onAddActivityEntry;
    const noteHasDraft = addNoteText.trim().length > 0;
    const textareaValue = isNoteMode ? addNoteText : draft;
    const textareaHasDraft = isNoteMode ? noteHasDraft : composerHasDraft;
    const noteModeShellClassName = "border border-amber-200 bg-amber-50/80 focus-within:ring-2 focus-within:ring-amber-500/20 focus-within:border-amber-300";

    useEffect(() => {
        setIsRecording(false);
        setWhatsAppCallRequestError(null);
        setWhatsAppCallState(null);
        clearTranslationPreview();
    }, [clearTranslationPreview, conversation?.id, setIsRecording]);

    useEffect(() => {
        resizeComposerTextarea(composerTextareaRef.current, textareaHasDraft);
    }, [textareaHasDraft, textareaValue]);

    useEffect(() => {
        const handleResize = () => {
            resizeComposerTextarea(composerTextareaRef.current, textareaHasDraft);
        };

        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [textareaHasDraft]);

    const willAutoTranslate = canUseWriteTranslation
        && !!onPreviewTranslatedReply
        && !languagesMatch(agentWorkingLanguage, resolvedSendLanguage);

    const smsSegmentInfo = getSmsSegmentInfo(draft);
    const showSmsRelaySegmentInfo = selectedChannel === "SMS_RELAY" && draft.length > 0;
    const smsRelaySegmentLabel = `${smsSegmentInfo.segments || 1} SMS part${(smsSegmentInfo.segments || 1) === 1 ? "" : "s"} · ${smsSegmentInfo.remaining} left`;
    const smsRelaySegmentTone = smsSegmentInfo.encoding === "unicode"
        ? "text-amber-700"
        : smsSegmentInfo.segments > 1
            ? "text-slate-500"
            : "text-slate-400";
    const smsRelaySegmentTitle = smsSegmentInfo.encoding === "unicode"
        ? "Unicode characters, emoji, or smart punctuation reduce SMS capacity to 70 characters for one part and 67 per multipart segment."
        : smsSegmentInfo.segments > 1
            ? "This Android SMS will be sent as multipart SMS."
            : "Android SMS segment estimate.";
    const composerContentClassName = getConversationComposerContentClassName();
    const resolvedSurfaceTheme = surfaceTheme || getConversationSurfaceTheme(selectedChannel);
    const aiActionLabel = composerHasDraft ? "Refine" : "Draft";
    const aiCustomPlaceholder = composerHasDraft
        ? "Tell AI how to change this draft..."
        : "Tell AI what to write...";
    const aiQuickActions = composerHasDraft ? REFINE_DRAFT_ACTIONS : CREATE_DRAFT_ACTIONS;
    const visibleSuggestionBubbles = buildComposerSuggestionBubbles(suggestions, aiQuickActions);
    const showSuggestedResponseToggle = suggestedResponseCount > 0 && !!onToggleSuggestedResponses;
    const scheduleTimingWarning = getScheduleTimingWarning(scheduleLocal);

    const runAiDraftCommand = (instruction?: string) => {
        const trimmedInstruction = String(instruction || "").trim();
        const baseDraft = composerHasDraft ? draft : null;
        setAiDraftOpen(false);
        setAiInstruction(EMPTY_AI_INSTRUCTION);
        void handleAiDraft(trimmedInstruction || undefined, baseDraft);
    };

    const handleScheduleDraft = async () => {
        if (!onScheduleMessage || !canScheduleChannel || !draft.trim() || scheduling) return;
        const scheduledDate = new Date(scheduleLocal);
        if (!Number.isFinite(scheduledDate.getTime())) {
            setScheduleError("Choose a valid date and time.");
            return;
        }
        if (scheduledDate.getTime() <= Date.now()) {
            setScheduleError("Choose a future date and time.");
            return;
        }

        setScheduling(true);
        setScheduleError(null);
        try {
            const result = await Promise.resolve(onScheduleMessage({
                body: draft.trim(),
                channel: selectedChannel,
                scheduledFor: scheduledDate.toISOString(),
                scheduledTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
                scheduledLocal,
            }));
            if (result && result.success === false) {
                setScheduleError(result.error || "Could not schedule message.");
                return;
            }
            setScheduleOpen(false);
            setScheduleLocal(getDefaultScheduleLocalValue());
            onDraftClear();
            clearAiDraftState();
            clearTranslationPreview();
        } catch (error) {
            setScheduleError(error instanceof Error ? error.message : "Could not schedule message.");
        } finally {
            setScheduling(false);
        }
    };

    const handleRequestWhatsAppCall = async () => {
        if (!conversation || requestingWhatsAppCall) return;
        setRequestingWhatsAppCall(true);
        setWhatsAppCallRequestError(null);
        setWhatsAppCallState({
            phase: "starting",
            label: "Starting WhatsApp call",
            detail: "Checking the bridge and sending a call offer.",
            startedAt: Date.now(),
        });
        try {
            const response = await fetch("/api/admin/conversations/whatsapp-call/start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    conversationId: conversation.id,
                    contactId: conversation.contactId,
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.errorMessage || payload?.error || "Failed to start WhatsApp call.");
            }
            setWhatsAppCallState((current) => mapWhatsAppCallPayloadToState(payload, current));
        } catch (error) {
            console.error("Failed to start WhatsApp call:", error);
            const message = error instanceof Error ? error.message : "Failed to start WhatsApp call.";
            setWhatsAppCallRequestError(message);
            setWhatsAppCallState((current) => ({
                phase: "failed",
                label: "WhatsApp call failed",
                detail: message,
                startedAt: current?.startedAt || Date.now(),
                callAttemptId: current?.callAttemptId,
                bridgeCallId: current?.bridgeCallId,
                whatsappCallId: current?.whatsappCallId,
            }));
        } finally {
            setRequestingWhatsAppCall(false);
        }
    };

    const handleSendWhatsAppCallLink = async () => {
        const link = String(whatsAppCallState?.fallbackCallLink || "").trim();
        if (!link || sending || isUnavailable) return;
        try {
            setSending(true);
            await onSendMessage(`WhatsApp call link: ${link}`, "WhatsApp");
            setWhatsAppCallState((current) => current
                ? {
                    ...current,
                    label: "WhatsApp call link sent",
                    detail: "Direct ringing was not confirmed, so a WhatsApp call link was sent in this chat.",
                }
                : current
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to send WhatsApp call link.";
            setWhatsAppCallRequestError(message);
        } finally {
            setSending(false);
        }
    };

    useEffect(() => {
        if (!conversation || !whatsAppCallState?.callAttemptId) return;
        if (TERMINAL_WHATSAPP_CALL_PHASES.has(whatsAppCallState.phase)) return;

        let cancelled = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const poll = async () => {
            try {
                const params = new URLSearchParams({ callAttemptId: String(whatsAppCallState.callAttemptId) });
                const response = await fetch(`/api/admin/conversations/whatsapp-call/status?${params.toString()}`);
                const payload = await response.json().catch(() => ({}));
                if (cancelled) return;
                if (response.ok && payload?.success) {
                    setWhatsAppCallState((current) => {
                        if (!current) return mapWhatsAppCallPayloadToState(payload, whatsAppCallState);
                        const next = mapWhatsAppCallPayloadToState(payload, current);
                        if (
                            next.phase === "offer_sent"
                            && Date.now() - current.startedAt > WHATSAPP_CALL_WAITING_AFTER_MS
                        ) {
                            return {
                                ...next,
                                phase: "waiting",
                label: "Call offer sent, no ringing event yet",
                detail: "The provider returned a WhatsApp call id, but no ringing/answer event has arrived.",
            };
                        }
                        return next;
                    });
                }
            } catch {
                if (!cancelled) {
                    setWhatsAppCallState((current) => current
                        ? {
                            ...current,
                            phase: current.phase === "offer_sent" ? "waiting" : current.phase,
                            detail: "Waiting for call status. The status API did not respond quickly.",
                        }
                        : current
                    );
                }
            } finally {
                if (!cancelled) {
                    timeoutId = setTimeout(poll, 2500);
                }
            }
        };

        timeoutId = setTimeout(poll, 1500);
        return () => {
            cancelled = true;
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [conversation, whatsAppCallState?.callAttemptId, whatsAppCallState?.phase]);

    useEffect(() => {
        onSelectedChannelChange?.(selectedChannel);
    }, [onSelectedChannelChange, selectedChannel]);

    return (
        <div className={cn("w-full min-w-0 max-w-full overflow-x-hidden pb-[env(safe-area-inset-bottom)]", resolvedSurfaceTheme.composerContainerClassName)}>
            {!isNoteMode && (
                <SuggestionBubbles
                    suggestions={visibleSuggestionBubbles}
                    onSelect={(text) => handleAiDraft(text === "Best next reply" ? undefined : text)}
                    className={cn(composerContentClassName, "py-1")}
                />
            )}

            <div className={composerContentClassName}>
                {(onAddActivityEntry || showSuggestedResponseToggle) && (
                    <div className="flex items-center gap-1 px-1 pb-1">
                        {onAddActivityEntry && (
                            <>
                                <Button
                                    type="button"
                                    variant={isNoteMode ? "ghost" : "secondary"}
                                    size="sm"
                                    className="h-7 gap-1.5 px-2 text-[11px]"
                                    onClick={() => setComposerMode("reply")}
                                >
                                    <MessageSquare className="h-3.5 w-3.5" />
                                    Reply
                                </Button>
                                <Button
                                    type="button"
                                    variant={isNoteMode ? "secondary" : "ghost"}
                                    size="sm"
                                    className={cn(
                                        "h-7 gap-1.5 px-2 text-[11px]",
                                        isNoteMode && "border-amber-200 bg-amber-100 text-amber-900 hover:bg-amber-100"
                                    )}
                                    onClick={() => {
                                        setComposerMode("note");
                                        window.requestAnimationFrame(() => composerTextareaRef.current?.focus());
                                    }}
                                >
                                    <NotebookPen className="h-3.5 w-3.5" />
                                    Note
                                </Button>
                            </>
                        )}
                        {showSuggestedResponseToggle && (
                            <Button
                                type="button"
                                variant={suggestedResponsesCollapsed ? "secondary" : "ghost"}
                                size="sm"
                                className={cn(
                                    "h-7 gap-1.5 px-2 text-[11px]",
                                    suggestedResponsesCollapsed && "border-sky-200 bg-sky-100 text-sky-900 hover:bg-sky-100"
                                )}
                                onClick={onToggleSuggestedResponses}
                                title={suggestedResponsesCollapsed ? "Open AI suggestions" : "Minimize AI suggestions"}
                            >
                                <Sparkles className="h-3.5 w-3.5" />
                                AI ({suggestedResponseCount})
                            </Button>
                        )}
                    </div>
                )}

                {replyingToLabel && !isNoteMode ? (
                    <div className="px-1 pb-1 text-[11px] text-slate-500">
                        Replying to <span className="font-medium text-slate-700">{replyingToLabel}</span>
                    </div>
                ) : null}

                {(isUnavailable || sendUnavailableReason) && (
                    <div className="px-1 pb-1 text-[11px] text-amber-700">
                        {sendUnavailableReason || "Composer unavailable until a contact is selected."}
                    </div>
                )}

                {whatsAppCallRequestError && (
                    <div className="px-1 pb-1 text-[11px] text-amber-700">
                        {whatsAppCallRequestError}
                    </div>
                )}

                {whatsAppCallState && (
                    <div
                        className={cn(
                            "mb-2 flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs shadow-sm",
                            whatsAppCallState.phase === "failed"
                                ? "border-red-200 bg-red-50 text-red-800"
                                : whatsAppCallState.phase === "accepted" || whatsAppCallState.phase === "ringing"
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                    : "border-sky-200 bg-sky-50 text-sky-800"
                        )}
                    >
                        <div className="mt-0.5 shrink-0">
                            {whatsAppCallState.phase === "starting" ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <PhoneOutgoing className="h-3.5 w-3.5" />
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="font-medium leading-4">{whatsAppCallState.label}</div>
                            <div className="mt-0.5 leading-4 opacity-85">{whatsAppCallState.detail}</div>
                            {(whatsAppCallState.whatsappCallId || whatsAppCallState.bridgeCallId) && (
                                <div className="mt-1 truncate font-mono text-[10px] opacity-70">
                                    {whatsAppCallState.whatsappCallId || whatsAppCallState.bridgeCallId}
                                </div>
                            )}
                            {whatsAppCallState.fallbackCallLink && (
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 gap-1.5 rounded-md border-current/20 bg-white/70 px-2 text-[11px] text-current hover:bg-white"
                                        disabled={sending || isUnavailable}
                                        onClick={handleSendWhatsAppCallLink}
                                    >
                                        {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                        Send call link
                                    </Button>
                                    <a
                                        href={whatsAppCallState.fallbackCallLink}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="rounded-md px-2 py-1 text-[11px] font-medium underline-offset-2 hover:underline"
                                    >
                                        Open link
                                    </a>
                                </div>
                            )}
                        </div>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 shrink-0 p-0 text-current opacity-70 hover:opacity-100"
                            onClick={() => setWhatsAppCallState(null)}
                            title="Dismiss call status"
                        >
                            <X className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                )}

                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,audio/*"
                    className="hidden"
                    onChange={handleMediaSelected}
                />

                <div className={cn("relative rounded-xl shadow-sm transition-all min-w-0", isNoteMode ? noteModeShellClassName : resolvedSurfaceTheme.composerShellClassName)}>
                    <Textarea
                        ref={composerTextareaRef}
                        value={textareaValue}
                        onChange={(e) => {
                            if (isNoteMode) setAddNoteText(e.target.value);
                            else onDraftChange(e.target.value);
                        }}
                        placeholder={isNoteMode ? "Add an internal activity note..." : getPlaceholderText(selectedChannel)}
                        rows={DRAFT_COMPOSER_MIN_ROWS}
                        className={cn(
                            "max-h-[188px] min-h-[36px] w-full resize-none overflow-hidden border-0 bg-transparent px-3 py-2.5 text-base focus-visible:ring-0 sm:max-h-[320px] sm:text-sm"
                        )}
                        style={textareaHasDraft ? undefined : { height: `${EMPTY_COMPOSER_HEIGHT_PX}px` }}
                        disabled={isNoteMode ? addingNote || improvingNote : isUnavailable || sending || isRecording}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                if (isNoteMode) {
                                    handleAddNote();
                                } else {
                                    handleSend("original");
                                }
                            }
                        }}
                    />

                    {!isNoteMode && canUseWriteTranslation && hasTranslationPreview && (
                        <div className="mx-3 mb-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs">
                            <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                                <span>
                                    Will send to customer
                                    {translationPreviewLanguage ? ` (${translationPreviewLanguage})` : ""}
                                </span>
                                <button
                                    type="button"
                                    className="text-slate-500 hover:text-slate-700"
                                    onClick={clearTranslationPreview}
                                >
                                    Clear
                                </button>
                            </div>
                            <div className="max-h-28 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] text-slate-700">
                                {translationPreviewText}
                            </div>
                        </div>
                    )}

                    {!isNoteMode && latestAiDraftFeedback?.aiOutput && (
                        <div
                            className="mx-2 mb-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-purple-100 bg-purple-50/70 px-2 py-1 text-[10px] text-purple-900"
                            title={[
                                latestAiDraftFeedback.reasoning,
                                formatAiDraftRouteReason(latestAiDraftFeedback.routeReason),
                                latestAiDraftFeedback.traceId ? `Trace: ${latestAiDraftFeedback.traceId}` : null,
                            ].filter(Boolean).join(" · ") || undefined}
                        >
                            <span className="inline-flex min-w-0 items-center gap-1 font-medium">
                                <ShieldCheck className="h-3 w-3 shrink-0" />
                                <span className="truncate">AI draft</span>
                            </span>
                            <span className="truncate">Skill: {formatAiDraftSkillLabel(latestAiDraftFeedback.skillId)}</span>
                            {latestAiDraftFeedback.requiresHumanApproval && (
                                <span className="shrink-0 rounded-sm bg-white/70 px-1 py-0.5 text-purple-800">Review</span>
                            )}
                            {latestAiDraftFeedback.traceId && (
                                <span className="min-w-0 truncate font-mono text-purple-700">Trace {latestAiDraftFeedback.traceId.slice(0, 10)}</span>
                            )}
                        </div>
                    )}

                    <div className="flex flex-col gap-1 px-2 pb-1.5">
                        {isNoteMode ? (
                            <div className="flex min-w-0 w-full flex-wrap items-center justify-end gap-1.5">
                                <Input
                                    type="datetime-local"
                                    step={300}
                                    value={addNoteDate}
                                    onChange={(event) => setAddNoteDate(event.target.value)}
                                    className="h-7 w-[190px] border-amber-200 bg-white/80 px-2 text-[11px]"
                                    disabled={addingNote || improvingNote}
                                />
                                {onGenerateDraft && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 gap-1 px-2 text-[11px] text-amber-800 hover:bg-amber-100 hover:text-amber-900"
                                        onClick={handleImproveNote}
                                        disabled={improvingNote || addingNote || !noteHasDraft}
                                    >
                                        {improvingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                                        {improvingNote ? "Improving..." : "Improve"}
                                    </Button>
                                )}
                                <Button
                                    type="button"
                                    size="sm"
                                    className="h-7 gap-1 rounded-lg bg-amber-700 px-3 text-[11px] text-white hover:bg-amber-800"
                                    onClick={handleAddNote}
                                    disabled={addingNote || improvingNote || !noteHasDraft}
                                >
                                    {addingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <NotebookPen className="h-3.5 w-3.5" />}
                                    {addingNote ? "Saving..." : "Save Note"}
                                </Button>
                            </div>
                        ) : (
                            <>
                        <div className="flex min-w-0 w-full flex-wrap items-center gap-1">
                            <Select
                                value={selectedChannel}
                                onValueChange={(v: ComposerChannel) => selectChannel(v)}
                                disabled={isUnavailable}
                            >
                                <SelectTrigger
                                    className={cn("h-7 w-[92px] text-[11px] border-0 px-2 sm:w-auto sm:min-w-[85px]", resolvedSurfaceTheme.composerControlClassName)}
                                    title={channelSelectorTitle}
                                >
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="SMS" className="text-xs" disabled={isSmsDisabled}>SMS</SelectItem>
                                    {smsRelayEnabled && (
                                        <SelectItem value="SMS_RELAY" className="text-xs" disabled={isSmsRelayDisabled}>Android SMS</SelectItem>
                                    )}
                                    <SelectItem value="Email" className="text-xs" disabled={isEmailDisabled}>Email</SelectItem>
                                    <SelectItem value="WhatsApp" className="text-xs" disabled={isWhatsAppDisabled}>WhatsApp</SelectItem>
                                </SelectContent>
                            </Select>

                            {onGenerateDraft && (
                                <>
                                    <div className="hidden h-4 w-px bg-slate-200 sm:block" />
                                    <AiModelSelect
                                        value={selectedModel}
                                        onValueChange={handleModelChange}
                                        disabled={isUnavailable}
                                        triggerClassName={cn("h-7 w-[112px] text-[11px] border-0 px-2 sm:w-[110px]", resolvedSurfaceTheme.composerControlClassName)}
                                        itemClassName="text-xs"
                                        models={availableModels}
                                    />
                                    <Popover open={replyLanguageOpen} onOpenChange={setReplyLanguageOpen}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className={cn("h-7 w-[min(100%,172px)] min-w-[148px] justify-between text-[11px] border-0 px-2 sm:w-[144px] sm:min-w-0", resolvedSurfaceTheme.composerControlClassName)}
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
                                                            Auto (customer language)
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
                                </>
                            )}
                        </div>

                        {onGenerateDraft && (
                            <div className="flex min-w-0 w-full flex-wrap items-center gap-1">
                                {canUseWriteTranslation && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => void handlePreviewTranslation()}
                                        disabled={isUnavailable || previewingTranslation || !draft.trim()}
                                        className={cn("h-7 text-[11px] font-medium gap-1 px-1.5 sm:px-2", resolvedSurfaceTheme.composerIconButtonClassName)}
                                    >
                                        {previewingTranslation ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                        {previewingTranslation ? "..." : "Preview"}
                                    </Button>
                                )}
                                <PropertyMessageAssist
                                    disabled={isUnavailable}
                                    generatingDraft={generatingDraft}
                                    onGenerateInstruction={(instruction) => void handleAiDraft(instruction)}
                                />
                                <Popover open={aiDraftOpen} onOpenChange={setAiDraftOpen}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            disabled={isUnavailable || generatingDraft}
                                            className="h-7 text-[11px] font-medium text-purple-600 hover:text-purple-700 hover:bg-purple-50 gap-1 px-1.5 sm:px-2"
                                        >
                                            {generatingDraft ? (
                                                <Loader2 className="w-3 h-3 animate-spin" />
                                            ) : (
                                                <Sparkles className="w-3 h-3" />
                                            )}
                                            {generatingDraft ? "..." : aiActionLabel}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[280px] p-2" align="start">
                                        <div className="grid grid-cols-2 gap-1.5">
                                            {aiQuickActions.map((action) => (
                                                <Button
                                                    key={action}
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 justify-start px-2 text-[11px] text-slate-700"
                                                    onClick={() => runAiDraftCommand(action === "Best next reply" ? undefined : action)}
                                                    disabled={generatingDraft}
                                                >
                                                    <Wand2 className="mr-1.5 h-3 w-3 text-purple-500" />
                                                    <span className="truncate">{action}</span>
                                                </Button>
                                            ))}
                                        </div>
                                        <div className="mt-2 flex gap-1.5">
                                            <Textarea
                                                value={aiInstruction}
                                                onChange={(event) => setAiInstruction(event.target.value)}
                                                placeholder={aiCustomPlaceholder}
                                                rows={2}
                                                className="min-h-[56px] resize-none text-xs"
                                                disabled={generatingDraft}
                                                onKeyDown={(event) => {
                                                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                                                        event.preventDefault();
                                                        runAiDraftCommand(aiInstruction);
                                                    }
                                                }}
                                            />
                                            <Button
                                                type="button"
                                                size="sm"
                                                className="h-auto self-stretch px-2"
                                                onClick={() => runAiDraftCommand(aiInstruction)}
                                                disabled={generatingDraft || (!composerHasDraft && !aiInstruction.trim())}
                                                title={composerHasDraft ? "Apply AI instruction to current draft" : "Generate AI draft"}
                                            >
                                                <Send className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            </div>
                        )}

                        <div className="ml-auto flex w-full min-w-0 flex-wrap items-center justify-end gap-1.5">
                            <span className="text-[10px] text-slate-400 hidden sm:inline">⌘↵</span>
                            {selectedChannel === "WhatsApp" && (
                                <>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className={cn("h-7 w-7 p-0", resolvedSurfaceTheme.composerIconButtonClassName)}
                                        onClick={() => void handleRequestWhatsAppCall()}
                                        title="Start WhatsApp Call"
                                        disabled={isUnavailable || sending || isRecording || requestingWhatsAppCall}
                                    >
                                        {requestingWhatsAppCall ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <PhoneOutgoing className="h-3.5 w-3.5" />
                                        )}
                                    </Button>
                                    {onSendMedia && (
                                        <>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className={cn("h-7 w-7 p-0", resolvedSurfaceTheme.composerIconButtonClassName)}
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
                                                        : resolvedSurfaceTheme.composerIconButtonClassName
                                                )}
                                                onClick={handleRecordToggle}
                                                title={isRecording ? "Stop recording and send voice note" : "Record voice note"}
                                                disabled={isUnavailable || sending}
                                            >
                                                {isRecording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                                            </Button>
                                        </>
                                    )}
                                </>
                            )}
                            {selectedChannel === "SMS" && draft.length > 0 && (
                                <span className="text-[10px] text-slate-400">{draft.length}</span>
                            )}
                            {showSmsRelaySegmentInfo && (
                                <span
                                    className={cn("text-[10px] whitespace-nowrap", smsRelaySegmentTone)}
                                    title={smsRelaySegmentTitle}
                                >
                                    {smsRelaySegmentLabel}
                                </span>
                            )}
                            {onScheduleMessage && canScheduleChannel && (
                                <Popover open={scheduleOpen} onOpenChange={(open) => {
                                    setScheduleOpen(open);
                                    if (open) {
                                        setScheduleError(null);
                                        if (!scheduleLocal) setScheduleLocal(getDefaultScheduleLocalValue());
                                    }
                                }}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className={cn("h-7 w-7 p-0", resolvedSurfaceTheme.composerIconButtonClassName)}
                                            disabled={isSendUnavailable || sending || isRecording || scheduling || !draft.trim()}
                                            title="Schedule message"
                                        >
                                            <CalendarClock className="h-3.5 w-3.5" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[320px] p-3" align="end">
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="text-xs font-semibold text-slate-800">Schedule message</div>
                                                <div className="text-[10px] text-slate-500">{selectedChannel}</div>
                                            </div>
                                            <Input
                                                type="datetime-local"
                                                step={300}
                                                value={scheduleLocal}
                                                onChange={(event) => setScheduleLocal(event.target.value)}
                                                className="h-8 text-xs"
                                                disabled={scheduling}
                                            />
                                            <div className="max-h-32 overflow-y-auto rounded-md border bg-slate-50 p-2 text-xs whitespace-pre-wrap [overflow-wrap:anywhere] text-slate-700">
                                                {draft.trim() || "No message drafted."}
                                            </div>
                                            {!scheduleError && scheduleTimingWarning && (
                                                <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                                                    {scheduleTimingWarning}
                                                </div>
                                            )}
                                            {scheduleError && (
                                                <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
                                                    {scheduleError}
                                                </div>
                                            )}
                                            <div className="flex justify-end gap-1.5">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 px-2 text-xs"
                                                    onClick={() => setScheduleOpen(false)}
                                                    disabled={scheduling}
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    className="h-7 gap-1 px-2 text-xs"
                                                    onClick={() => void handleScheduleDraft()}
                                                    disabled={scheduling || !draft.trim()}
                                                >
                                                    {scheduling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
                                                    Schedule
                                                </Button>
                                            </div>
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            )}
                            {canUseWriteTranslation && hasTranslationPreview ? (
                                <Button
                                    size="sm"
                                    className={cn("h-7 rounded-lg px-3 transition-all duration-150", resolvedSurfaceTheme.composerPrimaryButtonClassName)}
                                    onClick={() => handleSend("translated")}
                                    disabled={isSendUnavailable || sending || isRecording || !draft.trim()}
                                    title="Sends the previewed customer-language version and preserves your working draft."
                                >
                                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                    <span className="ml-1 text-[11px]">Send in {autoTranslateTargetLabel}</span>
                                </Button>
                            ) : willAutoTranslate ? (
                                <Button
                                    size="sm"
                                    className={cn(
                                        "h-7 rounded-lg px-3 transition-all duration-150 gap-1",
                                        draft.trim() ? resolvedSurfaceTheme.composerPrimaryButtonClassName : resolvedSurfaceTheme.composerPrimaryButtonDisabledClassName
                                    )}
                                    onClick={() => handleSend("original")}
                                    disabled={isSendUnavailable || sending || isRecording || !draft.trim()}
                                    title={`Message will be prepared in ${autoTranslateTargetLabel} before sending`}
                                >
                                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                    <span className="text-[11px]">Send in {autoTranslateTargetLabel}</span>
                                </Button>
                            ) : (
                                <Button
                                    size="sm"
                                    className={cn(
                                        "h-7 rounded-lg px-3 transition-all duration-150",
                                        draft.trim() ? resolvedSurfaceTheme.composerPrimaryButtonClassName : resolvedSurfaceTheme.composerPrimaryButtonDisabledClassName
                                    )}
                                    onClick={() => handleSend("original")}
                                    disabled={isSendUnavailable || sending || isRecording || !draft.trim()}
                                    title={sendUnavailableReason || undefined}
                                >
                                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                </Button>
                            )}
                        </div>
                            </>
                        )}
                    </div>
                </div>
                {!isNoteMode && canUndoAiDraft && (
                    <div className="px-1 pt-1">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 gap-1 px-1.5 text-[10px] text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                            onClick={undoAiDraft}
                            disabled={isUnavailable || generatingDraft || sending}
                            title="Restore the composer text from before the last AI draft"
                        >
                            <RotateCcw className="h-3 w-3" />
                            Undo AI Draft
                        </Button>
                    </div>
                )}
                {!isNoteMode && onGenerateDraft && (
                    <div className="px-1 pt-1 text-[10px] text-slate-500">
                        {willAutoTranslate
                            ? `View messages in: ${resolvedViewingLanguageLabel} · Working draft: ${resolvedDraftLanguageLabel} · Will send in: ${autoTranslateTargetLabel} · ${replyLanguageSourceHint}`
                            : `View messages in: ${resolvedViewingLanguageLabel} · Working draft: ${resolvedDraftLanguageLabel} · Send replies in: ${autoTranslateTargetLabel} · ${replyLanguageSourceHint}`
                        }
                    </div>
                )}
                {showSmsRelaySegmentInfo && smsSegmentInfo.segments > 1 && (
                    <div className={cn(
                        "px-1 pt-1 text-[10px]",
                        smsSegmentInfo.encoding === "unicode" ? "text-amber-700" : "text-slate-500"
                    )}>
                        {smsSegmentInfo.encoding === "unicode"
                            ? `Unicode SMS uses ${smsSegmentInfo.segmentLimit} characters per multipart segment. This will send as ${smsSegmentInfo.segments} SMS parts.`
                            : `This will send as ${smsSegmentInfo.segments} SMS parts.`}
                    </div>
                )}
            </div>
        </div>
    );
}
