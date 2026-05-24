import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { searchConversationTranscriptMatches } from "@/app/(main)/admin/conversations/actions";

type TranscriptSearchResult = Awaited<ReturnType<typeof searchConversationTranscriptMatches>>;
type TranscriptSearchSuccess = Extract<TranscriptSearchResult, { success: true }>;
export type TranscriptSearchMatch = TranscriptSearchSuccess["results"][number];

interface UseChatWindowTranscriptSearchOptions {
    conversationId: string;
}

export function useChatWindowTranscriptSearch({
    conversationId,
}: UseChatWindowTranscriptSearchOptions) {
    const [showTranscriptSearch, setShowTranscriptSearch] = useState(false);
    const [transcriptSearchQuery, setTranscriptSearchQuery] = useState("");
    const [isTranscriptSearching, setIsTranscriptSearching] = useState(false);
    const [transcriptSearchError, setTranscriptSearchError] = useState<string | null>(null);
    const [transcriptSearchTotal, setTranscriptSearchTotal] = useState(0);
    const [transcriptSearchResults, setTranscriptSearchResults] = useState<TranscriptSearchMatch[]>([]);
    const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
    const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const jumpHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        setTranscriptSearchQuery("");
        setTranscriptSearchError(null);
        setTranscriptSearchResults([]);
        setTranscriptSearchTotal(0);
        setShowTranscriptSearch(false);
        setHighlightedMessageId(null);
        messageRefs.current = {};
    }, [conversationId]);

    useEffect(() => {
        return () => {
            if (jumpHighlightTimeoutRef.current) {
                clearTimeout(jumpHighlightTimeoutRef.current);
                jumpHighlightTimeoutRef.current = null;
            }
        };
    }, []);

    const jumpToMessage = useCallback((messageId: string) => {
        const target = messageRefs.current[messageId];
        if (!target) {
            toast.error("Message not found in current view.");
            return;
        }

        target.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightedMessageId(messageId);
        if (jumpHighlightTimeoutRef.current) {
            clearTimeout(jumpHighlightTimeoutRef.current);
        }
        jumpHighlightTimeoutRef.current = setTimeout(() => {
            setHighlightedMessageId((current) => current === messageId ? null : current);
            jumpHighlightTimeoutRef.current = null;
        }, 2200);
    }, []);

    const handleTranscriptSearch = useCallback(async (overrideQuery?: string) => {
        const query = String(overrideQuery ?? transcriptSearchQuery).trim();
        if (!query) {
            setTranscriptSearchError(null);
            setTranscriptSearchResults([]);
            setTranscriptSearchTotal(0);
            return;
        }

        setIsTranscriptSearching(true);
        setTranscriptSearchError(null);
        try {
            const result = await searchConversationTranscriptMatches(conversationId, {
                query,
                limit: 20,
            });

            if (!result?.success) {
                setTranscriptSearchResults([]);
                setTranscriptSearchTotal(0);
                setTranscriptSearchError(result?.error || "Failed to search transcripts.");
                return;
            }

            setTranscriptSearchResults(result.results || []);
            setTranscriptSearchTotal(Number(result.totalMatches || 0));
        } catch (error: any) {
            setTranscriptSearchResults([]);
            setTranscriptSearchTotal(0);
            setTranscriptSearchError(String(error?.message || "Failed to search transcripts."));
        } finally {
            setIsTranscriptSearching(false);
        }
    }, [conversationId, transcriptSearchQuery]);

    return {
        showTranscriptSearch,
        setShowTranscriptSearch,
        transcriptSearchQuery,
        setTranscriptSearchQuery,
        isTranscriptSearching,
        transcriptSearchError,
        transcriptSearchTotal,
        transcriptSearchResults,
        highlightedMessageId,
        messageRefs,
        jumpToMessage,
        handleTranscriptSearch,
    };
}
