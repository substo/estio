'use client';

import { useEffect, useRef, useState } from 'react';

export type MobilePane = 'list' | 'window' | 'mission';

type ConversationViewMode = 'chats' | 'deals';

export function buildMobileConversationListHref(pathname: string, search: string): string {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    params.delete('id');
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
}

export function shouldPushMobileConversationHistory(args: {
    isMobileViewport: boolean;
    workflowUrlMode: ConversationViewMode | 'tasks';
    activeId: string | null;
    previousUrlConversationId: string | null;
}): boolean {
    return !!(
        args.isMobileViewport
        && args.workflowUrlMode === 'chats'
        && args.activeId
        && !args.previousUrlConversationId
    );
}

type UseMobileConversationPanesArgs = {
    viewMode: ConversationViewMode;
    activeId: string | null;
    activeDealId: string | null;
    urlConversationId: string | null;
    activeConversationOpen: boolean;
};

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

    const isMobileThreadOpen = viewMode === 'chats'
        ? activeConversationOpen
        : !!activeDealId;
    const currentMobilePane: MobilePane = isMobileThreadOpen
        ? mobilePane
        : 'list';

    return {
        isMobileViewport,
        mobilePane,
        setMobilePane,
        currentMobilePane,
        mobilePaneHostRef,
    };
}
