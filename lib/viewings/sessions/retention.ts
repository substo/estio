import db from "@/lib/db";
import { VIEWING_SESSION_STATUSES } from "@/lib/viewings/sessions/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 3650;

export type ViewingSessionRetentionCandidate = {
    id: string;
    status: string;
    appliedRetentionDays: number;
    createdAt: Date;
    startedAt?: Date | null;
    endedAt?: Date | null;
    summaryStatus?: string | null;
};

export type ViewingSessionRetentionCleanupInput = {
    locationId?: string | null;
    now?: Date;
    batchSize?: number;
    dryRun?: boolean;
};

export type ViewingSessionRetentionCleanupResult = {
    success: true;
    dryRun: boolean;
    scanned: number;
    expiredCandidates: number;
    sessionsPurged: number;
    messagesDeleted: number;
    insightsDeleted: number;
    summariesDeleted: number;
    preservedFinalSummaries: number;
    processedAt: string;
};

function asString(value: unknown): string {
    return String(value || "").trim();
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function normalizeViewingSessionRetentionDays(days: number | null | undefined): number {
    const parsed = Number(days);
    if (!Number.isFinite(parsed)) return MIN_RETENTION_DAYS;
    return clamp(Math.floor(parsed), MIN_RETENTION_DAYS, MAX_RETENTION_DAYS);
}

export function resolveViewingSessionRetentionReferenceAt(session: Pick<ViewingSessionRetentionCandidate, "createdAt" | "startedAt" | "endedAt">): Date {
    return session.endedAt || session.startedAt || session.createdAt;
}

export function isViewingSessionConversationExpired(
    session: Pick<ViewingSessionRetentionCandidate, "appliedRetentionDays" | "createdAt" | "startedAt" | "endedAt">,
    now: Date = new Date()
): boolean {
    const retentionDays = normalizeViewingSessionRetentionDays(session.appliedRetentionDays);
    const referenceAt = resolveViewingSessionRetentionReferenceAt(session).getTime();
    const cutoffAt = now.getTime() - retentionDays * DAY_MS;
    return referenceAt <= cutoffAt;
}

export function shouldPreserveViewingSessionSummary(summaryStatus: string | null | undefined): boolean {
    return asString(summaryStatus).toLowerCase() === "final";
}

export async function runViewingSessionRetentionCleanup(
    input: ViewingSessionRetentionCleanupInput = {}
): Promise<ViewingSessionRetentionCleanupResult> {
    const now = input.now || new Date();
    const dryRun = input.dryRun === true;
    const batchSize = clamp(Math.floor(Number(input.batchSize || 200)), 1, 1000);
    const locationId = asString(input.locationId) || null;
    const oldestCandidateCutoff = new Date(now.getTime() - MIN_RETENTION_DAYS * DAY_MS);

    const candidates = await db.viewingSession.findMany({
        where: {
            status: {
                in: [VIEWING_SESSION_STATUSES.completed, VIEWING_SESSION_STATUSES.expired],
            },
            ...(locationId ? { locationId } : {}),
            OR: [
                { endedAt: { lte: oldestCandidateCutoff } },
                { endedAt: null, createdAt: { lte: oldestCandidateCutoff } },
            ],
        },
        orderBy: [{ endedAt: "asc" }, { createdAt: "asc" }],
        take: batchSize,
        select: {
            id: true,
            locationId: true,
            status: true,
            appliedRetentionDays: true,
            createdAt: true,
            startedAt: true,
            endedAt: true,
            summary: {
                select: {
                    id: true,
                    status: true,
                },
            },
        },
    });

    let expiredCandidates = 0;
    let sessionsPurged = 0;
    let messagesDeleted = 0;
    let insightsDeleted = 0;
    let summariesDeleted = 0;
    let preservedFinalSummaries = 0;

    for (const candidate of candidates) {
        const expired = isViewingSessionConversationExpired(
            {
                appliedRetentionDays: candidate.appliedRetentionDays,
                createdAt: candidate.createdAt,
                startedAt: candidate.startedAt,
                endedAt: candidate.endedAt,
            },
            now
        );
        if (!expired) continue;
        expiredCandidates += 1;

        const preserveFinalSummary = shouldPreserveViewingSessionSummary(candidate.summary?.status || null);
        if (preserveFinalSummary) {
            preservedFinalSummaries += 1;
        }

        if (dryRun) {
            const [messageCount, insightCount] = await Promise.all([
                db.viewingSessionMessage.count({ where: { sessionId: candidate.id } }),
                db.viewingSessionInsight.count({ where: { sessionId: candidate.id } }),
            ]);
            messagesDeleted += messageCount;
            insightsDeleted += insightCount;
            if (candidate.summary && !preserveFinalSummary) {
                summariesDeleted += 1;
            }
            sessionsPurged += 1;
            continue;
        }

        const cleanup = await db.$transaction(async (tx) => {
            const deletedMessages = await tx.viewingSessionMessage.deleteMany({
                where: { sessionId: candidate.id },
            });
            const deletedInsights = await tx.viewingSessionInsight.deleteMany({
                where: { sessionId: candidate.id },
            });

            let deletedSummaryCount = 0;
            if (candidate.summary && !preserveFinalSummary) {
                await tx.viewingSessionSummary.deleteMany({
                    where: { sessionId: candidate.id },
                });
                deletedSummaryCount = 1;
            }

            await tx.viewingSession.update({
                where: { id: candidate.id },
                data: {
                    ...(preserveFinalSummary ? {} : { aiSummary: null }),
                    keyPoints: [] as any,
                    objections: [] as any,
                    ...(preserveFinalSummary ? {} : { recommendedNextActions: [] as any }),
                },
            });

            await tx.viewingSessionEvent.create({
                data: {
                    sessionId: candidate.id,
                    locationId: candidate.locationId,
                    type: "viewing_session.retention.cleaned",
                    source: "system",
                    payload: {
                        deletedMessages: deletedMessages.count,
                        deletedInsights: deletedInsights.count,
                        deletedSummary: deletedSummaryCount > 0,
                        preservedFinalSummary: preserveFinalSummary,
                        retentionDays: normalizeViewingSessionRetentionDays(candidate.appliedRetentionDays),
                        processedAt: now.toISOString(),
                    } as any,
                },
            });

            return {
                deletedMessages: deletedMessages.count,
                deletedInsights: deletedInsights.count,
                deletedSummaryCount,
            };
        });

        messagesDeleted += cleanup.deletedMessages;
        insightsDeleted += cleanup.deletedInsights;
        summariesDeleted += cleanup.deletedSummaryCount;
        sessionsPurged += 1;
    }

    return {
        success: true,
        dryRun,
        scanned: candidates.length,
        expiredCandidates,
        sessionsPurged,
        messagesDeleted,
        insightsDeleted,
        summariesDeleted,
        preservedFinalSummaries,
        processedAt: now.toISOString(),
    };
}
