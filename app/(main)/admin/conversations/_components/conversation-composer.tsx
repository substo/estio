import { useEffect, useRef } from "react";
import { Conversation } from "@/lib/ghl/conversations";
import {
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
import { getSmsSegmentInfo } from "@/lib/sms/segments";
import {
    type ComposerChannel,
    useConversationComposerTranslationPreview,
} from "./use-conversation-composer-translation-preview";
import { useConversationComposerChannel } from "./use-conversation-composer-channel";
import { useConversationComposerMedia } from "./use-conversation-composer-media";
import { useConversationComposerAiDraft } from "./use-conversation-composer-ai-draft";
import { useConversationComposerSend } from "./use-conversation-composer-send";

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
        }
    ) => void | Promise<void>;
    onSendMedia?: (file: File, caption: string) => void | Promise<void>;
    onGenerateDraft?: (
        instruction?: string,
        model?: string,
        draftLanguage?: string | null,
        onChunk?: (chunk: string) => void
    ) => Promise<string | null>;
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
}

function getPlaceholderText(channel: ComposerChannel): string {
    const channelHints: Record<ComposerChannel, string> = {
        WhatsApp: "Message or AI instruction...",
        Email: "Email or AI instruction...",
        SMS: "Text or AI instruction...",
        SMS_RELAY: "Android SMS or AI instruction...",
    };
    return channelHints[channel] || channelHints.SMS;
}

export function ConversationComposer({
    conversation,
    draft,
    onDraftChange,
    onDraftClear,
    onSendMessage,
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
}: ConversationComposerProps) {
    const isUnavailable = disabled || !conversation;
    const isRecordingRef = useRef(false);
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
        handleReplyLanguageSelect,
        selectedReplyLanguageLabel,
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
        onSetReplyLanguageOverride,
        onModelChange,
        translationTargetLanguageLabel,
        viewingLanguageLabel,
    });
    const {
        selectedChannel,
        selectChannel,
        isWhatsAppDisabled,
        isSmsDisabled,
        channelSelectorTitle,
    } = useConversationComposerChannel({
        conversation,
        isUnavailable,
    });
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
        isUnavailable,
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
        canUseWriteTranslation,
        translationPreviewText,
        translationPreviewLanguage,
        translationPreviewDetectedSource,
        onPreviewTranslatedReply,
        onSendMessage,
        onDraftClear,
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
        onDraftClear,
    });
    isRecordingRef.current = isRecording;

    useEffect(() => {
        setIsRecording(false);
        clearTranslationPreview();
    }, [clearTranslationPreview, conversation?.id, setIsRecording]);

    const willAutoTranslate = selectedReplyLanguage !== REPLY_LANGUAGE_AUTO_VALUE && canUseWriteTranslation && !!onPreviewTranslatedReply;

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

    return (
        <div className="border-t bg-white pb-[env(safe-area-inset-bottom)]" data-no-pane-swipe>
            <SuggestionBubbles
                suggestions={suggestions}
                onSelect={(text) => handleAiDraft(text)}
            />

            <div className="mx-auto min-w-0 max-w-5xl px-3 py-2 sm:px-5">
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
                        onChange={(e) => onDraftChange(e.target.value)}
                        placeholder={getPlaceholderText(selectedChannel)}
                        className="min-h-[36px] max-h-[200px] w-full resize-none border-0 focus-visible:ring-0 bg-transparent py-2.5 px-3 text-sm"
                        style={{ height: draft ? "auto" : "36px" }}
                        disabled={isUnavailable || sending || isRecording}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                handleSend("original");
                            }
                        }}
                    />

                    {canUseWriteTranslation && hasTranslationPreview && (
                        <div className="mx-3 mb-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs">
                            <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                                <span>
                                    Preview translation
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

                    <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5 sm:flex-nowrap sm:justify-between">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 sm:flex-nowrap">
                            <Select
                                value={selectedChannel}
                                onValueChange={(v: ComposerChannel) => selectChannel(v)}
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
                                    {smsRelayEnabled && (
                                        <SelectItem value="SMS_RELAY" className="text-xs">Android SMS</SelectItem>
                                    )}
                                    <SelectItem value="Email" className="text-xs">Email</SelectItem>
                                    <SelectItem value="WhatsApp" className="text-xs" disabled={isWhatsAppDisabled}>WhatsApp</SelectItem>
                                </SelectContent>
                            </Select>

                            {onGenerateDraft && (
                                <>
                                    <div className="w-px h-4 bg-slate-200" />
                                    <AiModelSelect
                                        value={selectedModel}
                                        onValueChange={handleModelChange}
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
                                                            Auto (location default)
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
                                    {canUseWriteTranslation && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => void handlePreviewTranslation()}
                                            disabled={isUnavailable || previewingTranslation || !draft.trim()}
                                            className="h-7 text-[11px] font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 gap-1 px-1.5 sm:px-2"
                                        >
                                            {previewingTranslation ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                            {previewingTranslation ? "..." : "Preview"}
                                        </Button>
                                    )}
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
                            {showSmsRelaySegmentInfo && (
                                <span
                                    className={cn("text-[10px] whitespace-nowrap", smsRelaySegmentTone)}
                                    title={smsRelaySegmentTitle}
                                >
                                    {smsRelaySegmentLabel}
                                </span>
                            )}
                            {canUseWriteTranslation && hasTranslationPreview ? (
                                <>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 rounded-lg px-2.5 text-[11px]"
                                        onClick={() => handleSend("original")}
                                        disabled={isUnavailable || sending || isRecording || !draft.trim()}
                                    >
                                        Send Original
                                    </Button>
                                    <Button
                                        size="sm"
                                        className="h-7 rounded-lg px-3 transition-all duration-150 bg-blue-600 hover:bg-blue-700"
                                        onClick={() => handleSend("translated")}
                                        disabled={isUnavailable || sending || isRecording || !draft.trim()}
                                    >
                                        {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                        <span className="ml-1 text-[11px]">Send translated</span>
                                    </Button>
                                </>
                            ) : willAutoTranslate ? (
                                <Button
                                    size="sm"
                                    className={cn(
                                        "h-7 rounded-lg px-3 transition-all duration-150 gap-1",
                                        draft.trim() ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                                    )}
                                    onClick={() => handleSend("original")}
                                    disabled={isUnavailable || sending || isRecording || !draft.trim()}
                                    title={`Message will be auto-translated to ${autoTranslateTargetLabel} before sending`}
                                >
                                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                    <span className="text-[11px]">in {autoTranslateTargetLabel}</span>
                                </Button>
                            ) : (
                                <Button
                                    size="sm"
                                    className={cn(
                                        "h-7 rounded-lg px-3 transition-all duration-150",
                                        draft.trim() ? "bg-blue-600 hover:bg-blue-700" : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                                    )}
                                    onClick={() => handleSend("original")}
                                    disabled={isUnavailable || sending || isRecording || !draft.trim()}
                                >
                                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
                {onGenerateDraft && (
                    <div className="px-1 pt-1 text-[10px] text-slate-500">
                        {willAutoTranslate
                            ? `Draft in ${resolvedDraftLanguageLabel} · Auto-translates to ${autoTranslateTargetLabel} on send · ${replyLanguageSourceHint}`
                            : `Viewing in ${resolvedViewingLanguageLabel}. Drafting in ${resolvedDraftLanguageLabel}. ${replyLanguageSourceHint}`
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
