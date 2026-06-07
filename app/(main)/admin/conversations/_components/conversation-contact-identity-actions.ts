import type { Conversation } from '@/lib/ghl/conversations';
import type { ContactIdentityPatch } from '../../contacts/_components/contact-form';

export type ConversationContactIdentityPatch = {
    conversationId: string;
    contactId: string;
    name?: string;
    email?: string;
    phone?: string;
    preferredLang?: string | null;
    contactType?: string | null;
};

export type DealContactOption = {
    conversationId: string;
    contactId: string;
    contactName: string;
    contactEmail?: string;
    contactPhone?: string;
    lastMessageDate: number;
    unreadCount?: number;
    lastMessageType?: string;
};

export function normalizeConversationContactIdentityPatch(
    conversationId: string,
    patch: ContactIdentityPatch
): ConversationContactIdentityPatch | null {
    const normalizedConversationId = String(conversationId || "").trim();
    const patchedContactId = String(patch?.id || "").trim();
    if (!normalizedConversationId || !patchedContactId) return null;

    return {
        conversationId: normalizedConversationId,
        contactId: patchedContactId,
        ...(patch.name !== undefined ? { name: String(patch.name || "").trim() || "Unknown Contact" } : {}),
        ...(patch.email !== undefined ? { email: String(patch.email || "").trim() || undefined } : {}),
        ...(patch.phone !== undefined ? { phone: String(patch.phone || "").trim() || undefined } : {}),
        ...(patch.preferredLang !== undefined ? { preferredLang: String(patch.preferredLang || "").trim() || null } : {}),
        ...(patch.contactType !== undefined ? { contactType: String(patch.contactType || "").trim() || null } : {}),
    };
}

function contactIdentityPatchMatches(
    item: { id?: string; conversationId?: string; contactId?: string | null },
    patch: ConversationContactIdentityPatch
): boolean {
    return item.id === patch.conversationId
        || item.conversationId === patch.conversationId
        || String(item.contactId || "") === patch.contactId;
}

export function applyConversationIdentityPatch<T extends Conversation>(
    conversationItem: T,
    patch: ConversationContactIdentityPatch
): T {
    if (!contactIdentityPatchMatches(conversationItem, patch)) return conversationItem;

    return {
        ...conversationItem,
        ...(patch.name !== undefined ? { contactName: patch.name } : {}),
        ...(patch.email !== undefined ? { contactEmail: patch.email } : {}),
        ...(patch.phone !== undefined ? { contactPhone: patch.phone } : {}),
        ...(patch.preferredLang !== undefined ? { contactPreferredLanguage: patch.preferredLang } : {}),
        ...(patch.contactType !== undefined ? { contactType: patch.contactType } : {}),
    };
}

export function applyRefreshedConversationIdentityPatch<T extends Conversation>(
    conversationItem: T,
    fresh: Conversation,
    patch: ConversationContactIdentityPatch
): T {
    if (!contactIdentityPatchMatches(conversationItem, patch)) return conversationItem;

    return {
        ...conversationItem,
        ...fresh,
        ...(patch.name !== undefined ? { contactName: patch.name } : {}),
        ...(patch.email !== undefined ? { contactEmail: patch.email } : {}),
        ...(patch.phone !== undefined ? { contactPhone: patch.phone } : {}),
        ...(patch.preferredLang !== undefined ? { contactPreferredLanguage: patch.preferredLang } : {}),
        ...(patch.contactType !== undefined ? { contactType: patch.contactType } : {}),
    };
}

export function applyDealContactIdentityPatch<T extends DealContactOption>(
    contact: T,
    patch: ConversationContactIdentityPatch
): T {
    if (!contactIdentityPatchMatches(contact, patch)) return contact;

    return {
        ...contact,
        ...(patch.name !== undefined ? { contactName: patch.name } : {}),
        ...(patch.email !== undefined ? { contactEmail: patch.email } : {}),
        ...(patch.phone !== undefined ? { contactPhone: patch.phone } : {}),
    };
}

export function applyRefreshedDealContactIdentityPatch<T extends DealContactOption>(
    contact: T,
    fresh: Conversation,
    patch: ConversationContactIdentityPatch
): T {
    if (!contactIdentityPatchMatches(contact, patch)) return contact;

    return {
        ...contact,
        ...(fresh.contactName !== undefined ? { contactName: fresh.contactName || "Unknown Contact" } : {}),
        ...(fresh.contactEmail !== undefined ? { contactEmail: fresh.contactEmail || undefined } : {}),
        ...(fresh.contactPhone !== undefined ? { contactPhone: fresh.contactPhone || undefined } : {}),
        ...(patch.name !== undefined ? { contactName: patch.name } : {}),
        ...(patch.email !== undefined ? { contactEmail: patch.email } : {}),
        ...(patch.phone !== undefined ? { contactPhone: patch.phone } : {}),
    };
}

export function applyWorkspaceContactContextIdentityPatch<T>(
    context: T,
    patch: ConversationContactIdentityPatch
): T {
    const candidate = context as any;
    if (!candidate?.contact || String(candidate.contact.id || "") !== patch.contactId) return context;

    return {
        ...candidate,
        contact: {
            ...candidate.contact,
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.email !== undefined ? { email: patch.email || null } : {}),
            ...(patch.phone !== undefined ? { phone: patch.phone || null } : {}),
            ...(patch.preferredLang !== undefined ? { preferredLang: patch.preferredLang } : {}),
            ...(patch.contactType !== undefined ? { contactType: patch.contactType } : {}),
        },
    };
}

export function applyRefreshedWorkspaceContactContextIdentityPatch<T>(
    context: T,
    fresh: Conversation,
    patch: ConversationContactIdentityPatch
): T {
    const candidate = context as any;
    if (!candidate?.contact || String(candidate.contact.id || "") !== patch.contactId) return context;

    return {
        ...candidate,
        contact: {
            ...candidate.contact,
            ...(fresh.contactName !== undefined ? { name: fresh.contactName || null } : {}),
            ...(fresh.contactEmail !== undefined ? { email: fresh.contactEmail || null } : {}),
            ...(fresh.contactPhone !== undefined ? { phone: fresh.contactPhone || null } : {}),
            ...(fresh.contactPreferredLanguage !== undefined ? { preferredLang: fresh.contactPreferredLanguage } : {}),
            ...(patch.name !== undefined ? { name: patch.name } : {}),
            ...(patch.email !== undefined ? { email: patch.email || null } : {}),
            ...(patch.phone !== undefined ? { phone: patch.phone || null } : {}),
            ...(patch.preferredLang !== undefined ? { preferredLang: patch.preferredLang } : {}),
            ...(patch.contactType !== undefined ? { contactType: patch.contactType } : {}),
        },
    };
}
