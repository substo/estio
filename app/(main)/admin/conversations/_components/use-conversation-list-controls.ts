'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Conversation } from "@/lib/ghl/conversations";

const SEARCH_DEBOUNCE_MS = 350;

type UseConversationListControlsArgs = {
    conversations: Conversation[];
    searchQuery: string;
    onSearchChange?: (q: string) => void;
    effectiveViewMode: 'chats' | 'deals';
    hasMore: boolean;
    isLoadingMore: boolean;
    onLoadMore?: () => void;
    onHoverConversation?: (id: string) => void;
};

export function useConversationListControls({
    conversations,
    searchQuery,
    onSearchChange,
    effectiveViewMode,
    hasMore,
    isLoadingMore,
    onLoadMore,
    onHoverConversation,
}: UseConversationListControlsArgs) {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isSearchExpanded, setIsSearchExpanded] = useState(!!searchQuery);
    const [localQuery, setLocalQuery] = useState(searchQuery || "");
    const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const listScrollRef = useRef<HTMLDivElement | null>(null);
    const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

    const cancelPendingSearch = useCallback(() => {
        if (searchDebounceRef.current) {
            clearTimeout(searchDebounceRef.current);
            searchDebounceRef.current = null;
        }
    }, []);

    const commitSearch = useCallback((query: string) => {
        cancelPendingSearch();
        onSearchChange?.(query);
    }, [cancelPendingSearch, onSearchChange]);

    const clearSearch = useCallback(() => {
        setLocalQuery("");
        commitSearch("");
    }, [commitSearch]);

    useEffect(() => {
        setLocalQuery(searchQuery || "");
        if (searchQuery) setIsSearchExpanded(true);
    }, [searchQuery]);

    useEffect(() => {
        if (!onSearchChange) return;

        const trimmedLocalQuery = localQuery.trim();
        const trimmedSearchQuery = searchQuery.trim();

        if (!trimmedLocalQuery) {
            cancelPendingSearch();
            if (trimmedSearchQuery) {
                onSearchChange("");
            }
            return;
        }

        if (trimmedLocalQuery === trimmedSearchQuery) {
            cancelPendingSearch();
            return;
        }

        searchDebounceRef.current = setTimeout(() => {
            commitSearch(localQuery);
        }, SEARCH_DEBOUNCE_MS);

        return cancelPendingSearch;
    }, [cancelPendingSearch, commitSearch, localQuery, onSearchChange, searchQuery]);

    const handleMouseEnter = () => {
        if (closeTimeoutRef.current) {
            clearTimeout(closeTimeoutRef.current);
            closeTimeoutRef.current = null;
        }
        setIsMenuOpen(true);
    };

    const handleMouseLeave = () => {
        closeTimeoutRef.current = setTimeout(() => {
            setIsMenuOpen(false);
            closeTimeoutRef.current = null;
        }, 150);
    };

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
        handleMouseEnter,
        handleMouseLeave,
        listScrollRef,
        loadMoreSentinelRef,
    };
}
