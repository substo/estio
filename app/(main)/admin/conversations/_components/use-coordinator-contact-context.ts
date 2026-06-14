import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ContactIdentityPatch } from "../../contacts/_components/contact-form";
import { loadContactContext } from "./contact-context-client";
import { hasFullContactContext, isShellContactContext } from "./conversation-workspace-ui-actions";

export type CoordinatorSidebarTab = "overview" | "tasks" | "viewings";

interface UseCoordinatorContactContextOptions {
    conversationId: string;
    contactId: string | null | undefined;
    initialContactContext?: any;
    lazySidebarDataEnabled: boolean;
    onContactSaved?: ((patch: ContactIdentityPatch) => void) | undefined;
}

interface LoadedSidebarTabs {
    overview: boolean;
    tasks: boolean;
    viewings: boolean;
}

export function useCoordinatorContactContext({
    conversationId,
    contactId,
    initialContactContext,
    lazySidebarDataEnabled,
    onContactSaved,
}: UseCoordinatorContactContextOptions): {
    contactContext: any;
    setContactContext: Dispatch<SetStateAction<any>>;
    loadingContext: boolean;
    sidebarTab: CoordinatorSidebarTab;
    setSidebarTab: Dispatch<SetStateAction<CoordinatorSidebarTab>>;
    loadedSidebarTabs: LoadedSidebarTabs;
    handleContactSaved: (patch: ContactIdentityPatch) => Promise<void>;
} {
    const [contactContext, setContactContext] = useState<any>(initialContactContext || null);
    const [loadingContext, setLoadingContext] = useState(false);
    const [sidebarTab, setSidebarTab] = useState<CoordinatorSidebarTab>("overview");
    const [loadedSidebarTabs, setLoadedSidebarTabs] = useState<LoadedSidebarTabs>({
        overview: true,
        tasks: !lazySidebarDataEnabled,
        viewings: true,
    });
    const conversationIdRef = useRef(conversationId);

    useEffect(() => {
        conversationIdRef.current = conversationId;
    }, [conversationId]);

    useEffect(() => {
        if (!lazySidebarDataEnabled) {
            setLoadedSidebarTabs({ overview: true, tasks: true, viewings: true });
            return;
        }
        setLoadedSidebarTabs((prev) => ({ ...prev, viewings: true, [sidebarTab]: true }));
    }, [sidebarTab, lazySidebarDataEnabled]);

    useEffect(() => {
        setContactContext(initialContactContext || null);
    }, [initialContactContext, conversationId]);

    useEffect(() => {
        if (!contactId) {
            setContactContext(null);
            setLoadingContext(false);
            return;
        }
        if (hasFullContactContext(initialContactContext)) {
            setContactContext(initialContactContext);
            setLoadingContext(false);
            return;
        }

        const hasShellContext = isShellContactContext(initialContactContext);
        if (hasShellContext) {
            setContactContext(initialContactContext);
        } else {
            setContactContext(null);
        }

        let cancelled = false;
        const fetchDelayMs = hasShellContext ? 0 : 150;
        const fetchTimer = setTimeout(() => {
            if (cancelled) return;
            setLoadingContext(true);
            loadContactContext(contactId, { refreshExternal: false })
                .then(data => {
                    if (!cancelled) setContactContext(data);
                })
                .catch(err => console.error("Failed to load context", err))
                .finally(() => {
                    if (!cancelled) setLoadingContext(false);
                });
        }, fetchDelayMs);

        return () => {
            cancelled = true;
            clearTimeout(fetchTimer);
        };
    }, [contactId, initialContactContext, lazySidebarDataEnabled]);

    const handleContactSaved = async (patch: ContactIdentityPatch) => {
        if (!patch?.id) return;

        setContactContext((prev: any) => {
            if (!prev?.contact || String(prev.contact.id) !== String(patch.id)) return prev;
            return {
                ...prev,
                contact: {
                    ...prev.contact,
                    ...patch,
                },
            };
        });

        onContactSaved?.(patch);

        const sourceConversationId = conversationId;
        const sourceContactId = contactId;
        if (!sourceContactId) return;

        try {
            const refreshed = await loadContactContext(sourceContactId);
            if (conversationIdRef.current !== sourceConversationId || !refreshed) return;

            setContactContext(refreshed);

            const refreshedContact = (refreshed as any)?.contact;
            if (refreshedContact?.id) {
                onContactSaved?.({
                    id: refreshedContact.id,
                    name: refreshedContact.name ?? null,
                    email: refreshedContact.email ?? null,
                    phone: refreshedContact.phone ?? null,
                    firstName: refreshedContact.firstName ?? null,
                    lastName: refreshedContact.lastName ?? null,
                    preferredLang: refreshedContact.preferredLang ?? null,
                });
            }
        } catch (error) {
            console.error("Failed to refetch contact context after save", error);
        }
    };

    return {
        contactContext,
        setContactContext,
        loadingContext,
        sidebarTab,
        setSidebarTab,
        loadedSidebarTabs,
        handleContactSaved,
    };
}
