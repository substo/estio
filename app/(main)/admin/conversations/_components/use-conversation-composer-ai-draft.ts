import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { useAiModelCatalog } from "@/components/ai/use-ai-model-catalog";
import { Conversation } from "@/lib/ghl/conversations";
import {
    DEFAULT_REPLY_LANGUAGE,
    getReplyLanguageLabel,
    normalizeReplyLanguage,
    REPLY_LANGUAGE_AUTO_VALUE,
} from "@/lib/ai/reply-language-options";

type GenerateDraft = (
    instruction?: string,
    model?: string,
    draftLanguage?: string | null,
    baseDraft?: string | null,
    onChunk?: (chunk: string) => void
) => Promise<string | null>;

type SetReplyLanguageOverride = (
    replyLanguage: string | null
) => Promise<{ success: boolean; error?: string; replyLanguageOverride?: string | null }>;

interface UseConversationComposerAiDraftArgs {
    conversation: Conversation | null;
    draft: string;
    isUnavailable: boolean;
    insertDraftSeed?: { key: string; body: string } | null;
    onDraftChange: (draft: string) => void;
    onGenerateDraft?: GenerateDraft;
    onSetReplyLanguageOverride?: SetReplyLanguageOverride;
    onModelChange?: (model: string) => void;
    translationTargetLanguageLabel?: string | null;
    viewingLanguageLabel?: string | null;
}

function getAgentDraftLanguage() {
    if (typeof window === "undefined") return DEFAULT_REPLY_LANGUAGE;
    return normalizeReplyLanguage(window.navigator.language || "") || DEFAULT_REPLY_LANGUAGE;
}

function logComposerDraftTiming(event: string, fields: Record<string, unknown> = {}) {
    if (typeof console === "undefined") return;
    console.info("[AI Draft Timing]", JSON.stringify({
        event,
        ts: new Date().toISOString(),
        ...fields,
    }));
}

export function useConversationComposerAiDraft({
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
}: UseConversationComposerAiDraftArgs): {
    generatingDraft: boolean;
    selectedModel: string;
    handleModelChange: (model: string) => void;
    availableModels: ReturnType<typeof useAiModelCatalog>["models"];
    selectedReplyLanguage: string;
    setSelectedReplyLanguage: Dispatch<SetStateAction<string>>;
    replyLanguageOpen: boolean;
    setReplyLanguageOpen: Dispatch<SetStateAction<boolean>>;
    savingReplyLanguage: boolean;
    handleAiDraft: (instructionOverride?: string, baseDraftOverride?: string | null) => Promise<void>;
    handleReplyLanguageSelect: (value: string) => Promise<void>;
    selectedReplyLanguageLabel: string;
    resolvedDraftLanguageLabel: string;
    resolvedSendLanguageLabel: string;
    resolvedViewingLanguageLabel: string;
    replyLanguageSourceHint: string;
    autoTranslateTargetLabel: string;
} {
    const [generatingDraft, setGeneratingDraft] = useState(false);
    const [selectedModel, setSelectedModel] = useState("");
    const [hasUserSelectedModel, setHasUserSelectedModel] = useState(false);
    const { models: availableModels, resolveModelForKind } = useAiModelCatalog();
    const [selectedReplyLanguage, setSelectedReplyLanguage] = useState<string>(
        conversation?.replyLanguageOverride || REPLY_LANGUAGE_AUTO_VALUE
    );
    const [replyLanguageOpen, setReplyLanguageOpen] = useState(false);
    const [savingReplyLanguage, setSavingReplyLanguage] = useState(false);
    const [agentDraftLanguage, setAgentDraftLanguage] = useState<string>(DEFAULT_REPLY_LANGUAGE);

    const hasUserSelectedModelRef = useRef(false);
    const appliedInsertDraftSeedKeyRef = useRef<string | null>(null);

    useEffect(() => {
        onModelChange?.(selectedModel);
    }, [selectedModel, onModelChange]);

    useEffect(() => {
        setAgentDraftLanguage(getAgentDraftLanguage());
    }, []);

    useEffect(() => {
        if (hasUserSelectedModelRef.current) return;
        const preferredModel = resolveModelForKind("general") || resolveModelForKind("draft");
        if (!preferredModel) return;
        setSelectedModel(preferredModel);
    }, [resolveModelForKind]);

    useEffect(() => {
        if (!insertDraftSeed?.key) return;
        if (appliedInsertDraftSeedKeyRef.current === insertDraftSeed.key) return;
        appliedInsertDraftSeedKeyRef.current = insertDraftSeed.key;
        const nextBody = String(insertDraftSeed.body || "");
        onDraftChange(nextBody);
    }, [insertDraftSeed?.key, insertDraftSeed?.body, onDraftChange]);

    useEffect(() => {
        setSelectedReplyLanguage(conversation?.replyLanguageOverride || REPLY_LANGUAGE_AUTO_VALUE);
    }, [conversation?.id, conversation?.replyLanguageOverride]);

    const handleModelChange = (value: string) => {
        hasUserSelectedModelRef.current = true;
        setHasUserSelectedModel(true);
        setSelectedModel(value);
    };

    const handleAiDraft = async (instructionOverride?: string, baseDraftOverride?: string | null) => {
        if (!onGenerateDraft || generatingDraft || isUnavailable) return;
        const startedAt = Date.now();
        let firstChunkMs: number | null = null;
        const instruction = String(instructionOverride || "").trim() || undefined;
        const baseDraft = typeof baseDraftOverride === "string" && baseDraftOverride.trim()
            ? baseDraftOverride.trim()
            : null;
        logComposerDraftTiming("client_click_start", {
            conversationId: conversation?.id || null,
            hasInstructionOverride: !!instruction,
            hasBaseDraft: !!baseDraft,
        });
        setGeneratingDraft(true);
        try {
            const modelOverride = hasUserSelectedModel ? selectedModel : undefined;
            let streamedBuffer = "";
            const text = await onGenerateDraft(
                instruction,
                modelOverride,
                agentDraftLanguage,
                baseDraft,
                (chunk) => {
                    if (!chunk) return;
                    if (firstChunkMs === null) {
                        firstChunkMs = Date.now() - startedAt;
                        logComposerDraftTiming("client_first_chunk", {
                            conversationId: conversation?.id || null,
                            firstChunkMs,
                        });
                    }
                    streamedBuffer += chunk;
                    onDraftChange(streamedBuffer);
                }
            );
            if (text) {
                onDraftChange(text);
            } else if (streamedBuffer) {
                onDraftChange(streamedBuffer);
            }
            logComposerDraftTiming("client_click_end", {
                conversationId: conversation?.id || null,
                elapsedMs: Date.now() - startedAt,
                firstChunkMs,
                receivedFinalText: !!text,
                streamedChars: streamedBuffer.length,
            });
        } catch (e) {
            logComposerDraftTiming("client_click_failed", {
                conversationId: conversation?.id || null,
                elapsedMs: Date.now() - startedAt,
                firstChunkMs,
                reason: e instanceof Error ? e.message : String(e || "Unknown error"),
            });
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
        ? "Reply in: Auto"
        : `Reply in: ${getReplyLanguageLabel(selectedReplyLanguage) || selectedReplyLanguage}`;
    const resolvedDraftLanguageLabel = getReplyLanguageLabel(agentDraftLanguage) || agentDraftLanguage || DEFAULT_REPLY_LANGUAGE;
    const autoTranslateTargetLabel = getReplyLanguageLabel(selectedReplyLanguage) || selectedReplyLanguage;
    const resolvedSendLanguageLabel = getReplyLanguageLabel(
        selectedReplyLanguage === REPLY_LANGUAGE_AUTO_VALUE
            ? (conversation?.locationDefaultReplyLanguage || DEFAULT_REPLY_LANGUAGE)
            : selectedReplyLanguage
    ) || translationTargetLanguageLabel || DEFAULT_REPLY_LANGUAGE;
    const resolvedViewingLanguageLabel = getReplyLanguageLabel(viewingLanguageLabel || null) || viewingLanguageLabel || DEFAULT_REPLY_LANGUAGE;
    const replyLanguageSourceHint = selectedReplyLanguage !== REPLY_LANGUAGE_AUTO_VALUE
        ? `Source: Conversation override (${getReplyLanguageLabel(selectedReplyLanguage) || selectedReplyLanguage})`
        : `Source: Location default (${getReplyLanguageLabel(conversation?.locationDefaultReplyLanguage || DEFAULT_REPLY_LANGUAGE) || conversation?.locationDefaultReplyLanguage || DEFAULT_REPLY_LANGUAGE})`;

    return {
        generatingDraft,
        selectedModel,
        handleModelChange,
        availableModels,
        selectedReplyLanguage,
        setSelectedReplyLanguage,
        replyLanguageOpen,
        setReplyLanguageOpen,
        savingReplyLanguage,
        handleAiDraft,
        handleReplyLanguageSelect,
        selectedReplyLanguageLabel,
        resolvedDraftLanguageLabel,
        resolvedSendLanguageLabel,
        resolvedViewingLanguageLabel,
        replyLanguageSourceHint,
        autoTranslateTargetLabel,
    };
}
