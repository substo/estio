import type { Conversation } from "@/lib/ghl/conversations";

function normalizeSearchText(value: string | null | undefined) {
    return String(value || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase();
}

function normalizePhoneDigits(value: string | null | undefined) {
    return String(value || "").replace(/\D/g, "");
}

export function filterLoadedConversations(
    conversations: Conversation[],
    query: string,
) {
    const normalizedQuery = normalizeSearchText(query).trim();
    if (!normalizedQuery) return conversations;

    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const queryDigits = normalizePhoneDigits(query);

    return conversations.filter((conversation) => {
        const contactText = normalizeSearchText([
            conversation.contactName,
            conversation.contactEmail,
            conversation.contactPhone,
        ].join(" "));
        const contactDigits = normalizePhoneDigits(conversation.contactPhone);

        return tokens.every((token) => contactText.includes(token))
            || (queryDigits.length >= 2 && contactDigits.includes(queryDigits));
    });
}
