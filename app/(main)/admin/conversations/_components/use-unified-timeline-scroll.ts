'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { calculatePrependScrollTop } from '@/lib/conversations/thread-hydration';

interface UseUnifiedTimelineScrollOptions {
    dealId: string;
    timelineEvents: any[];
    loading: boolean;
    onInitialPaintReady?: () => void;
}

export function useUnifiedTimelineScroll({
    dealId,
    timelineEvents,
    loading,
    onInitialPaintReady,
}: UseUnifiedTimelineScrollOptions) {
    const timelineRef = useRef<HTMLDivElement>(null);
    const timelineContentRef = useRef<HTMLDivElement>(null);
    const shouldStickToBottomRef = useRef(true);
    const hasForcedInitialBottomSnapRef = useRef(false);
    const hasReportedInitialPaintRef = useRef(false);
    const previousEventIdsRef = useRef<string[]>([]);
    const previousScrollHeightRef = useRef(0);
    const previousScrollTopRef = useRef(0);
    const [isTimelineReady, setIsTimelineReady] = useState(false);

    const snapToBottom = useCallback(() => {
        const container = timelineRef.current;
        if (!container) return;
        container.scrollTop = container.scrollHeight;
        previousScrollTopRef.current = container.scrollTop;
        previousScrollHeightRef.current = container.scrollHeight;
    }, []);

    useEffect(() => {
        shouldStickToBottomRef.current = true;
        hasForcedInitialBottomSnapRef.current = false;
        hasReportedInitialPaintRef.current = false;
        previousEventIdsRef.current = [];
        previousScrollHeightRef.current = 0;
        previousScrollTopRef.current = 0;
        setIsTimelineReady(false);
    }, [dealId]);

    useEffect(() => {
        const container = timelineRef.current;
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
    }, [dealId]);

    useLayoutEffect(() => {
        const container = timelineRef.current;
        if (!container) return;

        const previousIds = previousEventIdsRef.current;
        const nextIds = timelineEvents.map((event) => String(event?.id || ""));
        const previousFirstId = previousIds[0] || null;
        const previousLastId = previousIds[previousIds.length - 1] || null;
        const nextFirstId = nextIds[0] || null;
        const nextLastId = nextIds[nextIds.length - 1] || null;

        const didPrependOlderEvents = (
            previousIds.length > 0
            && nextIds.length > previousIds.length
            && !!previousFirstId
            && !!previousLastId
            && nextLastId === previousLastId
            && nextFirstId !== previousFirstId
        );

        if (didPrependOlderEvents) {
            const compensatedTop = calculatePrependScrollTop(
                previousScrollTopRef.current,
                previousScrollHeightRef.current,
                container.scrollHeight
            );
            container.scrollTop = compensatedTop;
            previousScrollTopRef.current = compensatedTop;
        }

        previousEventIdsRef.current = nextIds;
        previousScrollHeightRef.current = container.scrollHeight;
        previousScrollTopRef.current = container.scrollTop;
    }, [dealId, timelineEvents]);

    useLayoutEffect(() => {
        if (loading) return;
        if (timelineEvents.length === 0) return;
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
    }, [dealId, loading, onInitialPaintReady, snapToBottom, timelineEvents]);

    useEffect(() => {
        if (!loading && timelineEvents.length === 0) {
            setIsTimelineReady(true);
            if (!hasReportedInitialPaintRef.current) {
                hasReportedInitialPaintRef.current = true;
                onInitialPaintReady?.();
            }
        }
    }, [loading, onInitialPaintReady, timelineEvents]);

    useLayoutEffect(() => {
        if (loading) return;
        if (!timelineEvents.length) return;
        if (!shouldStickToBottomRef.current) return;
        snapToBottom();
    }, [dealId, loading, snapToBottom, timelineEvents]);

    useEffect(() => {
        const container = timelineRef.current;
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
    }, [dealId, snapToBottom]);

    return {
        timelineRef,
        timelineContentRef,
        isTimelineReady,
    };
}
