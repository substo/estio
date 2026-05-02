import type { PrismaClient } from "@prisma/client";
import { buildConversationReferenceWhere } from "@/lib/conversations/identity";

type DbLike = Pick<PrismaClient, "conversation" | "dealConversationLink">;

export type ResolvedDealConversationRef = {
    ref: string;
    conversationId: string;
    legacyConversationRef: string | null;
};

export async function resolveDealConversationRefs(
    db: DbLike,
    locationId: string,
    refs: string[]
): Promise<ResolvedDealConversationRef[]> {
    const normalizedRefs = Array.from(new Set(
        (Array.isArray(refs) ? refs : [])
            .map((ref) => String(ref || "").trim())
            .filter(Boolean)
    ));
    if (!locationId || normalizedRefs.length === 0) return [];

    const resolved: ResolvedDealConversationRef[] = [];
    const seenConversationIds = new Set<string>();
    for (const ref of normalizedRefs) {
        const conversation = await db.conversation.findFirst({
            where: buildConversationReferenceWhere(locationId, ref),
            select: { id: true, ghlConversationId: true },
        });
        if (!conversation?.id || seenConversationIds.has(conversation.id)) continue;
        seenConversationIds.add(conversation.id);
        resolved.push({
            ref,
            conversationId: conversation.id,
            legacyConversationRef: conversation.ghlConversationId || (conversation.id !== ref ? ref : null),
        });
    }
    return resolved;
}

export async function syncDealConversationLinks(
    db: DbLike,
    args: {
        dealId: string;
        locationId: string;
        conversationRefs: string[];
    }
) {
    const resolved = await resolveDealConversationRefs(db, args.locationId, args.conversationRefs);
    for (const item of resolved) {
        await db.dealConversationLink.upsert({
            where: {
                dealId_conversationId: {
                    dealId: args.dealId,
                    conversationId: item.conversationId,
                },
            },
            create: {
                dealId: args.dealId,
                conversationId: item.conversationId,
                legacyConversationRef: item.legacyConversationRef,
            },
            update: {
                legacyConversationRef: item.legacyConversationRef,
            },
        });
    }
    return resolved;
}
