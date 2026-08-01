import type { Prisma } from "@prisma/client";

export type ConversationLifecycleState = "notDeleted" | "active" | "archived" | "trashed";

export type ConversationLifecycleTarget = {
    id: string;
    contactId: string | null;
    ghlConversationId: string | null;
    syncRecords: Array<{
        providerConversationId: string | null;
        providerThreadId: string | null;
    }>;
};

export const CONVERSATION_LIFECYCLE_TARGET_SELECT = {
    id: true,
    contactId: true,
    ghlConversationId: true,
    syncRecords: {
        select: {
            providerConversationId: true,
            providerThreadId: true,
        },
    },
} as const;

export function normalizeConversationLifecycleRefs(conversationRefs: string[]): string[] {
    return Array.from(new Set(conversationRefs.map((ref) => String(ref || "").trim()).filter(Boolean)));
}

export function buildConversationLifecycleTargetWhere(
    locationId: string,
    conversationRefs: string[],
    state: ConversationLifecycleState,
): Prisma.ConversationWhereInput {
    const refs = normalizeConversationLifecycleRefs(conversationRefs);
    const stateWhere: Prisma.ConversationWhereInput = state === "active"
        ? { deletedAt: null, archivedAt: null }
        : state === "archived"
            ? { deletedAt: null, archivedAt: { not: null } }
            : state === "trashed"
                ? { deletedAt: { not: null } }
                : { deletedAt: null };

    return {
        locationId,
        ...stateWhere,
        OR: [
            { id: { in: refs } },
            { ghlConversationId: { in: refs } },
            { syncRecords: { some: { providerConversationId: { in: refs } } } },
            { syncRecords: { some: { providerThreadId: { in: refs } } } },
        ],
    };
}

function targetMatchesRef(target: ConversationLifecycleTarget, ref: string): boolean {
    if (target.id === ref || target.ghlConversationId === ref) return true;
    return target.syncRecords.some((syncRecord) => (
        syncRecord.providerConversationId === ref || syncRecord.providerThreadId === ref
    ));
}

export async function resolveConversationLifecycleTargets<T extends ConversationLifecycleTarget>(args: {
    locationId: string;
    conversationRefs: string[];
    state: ConversationLifecycleState;
    findMany: (query: {
        where: Prisma.ConversationWhereInput;
        select: typeof CONVERSATION_LIFECYCLE_TARGET_SELECT;
    }) => Promise<T[]>;
}): Promise<
    | { success: true; refs: string[]; targets: T[] }
    | { success: false; error: string }
> {
    const refs = normalizeConversationLifecycleRefs(args.conversationRefs);
    if (!args.locationId || refs.length === 0) {
        return { success: false, error: "No conversations selected" };
    }

    const targets = await args.findMany({
        where: buildConversationLifecycleTargetWhere(args.locationId, refs, args.state),
        select: CONVERSATION_LIFECYCLE_TARGET_SELECT,
    });
    const allRefsResolved = refs.every((ref) => targets.some((target) => targetMatchesRef(target, ref)));

    if (!allRefsResolved) {
        return { success: false, error: "One or more conversations are unavailable" };
    }

    return { success: true, refs, targets };
}
