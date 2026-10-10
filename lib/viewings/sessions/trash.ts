import db from "@/lib/db";
import { Prisma } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;
export const VIEWING_SESSION_TRASH_DAYS = 30;

export function viewingSessionTrashCutoff(now = new Date()) {
    return new Date(now.getTime() - VIEWING_SESSION_TRASH_DAYS * DAY_MS);
}

export function canRestoreViewingSession(deletedAt: Date | null, trashPurgedAt: Date | null, now = new Date()) {
    return !!deletedAt && !trashPurgedAt && deletedAt.getTime() >= viewingSessionTrashCutoff(now).getTime();
}

export async function moveViewingSessionToTrash(args: { id: string; locationId: string; now?: Date; endOpen?: boolean }, database: typeof db = db) {
    // A thread may contain several sessions. Only the selected session is trashed.
    const now = args.now || new Date();
    return database.$transaction(async (tx) => {
        const session = await tx.viewingSession.findFirst({
            where: { id: args.id, locationId: args.locationId },
            select: { id: true, status: true, deletedAt: true, trashPurgedAt: true },
        });
        if (!session) return "not_found" as const;
        if (session.deletedAt) return "already_deleted" as const;
        const isOpen = session.status !== "completed" && session.status !== "expired";
        if (isOpen && !args.endOpen) return "active" as const;
        const updated = await tx.viewingSession.updateMany({
            where: {
                id: args.id,
                locationId: args.locationId,
                deletedAt: null,
                status: isOpen ? { notIn: ["completed", "expired"] } : { in: ["completed", "expired"] },
            },
            data: {
                deletedAt: now,
                ...(isOpen ? { status: "completed", endedAt: now } : {}),
                sessionLinkTokenHash: null,
                pinCodeHash: null,
                pinCodeSalt: null,
                tokenExpiresAt: null,
                transportStatus: "disconnected",
            },
        });
        if (updated.count) return isOpen ? "ended_and_deleted" as const : "deleted" as const;
        const current = await tx.viewingSession.findFirst({
            where: { id: args.id, locationId: args.locationId },
            select: { deletedAt: true },
        });
        return current?.deletedAt ? "already_deleted" as const : "active" as const;
    });
}

export async function restoreViewingSession(args: { id: string; locationId: string; now?: Date }, database: typeof db = db) {
    const now = args.now || new Date();
    const session = await database.viewingSession.findFirst({
        where: { id: args.id, locationId: args.locationId },
        select: { deletedAt: true, trashPurgedAt: true },
    });
    if (!session) return "not_found" as const;
    if (!session.deletedAt) return "already_restored" as const;
    if (!canRestoreViewingSession(session.deletedAt, session.trashPurgedAt, now)) return "expired" as const;
    const restored = await database.viewingSession.updateMany({
        where: {
            id: args.id,
            locationId: args.locationId,
            deletedAt: { gte: viewingSessionTrashCutoff(now) },
            trashPurgedAt: null,
        },
        data: { deletedAt: null },
    });
    if (restored.count) return "restored" as const;
    const current = await database.viewingSession.findFirst({
        where: { id: args.id, locationId: args.locationId },
        select: { deletedAt: true },
    });
    return current && !current.deletedAt ? "already_restored" as const : "expired" as const;
}

export async function purgeViewingSessionTrash(args: { now?: Date; batchSize?: number; maxBatches?: number } = {}) {
    const now = args.now || new Date();
    const cutoff = viewingSessionTrashCutoff(now);
    const batchSize = Math.max(1, Math.min(100, Math.floor(args.batchSize || 50)));
    const maxBatches = Math.max(1, Math.min(20, Math.floor(args.maxBatches || 10)));
    let sessions = 0;
    let messages = 0;
    let insights = 0;
    let summaries = 0;
    let events = 0;
    let batches = 0;
    let lastBatchFull = false;
    while (batches < maxBatches) {
        const candidates = await db.viewingSession.findMany({
            where: { deletedAt: { lt: cutoff }, trashPurgedAt: null },
            orderBy: [{ deletedAt: "asc" }, { id: "asc" }],
            take: batchSize,
            select: { id: true },
        });
        if (!candidates.length) break;
        batches++;
        lastBatchFull = candidates.length === batchSize;
        for (const candidate of candidates) {
            const result = await db.$transaction(async (tx) => {
                // The conditional claim and all content removal share one transaction. A restore
                // that wins the race makes the claim fail; a purge that wins makes restore fail.
                const claimed = await tx.viewingSession.updateMany({
                    where: { id: candidate.id, deletedAt: { lt: cutoff }, trashPurgedAt: null },
                    data: { trashPurgedAt: now },
                });
                if (!claimed.count) return null;
                const deletedInsights = await tx.viewingSessionInsight.deleteMany({ where: { sessionId: candidate.id } });
                const deletedMessages = await tx.viewingSessionMessage.deleteMany({ where: { sessionId: candidate.id } });
                const deletedSummary = await tx.viewingSessionSummary.deleteMany({ where: { sessionId: candidate.id } });
                const deletedEvents = await tx.viewingSessionEvent.deleteMany({ where: { sessionId: candidate.id } });
                // Keep the parent row and usage records for cost accounting; remove recoverable content.
                await tx.viewingSession.update({
                    where: { id: candidate.id },
                    data: {
                        clientName: null, notes: null, aiSummary: null, objections: Prisma.DbNull,
                        keyPoints: Prisma.DbNull, recommendedNextActions: Prisma.DbNull, contextSnapshot: Prisma.DbNull,
                        joinAudit: Prisma.DbNull, relatedPropertyIds: [],
                        contactId: null, viewingId: null, primaryPropertyId: null,
                        currentActivePropertyId: null,
                    },
                });
                return { messages: deletedMessages.count, insights: deletedInsights.count, summaries: deletedSummary.count, events: deletedEvents.count };
            }, { timeout: 30_000 });
            if (result) {
                sessions++;
                messages += result.messages;
                insights += result.insights;
                summaries += result.summaries;
                events += result.events;
            }
        }
        if (candidates.length < batchSize) break;
    }
    return { sessions, messages, insights, summaries, events, batches, cutoffAt: cutoff.toISOString(), limitReached: batches === maxBatches && lastBatchFull };
}
