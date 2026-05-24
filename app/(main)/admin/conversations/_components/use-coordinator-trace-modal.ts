import { useCallback, useEffect, useRef, useState } from "react";
import { getAgentExecutions, getContactInsightsAction, getTraceTreeAction } from "../actions";

interface UseCoordinatorTraceModalOptions {
    conversationId?: string | null;
    contactId?: string | null;
}

export function useCoordinatorTraceModal({
    conversationId,
    contactId,
}: UseCoordinatorTraceModalOptions) {
    const [rawTrace, setRawTrace] = useState<any>(null);
    const [traceTree, setTraceTree] = useState<any>(null);
    const [insights, setInsights] = useState<any[]>([]);
    const [traceModalOpen, setTraceModalOpen] = useState(false);
    const [executionHistory, setExecutionHistory] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [loadingTraceDetails, setLoadingTraceDetails] = useState(false);
    const rawTraceRef = useRef<any>(null);

    useEffect(() => {
        rawTraceRef.current = rawTrace;
    }, [rawTrace]);

    const handleSelectTrace = useCallback(async (trace: any) => {
        setRawTrace(trace);
        setTraceTree(null);
        setInsights([]);
        setLoadingTraceDetails(true);

        try {
            if (trace.traceId) {
                const tree = await getTraceTreeAction(trace.traceId);
                setTraceTree(tree);
            }

            if (contactId) {
                const recentInsights = await getContactInsightsAction(contactId);
                setInsights(recentInsights);
            }
        } catch (e) {
            console.error("Failed to load trace details", e);
        } finally {
            setLoadingTraceDetails(false);
        }
    }, [contactId]);

    const refreshExecutionHistory = useCallback((autoSelectLatest = false) => {
        if (!conversationId) return;

        setLoadingHistory(true);
        getAgentExecutions(conversationId).then(history => {
            setExecutionHistory(history);
            if (autoSelectLatest && !rawTraceRef.current && history.length > 0) {
                void handleSelectTrace(history[0]);
            }
            setLoadingHistory(false);
        });
    }, [conversationId, handleSelectTrace]);

    useEffect(() => {
        if (traceModalOpen && conversationId) {
            refreshExecutionHistory(true);
        }
    }, [traceModalOpen, conversationId, refreshExecutionHistory]);

    return {
        rawTrace,
        setRawTrace,
        traceTree,
        setTraceTree,
        insights,
        traceModalOpen,
        setTraceModalOpen,
        executionHistory,
        loadingHistory,
        loadingTraceDetails,
        handleSelectTrace,
        refreshExecutionHistory,
    };
}
