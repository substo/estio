import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Message } from "@/lib/ghl/conversations";
import { calculatePrependScrollTop } from "@/lib/conversations/thread-hydration";

export interface ActivityLogItem {
    id: string;
    type: "activity";
    createdAt: string;
    action: string;
    changes?: any;
    user?: { name: string | null; email: string | null } | null;
    clientMutationId?: string | null;
    pending?: boolean;
}

export type ChatWindowTimelineItem =
    | {
        kind: "message";
        sortDate: number;
        message: Message;
    }
    | {
        kind: "activity";
        sortDate: number;
        activity: ActivityLogItem;
    };

function resolveTimelineSortTimestampMs(value: string | null | undefined): number {
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
}

interface UseChatWindowTimelineScrollOptions {
    conversationId: string;
    messages: Message[];
    activityLog: ActivityLogItem[];
    loading: boolean;
    onInitialPaintReady?: () => void;
}

export function useChatWindowTimelineScroll({
    conversationId,
    messages,
    activityLog,
    loading,
    onInitialPaintReady,
}: UseChatWindowTimelineScrollOptions) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const timelineContentRef = useRef<HTMLDivElement>(null);
    const shouldStickToBottomRef = useRef(true);
    const hasForcedInitialBottomSnapRef = useRef(false);
    const previousMessageIdsRef = useRef<string[]>([]);
    const previousScrollHeightRef = useRef(0);
    const previousScrollTopRef = useRef(0);
    const knownMessageIdsRef = useRef<Set<string>>(new Set());
    const previousTailMessageIdRef = useRef<string | null>(null);
    const previousPendingActivityIdsRef = useRef<Set<string>>(new Set());
    const hasInitializedKnownMessagesRef = useRef(false);
    const hasReportedInitialPaintRef = useRef(false);
    const [isTimelineReady, setIsTimelineReady] = useState(false);

    const timelineItems = useMemo<ChatWindowTimelineItem[]>(() => {
        const msgItems = messages.map((message) => ({
            kind: "message" as const,
            sortDate: resolveTimelineSortTimestampMs(message.dateAdded),
            message,
        }));
        const actItems = activityLog.map((activity) => ({
            kind: "activity" as const,
            sortDate: resolveTimelineSortTimestampMs(activity.createdAt),
            activity,
        }));
        return [...msgItems, ...actItems].sort((left, right) => {
            if (left.sortDate !== right.sortDate) return left.sortDate - right.sortDate;
            const leftId = left.kind === "message" ? left.message.id : left.activity.id;
            const rightId = right.kind === "message" ? right.message.id : right.activity.id;
            return String(leftId || "").localeCompare(String(rightId || ""));
        });
    }, [messages, activityLog]);

    const messageIndexById = useMemo(() => {
        const indexMap = new Map<string, number>();
        messages.forEach((message, index) => {
            indexMap.set(message.id, index);
        });
        return indexMap;
    }, [messages]);

    const previousTailMessageId = previousTailMessageIdRef.current;
    const previousTailIndex = previousTailMessageId
        ? messages.findIndex((message) => message.id === previousTailMessageId)
        : -1;

    const snapToBottom = useCallback(() => {
        const container = scrollRef.current;
        if (!container) return;
        container.scrollTop = container.scrollHeight;
        previousScrollTopRef.current = container.scrollTop;
        previousScrollHeightRef.current = container.scrollHeight;
    }, []);

    const getEnableMountAnimation = useCallback((messageId: string) => {
        const messageIndex = messageIndexById.get(messageId) ?? -1;
        return (
            hasInitializedKnownMessagesRef.current
            && !knownMessageIdsRef.current.has(messageId)
            && previousTailIndex >= 0
            && messageIndex > previousTailIndex
        );
    }, [messageIndexById, previousTailIndex]);

    const resetTimelineScroll = useCallback(() => {
        shouldStickToBottomRef.current = true;
        hasForcedInitialBottomSnapRef.current = false;
        previousMessageIdsRef.current = [];
        previousScrollHeightRef.current = 0;
        previousScrollTopRef.current = 0;
        knownMessageIdsRef.current = new Set();
        previousTailMessageIdRef.current = null;
        previousPendingActivityIdsRef.current = new Set();
        hasInitializedKnownMessagesRef.current = false;
        hasReportedInitialPaintRef.current = false;
        setIsTimelineReady(false);
    }, []);

    useEffect(() => {
        resetTimelineScroll();
    }, [conversationId, resetTimelineScroll]);

    useEffect(() => {
        const container = scrollRef.current;
        if (!container) return;

        const handleScroll = () => {
            const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            shouldStickToBottomRef.current = distanceFromBottom <= 80;
            previousScrollTopRef.current = container.scrollTop;
            previousScrollHeightRef.current = container.scrollHeight;
        };

        handleScroll();
        container.addEventListener("scroll", handleScroll, { passive: true });
        return () => container.removeEventListener("scroll", handleScroll);
    }, [conversationId]);

    useLayoutEffect(() => {
        const container = scrollRef.current;
        if (!container) return;

        const previousIds = previousMessageIdsRef.current;
        const nextIds = messages.map((message) => message.id);
        const previousFirstId = previousIds[0] || null;
        const previousLastId = previousIds[previousIds.length - 1] || null;
        const nextFirstId = nextIds[0] || null;
        const nextLastId = nextIds[nextIds.length - 1] || null;

        const didPrependOlderMessages = (
            previousIds.length > 0
            && nextIds.length > previousIds.length
            && !!previousFirstId
            && !!previousLastId
            && nextLastId === previousLastId
            && nextFirstId !== previousFirstId
        );

        if (didPrependOlderMessages) {
            const compensatedTop = calculatePrependScrollTop(
                previousScrollTopRef.current,
                previousScrollHeightRef.current,
                container.scrollHeight
            );
            container.scrollTop = compensatedTop;
            previousScrollTopRef.current = compensatedTop;
        }

        previousMessageIdsRef.current = nextIds;
        previousScrollHeightRef.current = container.scrollHeight;
        previousScrollTopRef.current = container.scrollTop;
    }, [conversationId, messages]);

    useEffect(() => {
        const currentIds = messages.map((message) => message.id);
        if (!hasInitializedKnownMessagesRef.current) {
            knownMessageIdsRef.current = new Set(currentIds);
            previousTailMessageIdRef.current = currentIds[currentIds.length - 1] || null;
            if (currentIds.length > 0 || !loading) {
                hasInitializedKnownMessagesRef.current = true;
            }
            return;
        }

        knownMessageIdsRef.current = new Set(currentIds);
        previousTailMessageIdRef.current = currentIds[currentIds.length - 1] || null;
    }, [conversationId, messages, loading]);

    useLayoutEffect(() => {
        if (loading) return;
        if (!timelineItems.length) return;
        if (hasForcedInitialBottomSnapRef.current) return;

        hasForcedInitialBottomSnapRef.current = true;
        shouldStickToBottomRef.current = true;
        snapToBottom();
        requestAnimationFrame(() => {
            if (shouldStickToBottomRef.current) {
                snapToBottom();
            }
            setIsTimelineReady(true);
            if (!hasReportedInitialPaintRef.current) {
                hasReportedInitialPaintRef.current = true;
                onInitialPaintReady?.();
            }
        });
    }, [conversationId, loading, onInitialPaintReady, timelineItems.length, snapToBottom]);

    useEffect(() => {
        if (!loading && timelineItems.length === 0) {
            setIsTimelineReady(true);
            if (!hasReportedInitialPaintRef.current) {
                hasReportedInitialPaintRef.current = true;
                onInitialPaintReady?.();
            }
        }
    }, [loading, onInitialPaintReady, timelineItems.length]);

    useLayoutEffect(() => {
        if (loading) return;
        if (!messages.length && !activityLog.length) return;
        if (!shouldStickToBottomRef.current) return;
        snapToBottom();
    }, [conversationId, messages, activityLog, loading, snapToBottom]);

    useLayoutEffect(() => {
        if (loading) return;

        const pendingActivityIds = new Set(
            activityLog
                .filter((activity) => activity?.pending === true)
                .map((activity) => String(activity.id || ""))
                .filter(Boolean)
        );
        const hasNewPendingActivity = Array.from(pendingActivityIds)
            .some((activityId) => !previousPendingActivityIdsRef.current.has(activityId));

        previousPendingActivityIdsRef.current = pendingActivityIds;
        if (!hasNewPendingActivity) return;

        shouldStickToBottomRef.current = true;
        snapToBottom();
        requestAnimationFrame(() => snapToBottom());
    }, [activityLog, loading, snapToBottom]);

    useEffect(() => {
        const container = scrollRef.current;
        const content = timelineContentRef.current;
        if (!container || !content) return;
        if (typeof ResizeObserver === "undefined") return;

        let rafId: number | null = null;
        const scheduleSnap = () => {
            if (!shouldStickToBottomRef.current) return;
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                if (!shouldStickToBottomRef.current) return;
                snapToBottom();
            });
        };

        const observer = new ResizeObserver(() => scheduleSnap());
        observer.observe(content);
        observer.observe(container);
        scheduleSnap();

        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            observer.disconnect();
        };
    }, [conversationId, snapToBottom]);

    return {
        scrollRef,
        timelineContentRef,
        timelineItems,
        isTimelineReady,
        getEnableMountAnimation,
    };
}
