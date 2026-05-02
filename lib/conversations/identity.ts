import type { Prisma } from "@prisma/client";

const LEGACY_LOCAL_CONVERSATION_PREFIXES = ["wa_", "import_", "owa_"] as const;

export function isLegacyLocalConversationAlias(value: string | null | undefined): boolean {
    const normalized = String(value || "").trim();
    if (!normalized) return false;
    return LEGACY_LOCAL_CONVERSATION_PREFIXES.some((prefix) => normalized.startsWith(prefix))
        || normalized.startsWith("native-");
}

export function isLikelyGhlConversationId(value: string | null | undefined): boolean {
    const normalized = String(value || "").trim();
    if (!normalized || isLegacyLocalConversationAlias(normalized)) return false;
    return /^[A-Za-z0-9]{20,}$/.test(normalized);
}

export function buildConversationReferenceWhere(
    locationId: string,
    conversationRef: string
): Prisma.ConversationWhereInput {
    const ref = String(conversationRef || "").trim();
    return {
        locationId,
        OR: [
            { id: ref },
            { ghlConversationId: ref },
            {
                syncRecords: {
                    some: {
                        providerConversationId: ref,
                    },
                },
            },
        ],
    };
}

export function getCanonicalConversationId(
    conversation: { id: string } | null | undefined
): string | null {
    return conversation?.id ? String(conversation.id) : null;
}

export function getLegacyConversationAlias(
    conversation: { ghlConversationId?: string | null } | null | undefined
): string | null {
    return conversation?.ghlConversationId ? String(conversation.ghlConversationId) : null;
}
