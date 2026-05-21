import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

export const COMPOSER_DRAFTS_SESSION_KEY = "estio:conversation-composer-drafts:v1";

type ComposerInsertSeed = { key: string; body: string } | null;

type InsertComposerDraftPayload = {
    key?: string;
    body?: string;
    conversationId?: string | null;
};

type ComposerDraftsWindow = Window & {
    __ESTIO_INSERT_COMPOSER_DRAFT__?: (payload: InsertComposerDraftPayload) => boolean;
};

export function useConversationComposerDrafts(args: {
    activeConversationIdRef: MutableRefObject<string | null>;
    resetKey: string;
}) {
    const hasSkippedInitialDraftPersistRef = useRef(false);
    const [composerDrafts, setComposerDrafts] = useState<Record<string, string>>({});
    const [composerInsertSeed, setComposerInsertSeed] = useState<ComposerInsertSeed>(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const rawDrafts = window.sessionStorage.getItem(COMPOSER_DRAFTS_SESSION_KEY);
            if (!rawDrafts) return;
            const parsed = JSON.parse(rawDrafts);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
            const restored: Record<string, string> = {};
            for (const [conversationId, draft] of Object.entries(parsed)) {
                const normalizedId = String(conversationId || "").trim();
                const normalizedDraft = String(draft || "");
                if (normalizedId && normalizedDraft) {
                    restored[normalizedId] = normalizedDraft;
                }
            }
            if (Object.keys(restored).length > 0) {
                setComposerDrafts(restored);
            }
        } catch (error) {
            console.warn("Failed to restore conversation drafts:", error);
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!hasSkippedInitialDraftPersistRef.current) {
            hasSkippedInitialDraftPersistRef.current = true;
            return;
        }
        try {
            const entries = Object.entries(composerDrafts).filter(([, draft]) => String(draft || "").length > 0);
            if (entries.length === 0) {
                window.sessionStorage.removeItem(COMPOSER_DRAFTS_SESSION_KEY);
                return;
            }
            window.sessionStorage.setItem(COMPOSER_DRAFTS_SESSION_KEY, JSON.stringify(Object.fromEntries(entries)));
        } catch (error) {
            console.warn("Failed to persist conversation drafts:", error);
        }
    }, [composerDrafts]);

    const getComposerDraft = useCallback((conversationId?: string | null) => {
        const normalizedId = String(conversationId || "").trim();
        if (!normalizedId) return "";
        return composerDrafts[normalizedId] || "";
    }, [composerDrafts]);

    const setComposerDraftForConversation = useCallback((conversationId: string | null | undefined, draft: string) => {
        const normalizedId = String(conversationId || "").trim();
        if (!normalizedId) return;
        const nextDraft = String(draft || "");
        setComposerDrafts((prev) => {
            if (nextDraft) {
                if (prev[normalizedId] === nextDraft) return prev;
                return { ...prev, [normalizedId]: nextDraft };
            }
            if (!(normalizedId in prev)) return prev;
            const next = { ...prev };
            delete next[normalizedId];
            return next;
        });
    }, []);

    const clearComposerDraftForConversation = useCallback((conversationId?: string | null) => {
        setComposerDraftForConversation(conversationId, "");
    }, [setComposerDraftForConversation]);

    useEffect(() => {
        setComposerInsertSeed(null);
    }, [args.resetKey]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const globalWindow = window as ComposerDraftsWindow;
        globalWindow.__ESTIO_INSERT_COMPOSER_DRAFT__ = (payload: InsertComposerDraftPayload) => {
            const body = String(payload?.body || "").trim();
            if (!body) return false;

            const targetConversationId = String(payload?.conversationId || "").trim();
            const activeConversationId = String(args.activeConversationIdRef.current || "").trim();
            if (targetConversationId && activeConversationId && targetConversationId !== activeConversationId) {
                return false;
            }

            setComposerInsertSeed({
                key: String(payload?.key || `${Date.now()}`),
                body,
            });
            return true;
        };

        return () => {
            if (globalWindow.__ESTIO_INSERT_COMPOSER_DRAFT__) {
                delete globalWindow.__ESTIO_INSERT_COMPOSER_DRAFT__;
            }
        };
    }, [args.activeConversationIdRef]);

    const insertSuggestedResponseIntoComposer = useCallback((body: string, id: string) => {
        setComposerInsertSeed({
            key: `${id}:${Date.now()}`,
            body,
        });
    }, []);

    return {
        composerInsertSeed,
        getComposerDraft,
        setComposerDraftForConversation,
        clearComposerDraftForConversation,
        insertSuggestedResponseIntoComposer,
    };
}
