import db from "@/lib/db";
import { enqueueWhatsAppAudioTranscription } from "@/lib/queue/whatsapp-audio-transcription";
import { enqueueWhatsAppAudioExtraction } from "@/lib/queue/whatsapp-audio-extraction";

export type AudioTranscriptMaintenanceOptions = {
    maxRetries?: number;
    staleProcessingMinutes?: number;
    stalePendingMinutes?: number;
    retryFailedAfterMinutes?: number;
    batchSize?: number;
    applyRetention?: boolean;
};

type MaintenanceCounter = {
    inspected: number;
    requeued: number;
    alreadyQueued: number;
    skipped: number;
    deadLettered: number;
    queueUnavailable: number;
    nonTransientSkipped: number;
    failed: number;
};

type MaintenanceStats = {
    startedAt: string;
    finishedAt?: string;
    staleCutoffs: {
        processingBefore: string;
        pendingBefore: string;
        failedRetryBefore: string;
    };
    options: Required<Omit<AudioTranscriptMaintenanceOptions, "applyRetention">> & {
        applyRetention: boolean;
    };
    transcripts: MaintenanceCounter;
    extractions: MaintenanceCounter;
    retention: {
        enabled: boolean;
        locationsEvaluated: number;
        deletedTranscriptRows: number;
    };
    errors: string[];
};

const DEFAULT_OPTIONS: Required<Omit<AudioTranscriptMaintenanceOptions, "applyRetention">> & {
    applyRetention: boolean;
} = {
    maxRetries: 3,
    staleProcessingMinutes: 35,
    stalePendingMinutes: 60,
    retryFailedAfterMinutes: 20,
    batchSize: 100,
    applyRetention: true,
};

const TERMINAL_STATUSES = ["completed", "failed"];

function buildCounter(): MaintenanceCounter {
    return {
        inspected: 0,
        requeued: 0,
        alreadyQueued: 0,
        skipped: 0,
        deadLettered: 0,
        queueUnavailable: 0,
        nonTransientSkipped: 0,
        failed: 0,
    };
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(Math.max(Math.floor(numeric), min), max);
}

function normalizeRetentionDays(value: unknown): 30 | 90 | 365 {
    const numeric = Number(value);
    if (numeric === 30 || numeric === 90 || numeric === 365) return numeric;
    return 90;
}

function isTransientAudioError(error: string | null | undefined): boolean {
    const normalized = String(error || "").trim().toLowerCase();
    if (!normalized) return true;

    const permanentTokens = [
        "api key",
        "no google ai api key",
        "unauthorized",
        "forbidden",
        "permission",
        "invalid model",
        "attachment not found",
        "attachment/message mismatch",
        "does not belong to this location",
        "not a valid r2 uri",
        "transcript text is empty",
        "transcript not found",
        "must be completed before extracting",
    ];

    if (permanentTokens.some((token) => normalized.includes(token))) {
        return false;
    }

    return true;
}

export async function runAudioTranscriptMaintenanceJob(
    rawOptions?: AudioTranscriptMaintenanceOptions
): Promise<MaintenanceStats> {
    const options = {
        maxRetries: clampInt(rawOptions?.maxRetries, DEFAULT_OPTIONS.maxRetries, 1, 10),
        staleProcessingMinutes: clampInt(rawOptions?.staleProcessingMinutes, DEFAULT_OPTIONS.staleProcessingMinutes, 5, 240),
        stalePendingMinutes: clampInt(rawOptions?.stalePendingMinutes, DEFAULT_OPTIONS.stalePendingMinutes, 5, 240),
        retryFailedAfterMinutes: clampInt(rawOptions?.retryFailedAfterMinutes, DEFAULT_OPTIONS.retryFailedAfterMinutes, 1, 240),
        batchSize: clampInt(rawOptions?.batchSize, DEFAULT_OPTIONS.batchSize, 1, 500),
        applyRetention: rawOptions?.applyRetention !== false,
    };

    const startedAt = new Date();
    const now = new Date();
    const staleProcessingCutoff = new Date(now.getTime() - options.staleProcessingMinutes * 60 * 1000);
    const stalePendingCutoff = new Date(now.getTime() - options.stalePendingMinutes * 60 * 1000);
    const retryFailedCutoff = new Date(now.getTime() - options.retryFailedAfterMinutes * 60 * 1000);

    const stats: MaintenanceStats = {
        startedAt: startedAt.toISOString(),
        staleCutoffs: {
            processingBefore: staleProcessingCutoff.toISOString(),
            pendingBefore: stalePendingCutoff.toISOString(),
            failedRetryBefore: retryFailedCutoff.toISOString(),
        },
        options,
        transcripts: buildCounter(),
        extractions: buildCounter(),
        retention: {
            enabled: options.applyRetention,
            locationsEvaluated: 0,
            deletedTranscriptRows: 0,
        },
        errors: [],
    };

    // A) stale transcript rows
    const staleTranscripts = await db.messageTranscript.findMany({
        where: {
            deadLetteredAt: null,
            OR: [
                {
                    status: "processing",
                    OR: [
                        { startedAt: { lte: staleProcessingCutoff } },
                        {
                            AND: [
                                { startedAt: null },
                                { updatedAt: { lte: staleProcessingCutoff } },
                            ],
                        },
                    ],
                },
                {
                    status: "pending",
                    updatedAt: { lte: stalePendingCutoff },
                },
            ],
        },
        orderBy: { updatedAt: "asc" },
        take: options.batchSize,
        select: {
            id: true,
            messageId: true,
            attachmentId: true,
            status: true,
            retryCount: true,
            message: {
                select: {
                    conversation: {
                        select: {
                            locationId: true,
                        },
                    },
                },
            },
        },
    });

    for (const item of staleTranscripts) {
        stats.transcripts.inspected += 1;
        try {
            const retries = Number(item.retryCount || 0);
            if (retries >= options.maxRetries) {
                await db.messageTranscript.update({
                    where: { id: item.id },
                    data: {
                        status: "failed",
                        deadLetteredAt: new Date(),
                        error: `Dead-lettered by maintenance job after ${retries} retries (stale ${item.status} row).`,
                    },
                });
                stats.transcripts.deadLettered += 1;
                continue;
            }

            const enqueueResult = await enqueueWhatsAppAudioTranscription({
                locationId: item.message.conversation.locationId,
                messageId: item.messageId,
                attachmentId: item.attachmentId,
                force: true,
                priority: "high",
                allowInlineFallback: false,
            });

            if (enqueueResult.mode === "queue-unavailable") {
                stats.transcripts.queueUnavailable += 1;
                continue;
            }

            if (enqueueResult.mode === "already-queued") {
                await db.messageTranscript.update({
                    where: { id: item.id },
                    data: { lastRetryAt: new Date(), deadLetteredAt: null },
                });
                stats.transcripts.alreadyQueued += 1;
                continue;
            }

            if (enqueueResult.mode === "skipped") {
                stats.transcripts.skipped += 1;
                continue;
            }

            await db.messageTranscript.update({
                where: { id: item.id },
                data: {
                    retryCount: { increment: 1 },
                    lastRetryAt: new Date(),
                    deadLetteredAt: null,
                    error: `Recovered stale ${item.status} transcript row via maintenance re-queue.`,
                    status: "pending",
                    startedAt: null,
                    completedAt: null,
                },
            });
            stats.transcripts.requeued += 1;
        } catch (error: any) {
            stats.transcripts.failed += 1;
            stats.errors.push(`stale transcript ${item.id}: ${String(error?.message || error)}`);
        }
    }

    // B) retry failed transcript rows (transient only)
    const failedTranscripts = await db.messageTranscript.findMany({
        where: {
            status: "failed",
            deadLetteredAt: null,
            retryCount: { lt: options.maxRetries },
            updatedAt: { lte: retryFailedCutoff },
        },
        orderBy: { updatedAt: "asc" },
        take: options.batchSize,
        select: {
            id: true,
            messageId: true,
            attachmentId: true,
            retryCount: true,
            error: true,
            message: {
                select: {
                    conversation: {
                        select: { locationId: true },
                    },
                },
            },
        },
    });

    for (const item of failedTranscripts) {
        stats.transcripts.inspected += 1;
        try {
            if (!isTransientAudioError(item.error)) {
                stats.transcripts.nonTransientSkipped += 1;
                continue;
            }

            const enqueueResult = await enqueueWhatsAppAudioTranscription({
                locationId: item.message.conversation.locationId,
                messageId: item.messageId,
                attachmentId: item.attachmentId,
                force: true,
                priority: "normal",
                allowInlineFallback: false,
            });

            if (enqueueResult.mode === "queue-unavailable") {
                stats.transcripts.queueUnavailable += 1;
                continue;
            }

            if (enqueueResult.mode === "already-queued") {
                await db.messageTranscript.update({
                    where: { id: item.id },
                    data: { lastRetryAt: new Date(), deadLetteredAt: null },
                });
                stats.transcripts.alreadyQueued += 1;
                continue;
            }

            if (enqueueResult.mode === "skipped") {
                stats.transcripts.skipped += 1;
                continue;
            }

            await db.messageTranscript.update({
                where: { id: item.id },
                data: {
                    retryCount: { increment: 1 },
                    lastRetryAt: new Date(),
                    deadLetteredAt: null,
                    error: "Retry scheduled by transcript maintenance job.",
                    status: "pending",
                    startedAt: null,
                    completedAt: null,
                },
            });
            stats.transcripts.requeued += 1;
        } catch (error: any) {
            stats.transcripts.failed += 1;
            stats.errors.push(`failed transcript ${item.id}: ${String(error?.message || error)}`);
        }
    }

    // C) stale extraction rows
    const staleExtractions = await db.messageTranscriptExtraction.findMany({
        where: {
            deadLetteredAt: null,
            OR: [
                {
                    status: "processing",
                    OR: [
                        { startedAt: { lte: staleProcessingCutoff } },
                        {
                            AND: [
                                { startedAt: null },
                                { updatedAt: { lte: staleProcessingCutoff } },
                            ],
                        },
                    ],
                },
                {
                    status: "pending",
                    updatedAt: { lte: stalePendingCutoff },
                },
            ],
        },
        orderBy: { updatedAt: "asc" },
        take: options.batchSize,
        select: {
            id: true,
            status: true,
            retryCount: true,
            transcript: {
                select: {
                    messageId: true,
                    attachmentId: true,
                    message: {
                        select: {
                            conversation: {
                                select: {
                                    locationId: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    });

    for (const item of staleExtractions) {
        stats.extractions.inspected += 1;
        try {
            const retries = Number(item.retryCount || 0);
            if (retries >= options.maxRetries) {
                await db.messageTranscriptExtraction.update({
                    where: { id: item.id },
                    data: {
                        status: "failed",
                        deadLetteredAt: new Date(),
                        error: `Dead-lettered by maintenance job after ${retries} retries (stale ${item.status} row).`,
                    },
                });
                stats.extractions.deadLettered += 1;
                continue;
            }

            const enqueueResult = await enqueueWhatsAppAudioExtraction({
                locationId: item.transcript.message.conversation.locationId,
                messageId: item.transcript.messageId,
                attachmentId: item.transcript.attachmentId,
                extractionId: item.id,
                force: true,
                priority: "high",
                allowInlineFallback: false,
            });

            if (enqueueResult.mode === "queue-unavailable") {
                stats.extractions.queueUnavailable += 1;
                continue;
            }

            if (enqueueResult.mode === "already-queued") {
                await db.messageTranscriptExtraction.update({
                    where: { id: item.id },
                    data: { lastRetryAt: new Date(), deadLetteredAt: null },
                });
                stats.extractions.alreadyQueued += 1;
                continue;
            }

            if (enqueueResult.mode === "skipped") {
                stats.extractions.skipped += 1;
                continue;
            }

            await db.messageTranscriptExtraction.update({
                where: { id: item.id },
                data: {
                    retryCount: { increment: 1 },
                    lastRetryAt: new Date(),
                    deadLetteredAt: null,
                    error: `Recovered stale ${item.status} extraction row via maintenance re-queue.`,
                    status: "pending",
                    startedAt: null,
                    completedAt: null,
                },
            });
            stats.extractions.requeued += 1;
        } catch (error: any) {
            stats.extractions.failed += 1;
            stats.errors.push(`stale extraction ${item.id}: ${String(error?.message || error)}`);
        }
    }

    // D) retry failed extraction rows (transient only)
    const failedExtractions = await db.messageTranscriptExtraction.findMany({
        where: {
            status: "failed",
            deadLetteredAt: null,
            retryCount: { lt: options.maxRetries },
            updatedAt: { lte: retryFailedCutoff },
        },
        orderBy: { updatedAt: "asc" },
        take: options.batchSize,
        select: {
            id: true,
            retryCount: true,
            error: true,
            transcript: {
                select: {
                    messageId: true,
                    attachmentId: true,
                    message: {
                        select: {
                            conversation: {
                                select: {
                                    locationId: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    });

    for (const item of failedExtractions) {
        stats.extractions.inspected += 1;
        try {
            if (!isTransientAudioError(item.error)) {
                stats.extractions.nonTransientSkipped += 1;
                continue;
            }

            const enqueueResult = await enqueueWhatsAppAudioExtraction({
                locationId: item.transcript.message.conversation.locationId,
                messageId: item.transcript.messageId,
                attachmentId: item.transcript.attachmentId,
                extractionId: item.id,
                force: false,
                priority: "normal",
                allowInlineFallback: false,
            });

            if (enqueueResult.mode === "queue-unavailable") {
                stats.extractions.queueUnavailable += 1;
                continue;
            }

            if (enqueueResult.mode === "already-queued") {
                await db.messageTranscriptExtraction.update({
                    where: { id: item.id },
                    data: { lastRetryAt: new Date(), deadLetteredAt: null },
                });
                stats.extractions.alreadyQueued += 1;
                continue;
            }

            if (enqueueResult.mode === "skipped") {
                stats.extractions.skipped += 1;
                continue;
            }

            await db.messageTranscriptExtraction.update({
                where: { id: item.id },
                data: {
                    retryCount: { increment: 1 },
                    lastRetryAt: new Date(),
                    deadLetteredAt: null,
                    error: "Retry scheduled by transcript maintenance job.",
                    status: "pending",
                    startedAt: null,
                    completedAt: null,
                },
            });
            stats.extractions.requeued += 1;
        } catch (error: any) {
            stats.extractions.failed += 1;
            stats.errors.push(`failed extraction ${item.id}: ${String(error?.message || error)}`);
        }
    }

    // E) retention cleanup
    if (options.applyRetention) {
        const configs = await db.siteConfig.findMany({
            select: {
                locationId: true,
                whatsappTranscriptRetentionDays: true,
            } as any,
        });
        stats.retention.locationsEvaluated = configs.length;

        for (const config of configs) {
            try {
                const retentionDays = normalizeRetentionDays((config as any)?.whatsappTranscriptRetentionDays);
                const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

                const deleted = await db.messageTranscript.deleteMany({
                    where: {
                        status: { in: TERMINAL_STATUSES },
                        createdAt: { lt: cutoff },
                        message: {
                            conversation: {
                                locationId: config.locationId,
                            },
                        },
                    },
                });

                stats.retention.deletedTranscriptRows += deleted.count;
            } catch (error: any) {
                stats.errors.push(`retention ${config.locationId}: ${String(error?.message || error)}`);
            }
        }
    }

    stats.finishedAt = new Date().toISOString();
    return stats;
}
