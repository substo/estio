import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export type ComposerChannel = "SMS" | "Email" | "WhatsApp" | "SMS_RELAY";

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

interface UseConversationComposerTranslationPreviewArgs {
    draft: string;
    isUnavailable: boolean;
    selectedChannel: ComposerChannel;
    selectedReplyLanguage: string;
    autoReplyLanguageValue: string;
    onPreviewTranslatedReply?: PreviewTranslatedReply;
}

export function useConversationComposerTranslationPreview({
    draft,
    isUnavailable,
    selectedChannel,
    selectedReplyLanguage,
    autoReplyLanguageValue,
    onPreviewTranslatedReply,
}: UseConversationComposerTranslationPreviewArgs) {
    const [previewingTranslation, setPreviewingTranslation] = useState(false);
    const [translationPreviewText, setTranslationPreviewText] = useState("");
    const [translationPreviewLanguage, setTranslationPreviewLanguage] = useState<string | null>(null);
    const [translationPreviewDetectedSource, setTranslationPreviewDetectedSource] = useState<string | null>(null);
    const [translationPreviewSourceText, setTranslationPreviewSourceText] = useState("");

    const clearTranslationPreview = useCallback(() => {
        setTranslationPreviewText("");
        setTranslationPreviewLanguage(null);
        setTranslationPreviewDetectedSource(null);
        setTranslationPreviewSourceText("");
    }, []);

    useEffect(() => {
        const current = String(draft || "").trim();
        if (!translationPreviewText) return;
        if (!translationPreviewSourceText) return;
        if (current === translationPreviewSourceText) return;
        clearTranslationPreview();
    }, [clearTranslationPreview, draft, translationPreviewSourceText, translationPreviewText]);

    const handlePreviewTranslation = useCallback(async () => {
        if (!onPreviewTranslatedReply || previewingTranslation || isUnavailable) return;
        const sourceText = String(draft || "").trim();
        if (!sourceText) return;

        setPreviewingTranslation(true);
        try {
            const targetLanguage = selectedReplyLanguage === autoReplyLanguageValue ? null : selectedReplyLanguage;
            const result = await onPreviewTranslatedReply(sourceText, selectedChannel, targetLanguage);
            if (!result?.success || !result.translatedText) {
                toast.error(result?.error || "Failed to preview translation.");
                return;
            }
            setTranslationPreviewText(String(result.translatedText || ""));
            setTranslationPreviewLanguage(result.targetLanguage || targetLanguage || null);
            setTranslationPreviewDetectedSource(result.detectedSourceLanguage || null);
            setTranslationPreviewSourceText(sourceText);
        } finally {
            setPreviewingTranslation(false);
        }
    }, [
        autoReplyLanguageValue,
        draft,
        isUnavailable,
        onPreviewTranslatedReply,
        previewingTranslation,
        selectedChannel,
        selectedReplyLanguage,
    ]);

    return {
        previewingTranslation,
        translationPreviewText,
        translationPreviewLanguage,
        translationPreviewDetectedSource,
        hasTranslationPreview: !!translationPreviewText.trim(),
        clearTranslationPreview,
        handlePreviewTranslation,
    };
}
