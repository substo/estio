import { useCallback, useEffect, useRef, useState } from "react";
import { getAgentExecutionDetail, getAgentExecutionHistoryPage, getContactInsightsAction, getTraceTreeAction } from "../actions";

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
    const [historyCursor, setHistoryCursor] = useState<string | null>(null);
    const [hasMoreHistory, setHasMoreHistory] = useState(false);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
    const [loadingTraceDetails, setLoadingTraceDetails] = useState(false);
    const rawTraceRef = useRef<any>(null);

    useEffect(() => {
        rawTraceRef.current = rawTrace;
    }, [rawTrace]);

    const handleSelectTrace = useCallback(async (trace: any) => {
        setRawTrace(trace);
        setTraceTree(null);
        setInsights([]);
        setLoadingTraceDetails(false);
    }, []);

    const loadTraceDetails = useCallback(async () => {
        const selectedTrace = rawTraceRef.current;
        if (!conversationId || !selectedTrace?.id || loadingTraceDetails) return;

        setLoadingTraceDetails(true);
        try {
            const [detail, tree, recentInsights] = await Promise.all([
                getAgentExecutionDetail(conversationId, selectedTrace.id),
                selectedTrace.traceId ? getTraceTreeAction(selectedTrace.traceId) : Promise.resolve(null),
                contactId ? getContactInsightsAction(contactId) : Promise.resolve([]),
            ]);

            if (detail && rawTraceRef.current?.id === selectedTrace.id) setRawTrace(detail);
            if (rawTraceRef.current?.id === selectedTrace.id) {
                setTraceTree(tree);
                setInsights(recentInsights);
            }
        } catch (e) {
            console.error("Failed to load trace details", e);
        } finally {
            setLoadingTraceDetails(false);
        }
    }, [contactId, conversationId, loadingTraceDetails]);

    const refreshExecutionHistory = useCallback((autoSelectLatest = false) => {
        if (!conversationId) return;

        setLoadingHistory(true);
        getAgentExecutionHistoryPage(conversationId, { limit: 10 }).then(page => {
            setExecutionHistory(page.items);
            setHistoryCursor(page.nextCursor);
            setHasMoreHistory(page.hasMore);
            if (autoSelectLatest && !rawTraceRef.current && page.items.length > 0) {
                void handleSelectTrace(page.items[0]);
            }
            setLoadingHistory(false);
        }).catch((e) => {
            console.error("Failed to load trace history", e);
            setLoadingHistory(false);
        });
    }, [conversationId, handleSelectTrace]);

    const loadMoreExecutionHistory = useCallback(async () => {
        if (!conversationId || !historyCursor || loadingMoreHistory) return;

        setLoadingMoreHistory(true);
        try {
            const page = await getAgentExecutionHistoryPage(conversationId, { cursor: historyCursor, limit: 10 });
            setExecutionHistory((current) => [...current, ...page.items]);
            setHistoryCursor(page.nextCursor);
            setHasMoreHistory(page.hasMore);
        } catch (e) {
            console.error("Failed to load more trace history", e);
        } finally {
            setLoadingMoreHistory(false);
        }
    }, [conversationId, historyCursor, loadingMoreHistory]);

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
        hasMoreHistory,
        loadingHistory,
        loadingMoreHistory,
        loadingTraceDetails,
        handleSelectTrace,
        loadTraceDetails,
        loadMoreExecutionHistory,
        refreshExecutionHistory,
    };
}
