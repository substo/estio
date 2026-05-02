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
            {
                syncRecords: {
                    some: {
                        providerThreadId: ref,
                    },
                },
            },
        ],
    };
}

export type ConversationReferenceResolution = {
    id: string;
    locationId: string;
    contactId?: string | null;
    ghlConversationId?: string | null;
};

export async function resolveConversationReference<T extends {
    conversation: {
        findFirst(args: {
            where: Prisma.ConversationWhereInput;
            select: {
                id: true;
                locationId: true;
                contactId: true;
                ghlConversationId: true;
            };
        }): Promise<ConversationReferenceResolution | null>;
    };
}>(
    db: T,
    locationId: string,
    conversationRef: string
): Promise<ConversationReferenceResolution | null> {
    const ref = String(conversationRef || "").trim();
    if (!locationId || !ref) return null;
    return db.conversation.findFirst({
        where: buildConversationReferenceWhere(locationId, ref),
        select: {
            id: true,
            locationId: true,
            contactId: true,
            ghlConversationId: true,
        },
    });
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
