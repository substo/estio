import type { Prisma } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;

export const CONVERSATION_TRASH_RETENTION_DAYS = 30;
export const DEFAULT_CONVERSATION_TRASH_PURGE_BATCH_SIZE = 100;
export const DEFAULT_CONVERSATION_TRASH_PURGE_MAX_BATCHES = 20;

type TrashRetentionCandidate = {
    id: string;
    locationId: string;
};

type TrashRetentionRepository = {
    findMany(args: {
        where: Prisma.ConversationWhereInput;
        orderBy: Prisma.ConversationOrderByWithRelationInput[];
        take: number;
        select: { id: true; locationId: true };
    }): Promise<TrashRetentionCandidate[]>;
    deleteMany(args: { where: Prisma.ConversationWhereInput }): Promise<{ count: number }>;
};

export type ConversationTrashRetentionResult = {
    success: true;
    retentionDays: number;
    cutoffAt: string;
    batchSize: number;
    maxBatches: number;
    batches: number;
    scanned: number;
    purged: number;
    limitReached: boolean;
    affectedLocationIds: string[];
};

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function getConversationTrashRetentionCutoff(now: Date = new Date()): Date {
    return new Date(now.getTime() - CONVERSATION_TRASH_RETENTION_DAYS * DAY_MS);
}

export function buildExpiredConversationTrashWhere(cutoffAt: Date): Prisma.ConversationWhereInput {
    return {
        deletedAt: { lt: cutoffAt },
    };
}

export async function runConversationTrashRetentionPurge(args: {
    repository: TrashRetentionRepository;
    now?: Date;
    batchSize?: number;
    maxBatches?: number;
}): Promise<ConversationTrashRetentionResult> {
    const now = args.now || new Date();
    const cutoffAt = getConversationTrashRetentionCutoff(now);
    const batchSize = clampInteger(
        args.batchSize,
        DEFAULT_CONVERSATION_TRASH_PURGE_BATCH_SIZE,
        1,
        500,
    );
    const maxBatches = clampInteger(
        args.maxBatches,
        DEFAULT_CONVERSATION_TRASH_PURGE_MAX_BATCHES,
        1,
        100,
    );
    const affectedLocationIds = new Set<string>();
    let batches = 0;
    let scanned = 0;
    let purged = 0;
    let lastBatchSize = 0;

    while (batches < maxBatches) {
        const candidates = await args.repository.findMany({
            where: buildExpiredConversationTrashWhere(cutoffAt),
            orderBy: [{ deletedAt: "asc" }, { id: "asc" }],
            take: batchSize,
            select: { id: true, locationId: true },
        });
        lastBatchSize = candidates.length;
        if (lastBatchSize === 0) break;

        batches += 1;
        scanned += lastBatchSize;
        const deletion = await args.repository.deleteMany({
            where: {
                id: { in: candidates.map((candidate) => candidate.id) },
                ...buildExpiredConversationTrashWhere(cutoffAt),
            },
        });
        purged += deletion.count;

        if (deletion.count > 0) {
            candidates.forEach((candidate) => affectedLocationIds.add(candidate.locationId));
        }
        if (lastBatchSize < batchSize) break;
    }

    return {
        success: true,
        retentionDays: CONVERSATION_TRASH_RETENTION_DAYS,
        cutoffAt: cutoffAt.toISOString(),
        batchSize,
        maxBatches,
        batches,
        scanned,
        purged,
        limitReached: batches === maxBatches && lastBatchSize === batchSize,
        affectedLocationIds: Array.from(affectedLocationIds).sort(),
    };
}
