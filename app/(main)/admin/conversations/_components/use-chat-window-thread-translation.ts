import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { Conversation, Message } from "@/lib/ghl/conversations";
import { getReplyLanguageLabel } from "@/lib/ai/reply-language-options";
import {
    buildMessageTranslationState,
    getBrowserLanguage,
    getResolvedConversationTranslationLanguage,
    isLikelyForeignLanguageMessage,
} from "@/lib/conversations/translation-view";

type ThreadTranslationMode = "original" | "translated";

type TranslateVisibleThreadResult = {
    success: boolean;
    error?: string;
    translatedCount?: number;
    failedCount?: number;
};

type UseChatWindowThreadTranslationArgs = {
    conversation: Conversation;
    messages: Message[];
    onTranslateVisibleThread?: (visibleMessageIds: string[], targetLanguage?: string | null) => Promise<TranslateVisibleThreadResult>;
    translationReadEnabled: boolean;
    translationBannerEnabled: boolean;
};

function getThreadTranslationPreferenceKey(conversationId: string, targetLanguage: string) {
    return `conversation-thread-translation:${conversationId}:${targetLanguage.toLowerCase()}`;
}

export function useChatWindowThreadTranslation({
    conversation,
    messages,
    onTranslateVisibleThread,
    translationReadEnabled,
    translationBannerEnabled,
}: UseChatWindowThreadTranslationArgs) {
    const [translatingVisibleThread, setTranslatingVisibleThread] = useState(false);
    const [translationBannerDismissed, setTranslationBannerDismissed] = useState(false);
    const [threadTranslationMode, setThreadTranslationMode] = useState<ThreadTranslationMode>("original");
    const [autoTranslatingThread, setAutoTranslatingThread] = useState(false);
    const autoTranslationAttemptedRef = useRef<string | null>(null);
    const [agentDisplayLanguage, setAgentDisplayLanguage] = useState("en");

    useEffect(() => {
        setAgentDisplayLanguage(getBrowserLanguage());
    }, []);

    useEffect(() => {
        setTranslationBannerDismissed(false);
        setThreadTranslationMode("original");
        setAutoTranslatingThread(false);
        autoTranslationAttemptedRef.current = null;
    }, [conversation.id]);

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

    return {
        translatingVisibleThread,
        autoTranslatingThread,
        translationBannerDismissed,
        setTranslationBannerDismissed,
        threadTranslationMode,
        setThreadTranslationMode,
        resolvedTranslationTargetLanguage,
        resolvedReplyLanguage,
        inboundForeignCandidates,
        eligibleInboundTranslationIds,
        threadSupportsTranslatedDefault,
        threadShouldPreferTranslated,
        resolvedTranslationTargetLanguageLabel,
        shouldShowTranslationBanner,
        handleTranslateVisibleThread,
    };
}
