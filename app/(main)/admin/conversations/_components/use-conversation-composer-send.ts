import { type RefObject, useState } from "react";
import { type ComposerChannel } from "./use-conversation-composer-translation-preview";
import { languagesMatch } from "@/lib/conversations/language-context";

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
    resolvedSendLanguage: string | null;
    agentWorkingLanguage: string | null;
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
    resolvedSendLanguage,
    agentWorkingLanguage,
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
            canUseWriteTranslation &&
            onPreviewTranslatedReply &&
            !languagesMatch(agentWorkingLanguage, resolvedSendLanguage)
        ) {
            // Auto-translate on send when the customer language differs from
            // the agent's working draft language.
            setSending(true);
            try {
                const requestedTargetLanguage = selectedReplyLanguage === autoReplyLanguageValue
                    ? null
                    : (resolvedSendLanguage || selectedReplyLanguage);
                const result = await onPreviewTranslatedReply(sourceText, selectedChannel, requestedTargetLanguage);
                if (result?.success && result.translatedText?.trim()) {
                    const translated = result.translatedText.trim();
                    if (translated !== sourceText) {
                        textToSend = translated;
                        translationMeta = {
                            translationSourceText: sourceText,
                            translationTargetLanguage: result.targetLanguage || resolvedSendLanguage || requestedTargetLanguage,
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
