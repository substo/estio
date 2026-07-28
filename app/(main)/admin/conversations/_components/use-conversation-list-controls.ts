'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation } from "@/lib/ghl/conversations";

type UseConversationListControlsArgs = {
    conversations: Conversation[];
    searchQuery: string;
    onSearchChange?: (q: string) => void;
    effectiveViewMode: 'chats' | 'deals';
    hasMore: boolean;
    isLoadingMore: boolean;
    onLoadMore?: () => void;
};

export function useConversationListControls({
    conversations,
    searchQuery,
    onSearchChange,
    effectiveViewMode,
    hasMore,
    isLoadingMore,
    onLoadMore,
}: UseConversationListControlsArgs) {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isSearchExpanded, setIsSearchExpanded] = useState(!!searchQuery);
    const [localQuery, setLocalQueryState] = useState(searchQuery || "");
    const listScrollRef = useRef<HTMLDivElement | null>(null);
    const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

    const commitSearch = useCallback((query: string) => {
        onSearchChange?.(query);
    }, [onSearchChange]);

    const setLocalQuery = useCallback((query: string) => {
        setLocalQueryState(query);
        onSearchChange?.(query);
    }, [onSearchChange]);

    const clearSearch = useCallback(() => {
        setLocalQueryState("");
        commitSearch("");
    }, [commitSearch]);

    useEffect(() => {
        setLocalQueryState(searchQuery || "");
        if (searchQuery) setIsSearchExpanded(true);
    }, [searchQuery]);

    useEffect(() => {
        if (effectiveViewMode !== 'chats') return;
        if (!hasMore || isLoadingMore || !onLoadMore) return;
        if (!listScrollRef.current || !loadMoreSentinelRef.current) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    onLoadMore();
                }
            },
            {
                root: listScrollRef.current,
                rootMargin: '200px 0px',
                threshold: 0.01,
            }
        );

        observer.observe(loadMoreSentinelRef.current);
        return () => observer.disconnect();
    }, [effectiveViewMode, hasMore, isLoadingMore, onLoadMore, conversations.length]);

    return {
        isMenuOpen,
        setIsMenuOpen,
        isSearchExpanded,
        setIsSearchExpanded,
        localQuery,
        setLocalQuery,
        commitSearch,
        clearSearch,
        listScrollRef,
        loadMoreSentinelRef,
    };
}
