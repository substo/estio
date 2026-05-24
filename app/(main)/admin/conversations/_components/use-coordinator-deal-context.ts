import { useEffect, useState } from "react";
import { Conversation } from "@/lib/ghl/conversations";
import { createPersistentDeal, findExistingDeal, removeConversationFromDeal } from "../../deals/actions";

interface UseCoordinatorDealContextOptions {
    selectedConversations?: Conversation[];
    existingDealContextId?: string | null;
    existingDealTitle?: string | null;
    onDeselect?: (id: string) => void;
}

export function useCoordinatorDealContext({
    selectedConversations,
    existingDealContextId = null,
    existingDealTitle = null,
    onDeselect,
}: UseCoordinatorDealContextOptions) {
    const [dealTitle, setDealTitle] = useState("");
    const [dealContextId, setDealContextId] = useState<string | null>(null);

    const isContextMode = selectedConversations && selectedConversations.length > 0;

    useEffect(() => {
        if (existingDealContextId) {
            setDealContextId(existingDealContextId);
            setDealTitle(String(existingDealTitle || "").trim());
            return;
        }

        if (!selectedConversations || selectedConversations.length === 0) {
            setDealContextId(null);
            setDealTitle("");
            return;
        }

        const ids = selectedConversations.map(c => c.id);
        findExistingDeal(ids).then(deals => {
            if (deals && deals.length > 0) {
                setDealContextId(deals[0].id);
                setDealTitle(deals[0].title);
            } else {
                setDealContextId(null);
                setDealTitle("");
            }
        });
    }, [existingDealContextId, existingDealTitle, selectedConversations]);

    const ensureDealContext = async () => {
        if (dealContextId) return dealContextId;
        if (!selectedConversations || selectedConversations.length === 0) return null;

        const ids = selectedConversations.map(c => c.id);
        const title = dealTitle || `Deal: ${selectedConversations[0].contactName} & others`;
        const newContext = await createPersistentDeal(title, ids);
        setDealContextId(newContext.id);
        return newContext.id;
    };

    const handleRemoveParticipant = async (conversationId: string) => {
        if (dealContextId) {
            try {
                await removeConversationFromDeal(dealContextId, conversationId);
            } catch (e) {
                console.error("Failed to remove from deal", e);
            }
        }
        onDeselect?.(conversationId);
    };

    return {
        dealTitle,
        setDealTitle,
        dealContextId,
        setDealContextId,
        isContextMode,
        handleRemoveParticipant,
        ensureDealContext,
    };
}
