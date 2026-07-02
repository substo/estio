import { Dispatch, SetStateAction, useCallback, useState } from "react";

const COLLAPSED_VALUE = "collapsed";
const EXPANDED_VALUE = "expanded";

function readStoredCollapsed(storageKey: string, fallback: boolean): boolean {
    if (typeof window === "undefined") return fallback;

    try {
        const stored = window.localStorage.getItem(storageKey);
        if (stored === COLLAPSED_VALUE) return true;
        if (stored === EXPANDED_VALUE) return false;
    } catch {
        return fallback;
    }

    return fallback;
}

function writeStoredCollapsed(storageKey: string, collapsed: boolean) {
    if (typeof window === "undefined") return;

    try {
        window.localStorage.setItem(storageKey, collapsed ? COLLAPSED_VALUE : EXPANDED_VALUE);
    } catch {
        // Ignore storage failures so the UI toggle still works in restricted browser contexts.
    }
}

export function isMobileAiSuggestionDefaultCollapsed(): boolean {
    return typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
}

export function usePersistentAiSuggestionsCollapsed(
    storageKey: string,
    defaultCollapsed = false
): [boolean, Dispatch<SetStateAction<boolean>>] {
    const [collapsed, setCollapsedState] = useState(() => readStoredCollapsed(storageKey, defaultCollapsed));

    const setCollapsed = useCallback<Dispatch<SetStateAction<boolean>>>((nextValue) => {
        setCollapsedState((current) => {
            const next = typeof nextValue === "function"
                ? (nextValue as (current: boolean) => boolean)(current)
                : nextValue;
            writeStoredCollapsed(storageKey, next);
            return next;
        });
    }, [storageKey]);

    return [collapsed, setCollapsed];
}
