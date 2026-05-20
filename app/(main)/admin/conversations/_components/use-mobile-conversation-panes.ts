'use client';

import { useCallback, useEffect, useRef, useState, type TouchEvent as ReactTouchEvent } from 'react';

export type MobilePane = 'list' | 'window' | 'mission';

type SwipeDirection = 'left' | 'right';

type MobileGestureState = {
    startX: number;
    startY: number;
    startTime: number;
    lastX: number;
    lastY: number;
    lastTime: number;
    containerWidth: number;
    containerLeft: number;
    target: EventTarget | null;
    blocked: boolean;
};

type ConversationViewMode = 'chats' | 'deals';

type UseMobileConversationPanesArgs = {
    viewMode: ConversationViewMode;
    activeId: string | null;
    activeDealId: string | null;
    urlConversationId: string | null;
    activeConversationOpen: boolean;
};

const MOBILE_EDGE_SWIPE_ZONE_PX = 16;
const MOBILE_MIN_SWIPE_DISTANCE_PX = 72;
const MOBILE_MIN_SWIPE_VELOCITY = 0.32; // px / ms
const MOBILE_HORIZONTAL_DOMINANCE_RATIO = 1.2;

function isTextInputLikeTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    if (target.closest('[data-no-pane-swipe]')) return true;
    return !!target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
}

function getHorizontalScrollableAncestor(target: EventTarget | null, boundary: HTMLElement | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    let current: HTMLElement | null = target as HTMLElement;

    while (current) {
        const explicitHorizontalScroll = current.hasAttribute('data-horizontal-scroll');
        const style = window.getComputedStyle(current);
        const overflowX = style.overflowX;
        const canScrollByStyle = overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay';
        const hasHorizontalOverflow = current.scrollWidth > current.clientWidth + 1;

        if ((explicitHorizontalScroll || canScrollByStyle) && hasHorizontalOverflow) {
            return current;
        }

        if (boundary && current === boundary) break;
        current = current.parentElement;
    }

    return null;
}

function canHorizontalScrollerConsumeGesture(scroller: HTMLElement, direction: SwipeDirection): boolean {
    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
    if (maxScrollLeft <= 1) return false;

    if (direction === 'left') {
        // Finger moved left; user likely intends to reveal content on the right.
        return scroller.scrollLeft < maxScrollLeft - 1;
    }

    // Finger moved right; user likely intends to reveal content on the left.
    return scroller.scrollLeft > 1;
}

export function getNextMobilePaneForSwipe(currentPane: MobilePane, swipeDirection: SwipeDirection): MobilePane {
    if (swipeDirection === 'left') {
        if (currentPane === 'list') return 'window';
        if (currentPane === 'window') return 'mission';
        return currentPane;
    }

    if (currentPane === 'mission') return 'window';
    if (currentPane === 'window') return 'list';
    return currentPane;
}

function getMobilePaneHint(viewMode: ConversationViewMode, mobilePane: MobilePane, activeDealId: string | null, activeConversationOpen: boolean): string | null {
    if (viewMode === 'deals') {
        if (!activeDealId) return null;
        if (mobilePane === 'list') return 'Edge-swipe left to open timeline';
        if (mobilePane === 'window') return 'Edge-swipe left for Mission Control';
        return 'Edge-swipe right to return to timeline';
    }

    if (!activeConversationOpen) return null;
    if (mobilePane === 'list') return 'Edge-swipe left to open conversation';
    if (mobilePane === 'window') return 'Edge-swipe left for Mission Control';
    return 'Edge-swipe right to return to conversation';
}

export function useMobileConversationPanes({
    viewMode,
    activeId,
    activeDealId,
    urlConversationId,
    activeConversationOpen,
}: UseMobileConversationPanesArgs) {
    const [isMobileViewport, setIsMobileViewport] = useState(false);
    const [mobilePane, setMobilePane] = useState<MobilePane>('list');
    const hasInitializedMobilePaneRef = useRef(false);
    const mobileGestureRef = useRef<MobileGestureState | null>(null);
    const mobilePaneContainerRef = useRef<HTMLDivElement | null>(null);
    const mobilePaneHostRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const mediaQuery = window.matchMedia('(max-width: 1023px)');
        const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
        updateViewport();
        mediaQuery.addEventListener('change', updateViewport);
        return () => mediaQuery.removeEventListener('change', updateViewport);
    }, []);

    useEffect(() => {
        if (!isMobileViewport) {
            hasInitializedMobilePaneRef.current = false;
            setMobilePane('list');
            return;
        }

        if (hasInitializedMobilePaneRef.current) return;
        hasInitializedMobilePaneRef.current = true;
        if (viewMode === 'deals') {
            setMobilePane(activeDealId ? 'window' : 'list');
            return;
        }
        setMobilePane(urlConversationId ? 'window' : 'list');
    }, [isMobileViewport, viewMode, activeDealId, urlConversationId]);

    useEffect(() => {
        if (!isMobileViewport) return;
        const hasWindowPane = viewMode === 'deals' ? !!activeDealId : !!activeId;
        if (!hasWindowPane && mobilePane !== 'list') {
            setMobilePane('list');
        }
    }, [isMobileViewport, viewMode, activeId, activeDealId, mobilePane]);

    const handleMobileTouchStart = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
        if (!isMobileViewport) return;
        const touch = event.changedTouches[0];
        if (!touch) return;

        const containerRect = event.currentTarget.getBoundingClientRect();
        const containerWidth = event.currentTarget.clientWidth || window.innerWidth || 0;
        mobileGestureRef.current = {
            startX: touch.clientX,
            startY: touch.clientY,
            startTime: Date.now(),
            lastX: touch.clientX,
            lastY: touch.clientY,
            lastTime: Date.now(),
            containerWidth,
            containerLeft: containerRect.left || 0,
            target: event.target,
            blocked: isTextInputLikeTarget(event.target),
        };
    }, [isMobileViewport]);

    const handleMobileTouchMove = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
        if (!isMobileViewport) return;
        const gesture = mobileGestureRef.current;
        if (!gesture) return;

        const touch = event.changedTouches[0];
        if (!touch) return;

        gesture.lastX = touch.clientX;
        gesture.lastY = touch.clientY;
        gesture.lastTime = Date.now();

        if (gesture.blocked) return;

        const absDeltaX = Math.abs(gesture.lastX - gesture.startX);
        const absDeltaY = Math.abs(gesture.lastY - gesture.startY);
        if (absDeltaY > absDeltaX * MOBILE_HORIZONTAL_DOMINANCE_RATIO && absDeltaY > 18) {
            gesture.blocked = true;
        }
    }, [isMobileViewport]);

    const handleMobileTouchEnd = useCallback((event: ReactTouchEvent<HTMLDivElement>) => {
        if (!isMobileViewport) return;
        const gesture = mobileGestureRef.current;
        mobileGestureRef.current = null;
        if (!gesture || gesture.blocked) return;

        const touch = event.changedTouches[0];
        if (!touch) return;

        const endTime = Date.now();
        const deltaX = touch.clientX - gesture.startX;
        const deltaY = touch.clientY - gesture.startY;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);

        if (absDeltaX <= absDeltaY * MOBILE_HORIZONTAL_DOMINANCE_RATIO) return;

        const durationMs = Math.max(endTime - gesture.startTime, 1);
        const velocity = absDeltaX / durationMs;
        if (absDeltaX < MOBILE_MIN_SWIPE_DISTANCE_PX && velocity < MOBILE_MIN_SWIPE_VELOCITY) return;

        const swipeDirection: SwipeDirection = deltaX < 0 ? 'left' : 'right';
        const startXWithinContainer = gesture.startX - gesture.containerLeft;
        const withinEdgeZone = swipeDirection === 'left'
            ? startXWithinContainer >= gesture.containerWidth - MOBILE_EDGE_SWIPE_ZONE_PX
            : startXWithinContainer <= MOBILE_EDGE_SWIPE_ZONE_PX;
        if (!withinEdgeZone) return;

        const containerEl = mobilePaneContainerRef.current;
        const horizontalScroller = getHorizontalScrollableAncestor(gesture.target, containerEl);
        if (horizontalScroller && canHorizontalScrollerConsumeGesture(horizontalScroller, swipeDirection)) {
            return;
        }

        const hasWindowPane = viewMode === 'deals' ? !!activeDealId : !!activeId;
        if (!hasWindowPane) return;

        const nextMobilePane = getNextMobilePaneForSwipe(mobilePane, swipeDirection);
        if (nextMobilePane !== mobilePane) {
            setMobilePane(nextMobilePane);
        }
    }, [isMobileViewport, viewMode, activeDealId, activeId, mobilePane]);

    const isMobileThreadOpen = viewMode === 'chats'
        ? activeConversationOpen
        : !!activeDealId;
    const currentMobilePane: MobilePane = isMobileThreadOpen
        ? mobilePane
        : 'list';
    const mobilePaneHint = getMobilePaneHint(viewMode, mobilePane, activeDealId, activeConversationOpen);

    return {
        isMobileViewport,
        mobilePane,
        setMobilePane,
        currentMobilePane,
        mobilePaneHint,
        mobilePaneContainerRef,
        mobilePaneHostRef,
        handleMobileTouchStart,
        handleMobileTouchMove,
        handleMobileTouchEnd,
    };
}
