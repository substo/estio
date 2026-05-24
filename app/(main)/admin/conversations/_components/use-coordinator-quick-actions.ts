import { useState } from "react";
import { DEFAULT_REPLY_LANGUAGE, normalizeReplyLanguage } from "@/lib/ai/reply-language-options";
import { generateAIDraft, generateMultiContextDraftAction, orchestrateAction } from "../actions";

interface UseCoordinatorQuickActionsOptions {
    conversationId: string;
    contactId: string;
    isContextMode?: boolean;
    ensureDealContext: () => Promise<string | null>;
    onSuggestionsGenerated?: (suggestions: string[]) => void;
    refreshExecutionHistory: () => void;
    setReasoning: (value: string) => void;
    setError: (value: string | null) => void;
}

function getBrowserDraftLanguage() {
    if (typeof window === "undefined") return DEFAULT_REPLY_LANGUAGE;
    return normalizeReplyLanguage(window.navigator.language || "") || DEFAULT_REPLY_LANGUAGE;
}

export function useCoordinatorQuickActions({
    conversationId,
    contactId,
    isContextMode,
    ensureDealContext,
    onSuggestionsGenerated,
    refreshExecutionHistory,
    setReasoning,
    setError,
}: UseCoordinatorQuickActionsOptions) {
    const [generating, setGenerating] = useState(false);
    const [orchestrating, setOrchestrating] = useState(false);
    const [orchestrationResult, setOrchestrationResult] = useState<any>(null);

    const handleOrchestrate = async () => {
        setOrchestrating(true);
        setError(null);
        setOrchestrationResult(null);
        try {
            const res = await orchestrateAction(conversationId, contactId);
            setOrchestrationResult(res);

            if (res.reasoning) {
                setReasoning(res.reasoning);
            }
            if ((res as any)?.suggestionQueued) {
                onSuggestionsGenerated?.([]);
            }

            // Auto-refresh trace history
            refreshExecutionHistory();

        } catch (e: any) {
            setError("Orchestration failed: " + e.message);
        } finally {
            setOrchestrating(false);
        }
    };

    const handleGenerateDraftOnly = async () => {
        setGenerating(true);
        setError(null);
        try {
            if (isContextMode) {
                // Multi-Context Flow (Simplified)
                const contextId = await ensureDealContext();
                const res = await generateMultiContextDraftAction(contextId!, 'LEAD');
                setReasoning(res.reasoning);
                onSuggestionsGenerated?.([]);
            } else {
                const res = await generateAIDraft(
                    conversationId,
                    contactId,
                    undefined,
                    undefined,
                    { mode: "chat", draftLanguage: getBrowserDraftLanguage() }
                );
                setReasoning(res.reasoning || "Suggested response queued for review.");
                onSuggestionsGenerated?.([]);
            }
        } catch (e: any) {
            setError("Failed to generate draft. " + e.message);
        } finally {
            setGenerating(false);
        }
    };

    return {
        generating,
        orchestrating,
        orchestrationResult,
        handleOrchestrate,
        handleGenerateDraftOnly,
    };
}
