import { useEffect, useState } from "react";
import { getConversationTranscriptUsage } from "../actions";

const EMPTY_TRANSCRIPT_USAGE = {
    totalTokens: 0,
    totalCost: 0,
    transcriptCount: 0,
    extractionCount: 0,
};

export function useCoordinatorTranscriptUsage(conversationId?: string | null) {
    const [transcriptUsage, setTranscriptUsage] = useState(EMPTY_TRANSCRIPT_USAGE);

    useEffect(() => {
        if (!conversationId) return;

        let cancelled = false;
        const fetchTimer = setTimeout(() => {
            if (cancelled) return;
            getConversationTranscriptUsage(conversationId)
                .then((res) => {
                    if (!cancelled) setTranscriptUsage(res);
                })
                .catch(() => { });
        }, 150);

        return () => {
            cancelled = true;
            clearTimeout(fetchTimer);
        };
    }, [conversationId]);

    return transcriptUsage;
}
