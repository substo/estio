import type { Conversation } from '@/lib/ghl/conversations';
import type { DealContactOption } from './conversation-contact-identity-actions';

export function buildDealContactOptions(participants: Conversation[]): DealContactOption[] {
    const byContact = new Map<string, DealContactOption>();

    for (const conversation of participants) {
        const key = String(
            conversation.contactId
            || conversation.contactEmail
            || conversation.contactPhone
            || conversation.id
        );

        const candidate: DealContactOption = {
            conversationId: conversation.id,
            contactId: conversation.contactId,
            contactName: conversation.contactName || "Unknown Contact",
            contactEmail: conversation.contactEmail,
            contactPhone: conversation.contactPhone,
            lastMessageDate: Number(conversation.lastMessageDate || 0),
            unreadCount: conversation.unreadCount,
            lastMessageType: conversation.lastMessageType,
        };

        const current = byContact.get(key);
        if (!current || candidate.lastMessageDate > current.lastMessageDate) {
            byContact.set(key, candidate);
        }
    }

    return Array.from(byContact.values()).sort((a, b) => b.lastMessageDate - a.lastMessageDate);
}

export function resolveSelectedDealConversation(
    participants: Conversation[],
    activeId: string | null
): Conversation | null {
    if (!activeId) return null;
    return participants.find((conversation) => conversation.id === activeId) || null;
}

export function resolveDealTitle(
    listEntry?: { title?: string | null } | null,
    cachedSnapshot?: { title?: string | null } | null
): string {
    return String(listEntry?.title || cachedSnapshot?.title || "Deal").trim() || "Deal";
}

export function resolveSelectedConversationsForDeal(
    ids: string[],
    cache: Map<string, Conversation>,
    conversations: Conversation[]
): Conversation[] {
    return ids
        .map((id) => cache.get(id) || conversations.find((conversation) => conversation.id === id))
        .filter((conversation): conversation is Conversation => !!conversation);
}

export function chooseNextDealConversationId(
    participants: Conversation[],
    contacts: DealContactOption[],
    preferredId?: string | null,
    currentUrlId?: string | null,
    previousId?: string | null
): string | null {
    const availableIds = new Set(participants.map((conversation) => conversation.id));
    const normalizedPreferredId = String(preferredId || "").trim();

    if (normalizedPreferredId && availableIds.has(normalizedPreferredId)) {
        return normalizedPreferredId;
    }
    if (currentUrlId && availableIds.has(currentUrlId)) {
        return currentUrlId;
    }
    if (previousId && availableIds.has(previousId)) {
        return previousId;
    }
    return contacts[0]?.conversationId || participants[0]?.id || null;
}
