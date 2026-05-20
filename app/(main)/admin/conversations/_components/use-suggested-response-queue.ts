'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    acceptSuggestedResponse,
    listSuggestedResponses,
    rejectSuggestedResponse,
} from '../actions';
import { toast } from '@/components/ui/use-toast';
import type { SuggestedResponseQueueItem } from './suggested-response-queue';

type SuggestedResponseQueueViewMode = 'chats' | 'deals';

type UseSuggestedResponseQueueParams = {
    viewMode: SuggestedResponseQueueViewMode;
    activeConversationId?: string | null;
    activeDealId?: string | null;
    chatTimelineInitialPainted: boolean;
    dealTimelineInitialPainted: boolean;
    insertIntoComposer: (body: string, id: string) => void;
    trackClientRequest: (kind: string, metadata?: Record<string, unknown>) => void;
};

export function useSuggestedResponseQueue({
    viewMode,
    activeConversationId,
    activeDealId,
    chatTimelineInitialPainted,
    dealTimelineInitialPainted,
    insertIntoComposer,
    trackClientRequest,
}: UseSuggestedResponseQueueParams) {
    const [suggestedResponseQueue, setSuggestedResponseQueue] = useState<SuggestedResponseQueueItem[]>([]);
    const [loadingSuggestedResponseQueue, setLoadingSuggestedResponseQueue] = useState(false);

    const suggestedResponseQueueRequestIdRef = useRef(0);
    const suggestedResponseQueueIdleHandleRef = useRef<number | null>(null);
    const suggestedResponseQueueTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const suggestedResponseQueueConversationId = viewMode === 'chats' ? String(activeConversationId || "").trim() : "";
    const suggestedResponseQueueDealId = viewMode === 'deals' ? String(activeDealId || "").trim() : "";
    const suggestedResponseQueueScopeKey = suggestedResponseQueueConversationId
        ? `chat:${suggestedResponseQueueConversationId}`
        : suggestedResponseQueueDealId
            ? `deal:${suggestedResponseQueueDealId}`
            : "";
    const suggestedResponseQueueReady = viewMode === 'chats'
        ? (!!suggestedResponseQueueConversationId && chatTimelineInitialPainted)
        : (!!suggestedResponseQueueDealId && dealTimelineInitialPainted);

    const clearSuggestedResponseQueueAutoLoad = useCallback(() => {
        if (
            suggestedResponseQueueIdleHandleRef.current !== null
            && typeof window !== 'undefined'
            && 'cancelIdleCallback' in window
        ) {
            (window as any).cancelIdleCallback(suggestedResponseQueueIdleHandleRef.current);
            suggestedResponseQueueIdleHandleRef.current = null;
        }
        if (suggestedResponseQueueTimeoutRef.current) {
            clearTimeout(suggestedResponseQueueTimeoutRef.current);
            suggestedResponseQueueTimeoutRef.current = null;
        }
    }, []);

    const refreshSuggestedResponseQueue = useCallback(async (options?: { trigger?: string }) => {
        if (!suggestedResponseQueueConversationId && !suggestedResponseQueueDealId) {
            setSuggestedResponseQueue([]);
            setLoadingSuggestedResponseQueue(false);
            return;
        }

        const requestId = suggestedResponseQueueRequestIdRef.current + 1;
        suggestedResponseQueueRequestIdRef.current = requestId;
        trackClientRequest("suggested_response_queue_load", {
            scopeKey: suggestedResponseQueueScopeKey,
            trigger: options?.trigger || "manual",
        });
        setLoadingSuggestedResponseQueue(true);

        try {
            const rows = await listSuggestedResponses({
                conversationId: suggestedResponseQueueConversationId || undefined,
                dealId: suggestedResponseQueueDealId || undefined,
                status: "pending",
                limit: 40,
            });
            if (suggestedResponseQueueRequestIdRef.current !== requestId) return;
            setSuggestedResponseQueue(Array.isArray(rows) ? (rows as SuggestedResponseQueueItem[]) : []);
        } catch (error: any) {
            if (suggestedResponseQueueRequestIdRef.current !== requestId) return;
            console.error("Failed to load suggested responses:", error);
            toast({
                title: "Queue Error",
                description: error?.message || "Failed to load suggested responses.",
                variant: "destructive",
            });
            setSuggestedResponseQueue([]);
        } finally {
            if (suggestedResponseQueueRequestIdRef.current === requestId) {
                setLoadingSuggestedResponseQueue(false);
            }
        }
    }, [
        suggestedResponseQueueConversationId,
        suggestedResponseQueueDealId,
        suggestedResponseQueueScopeKey,
        trackClientRequest,
    ]);

    useEffect(() => {
        clearSuggestedResponseQueueAutoLoad();
        suggestedResponseQueueRequestIdRef.current += 1;
        setSuggestedResponseQueue([]);
        setLoadingSuggestedResponseQueue(false);
    }, [clearSuggestedResponseQueueAutoLoad, suggestedResponseQueueScopeKey]);

    useEffect(() => {
        if (!suggestedResponseQueueScopeKey || !suggestedResponseQueueReady) return;

        clearSuggestedResponseQueueAutoLoad();

        const runAutoLoad = () => {
            suggestedResponseQueueIdleHandleRef.current = null;
            suggestedResponseQueueTimeoutRef.current = null;
            void refreshSuggestedResponseQueue({ trigger: "auto" });
        };

        if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
            suggestedResponseQueueIdleHandleRef.current = (window as any).requestIdleCallback(runAutoLoad, { timeout: 1200 });
        } else {
            suggestedResponseQueueTimeoutRef.current = setTimeout(runAutoLoad, 250);
        }

        return clearSuggestedResponseQueueAutoLoad;
    }, [
        clearSuggestedResponseQueueAutoLoad,
        refreshSuggestedResponseQueue,
        suggestedResponseQueueReady,
        suggestedResponseQueueScopeKey,
    ]);

    useEffect(() => {
        return () => {
            clearSuggestedResponseQueueAutoLoad();
        };
    }, [clearSuggestedResponseQueueAutoLoad]);

    const handleAcceptSuggestedResponse = useCallback(async (
        suggestedResponseId: string,
        mode: "insertOnly" | "sendNow"
    ) => {
        const result = await acceptSuggestedResponse(suggestedResponseId, { mode });
        if (!result?.success) {
            toast({
                title: "Action Failed",
                description: String(result?.error || "Could not accept suggested response."),
                variant: "destructive",
            });
            return;
        }

        if (mode === "insertOnly") {
            insertIntoComposer(String(result.body || ""), result.id);
            toast({
                title: "Added to Composer",
                description: "Suggested response inserted for review.",
            });
        } else {
            toast({
                title: "Message Sent",
                description: "Suggested response was accepted and sent.",
            });
        }

        await refreshSuggestedResponseQueue({ trigger: "accept" });
    }, [insertIntoComposer, refreshSuggestedResponseQueue]);

    const handleRejectSuggestedResponse = useCallback(async (suggestedResponseId: string, reason?: string | null) => {
        const result = await rejectSuggestedResponse(suggestedResponseId, reason);
        if (!result?.success) {
            toast({
                title: "Action Failed",
                description: String(result?.error || "Could not reject suggested response."),
                variant: "destructive",
            });
            return;
        }

        toast({ title: "Suggestion Rejected" });
        await refreshSuggestedResponseQueue({ trigger: "reject" });
    }, [refreshSuggestedResponseQueue]);

    return {
        suggestedResponseQueue,
        loadingSuggestedResponseQueue,
        refreshSuggestedResponseQueue,
        handleAcceptSuggestedResponse,
        handleRejectSuggestedResponse,
    };
}
