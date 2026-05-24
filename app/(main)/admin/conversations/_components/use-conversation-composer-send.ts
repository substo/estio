import { type RefObject, useState } from "react";
import { type ComposerChannel } from "./use-conversation-composer-translation-preview";

type PreviewTranslatedReply = (
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

type SendTranslationMeta = {
    translationSourceText?: string | null;
    translationTargetLanguage?: string | null;
    translationDetectedSourceLanguage?: string | null;
};

interface UseConversationComposerSendArgs {
    draft: string;
    isUnavailable: boolean;
    isRecording: boolean | RefObject<boolean>;
    selectedChannel: ComposerChannel;
    selectedReplyLanguage: string;
    autoReplyLanguageValue: string;
    canUseWriteTranslation: boolean;
    translationPreviewText: string;
    translationPreviewLanguage: string | null;
    translationPreviewDetectedSource: string | null;
    onPreviewTranslatedReply?: PreviewTranslatedReply;
    onSendMessage: (
        text: string,
        type: ComposerChannel,
        options?: SendTranslationMeta
    ) => void | Promise<void>;
    onDraftClear: () => void;
    clearTranslationPreview: () => void;
}

export function useConversationComposerSend({
    draft,
    isUnavailable,
    isRecording,
    selectedChannel,
    selectedReplyLanguage,
    autoReplyLanguageValue,
    canUseWriteTranslation,
    translationPreviewText,
    translationPreviewLanguage,
    translationPreviewDetectedSource,
    onPreviewTranslatedReply,
    onSendMessage,
    onDraftClear,
    clearTranslationPreview,
}: UseConversationComposerSendArgs) {
    const [sending, setSending] = useState(false);

    const handleSend = async (mode: "original" | "translated" = "original") => {
        const currentlyRecording = typeof isRecording === "boolean" ? isRecording : isRecording.current;
        if (isUnavailable || currentlyRecording || !draft.trim()) return;

        const sourceText = draft.trim();
        let textToSend = sourceText;
        let translationMeta: {
            translationSourceText: string;
            translationTargetLanguage: string | null;
            translationDetectedSourceLanguage: string | null;
        } | undefined;

        if (mode === "translated" && translationPreviewText.trim()) {
            // User explicitly clicked "Send Translated" with an active preview
            textToSend = translationPreviewText.trim();
            if (sourceText !== textToSend) {
                translationMeta = {
                    translationSourceText: sourceText,
                    translationTargetLanguage: translationPreviewLanguage || (selectedReplyLanguage === autoReplyLanguageValue ? null : selectedReplyLanguage),
                    translationDetectedSourceLanguage: translationPreviewDetectedSource || null,
                };
            }
        } else if (
            mode === "original" &&
            selectedReplyLanguage !== autoReplyLanguageValue &&
            canUseWriteTranslation &&
            onPreviewTranslatedReply
        ) {
            // Auto-translate on send: reply language is explicitly set, seamlessly translate
            // before sending (enterprise best practice — matches Intercom/Zendesk behavior).
            // This catches both AI-drafted and manually-typed messages.
            setSending(true);
            try {
                const result = await onPreviewTranslatedReply(sourceText, selectedChannel, selectedReplyLanguage);
                if (result?.success && result.translatedText?.trim()) {
                    const translated = result.translatedText.trim();
                    if (translated !== sourceText) {
                        textToSend = translated;
                        translationMeta = {
                            translationSourceText: sourceText,
                            translationTargetLanguage: result.targetLanguage || selectedReplyLanguage,
                            translationDetectedSourceLanguage: result.detectedSourceLanguage || null,
                        };
                    }
                }
            } catch (autoTranslateError) {
                // Graceful degradation: send original if auto-translate fails
                console.warn("[Composer] Auto-translate on send failed, sending original:", autoTranslateError);
            } finally {
                setSending(false);
            }
        }

        setSending(true);
        try {
            await Promise.resolve(onSendMessage(textToSend, selectedChannel, translationMeta));
            onDraftClear();
            clearTranslationPreview();
        } catch (err) {
            console.error("Message send failed", err);
        } finally {
            setSending(false);
        }
    };

    return {
        sending,
        setSending,
        handleSend,
    };
}
