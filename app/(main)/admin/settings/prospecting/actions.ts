'use server';

import { revalidatePath } from 'next/cache';
import db from '@/lib/db';
import { verifyUserIsLocationAdmin } from '@/lib/auth/permissions';
import { getScrapingQueueDiagnostics, scrapingQueue } from '@/lib/queue/scraping-queue';
import { encryptPassword } from '@/lib/crypto/password-encryption';
import {
    DEFAULT_PRIVATE_CONFIDENCE_THRESHOLD,
    type DeepScrapeConfigSnapshot,
    isDeepScrapeTerminalStatus,
} from '@/lib/scraping/deep-scrape-types';

export interface ScrapingRunOverview {
    windowHours: number;
    totalRuns: number;
    runningRuns: number;
    completedRuns: number;
    partialRuns: number;
    failedRuns: number;
    successRate: number; // Percent over finished runs (0-100)
    avgDurationSeconds: number | null;
    p95DurationSeconds: number | null;
    lastFailureAt: string | null;
    topFailingTasks: Array<{
        taskId: string;
        taskName: string;
        failures: number;
    }>;
}

export interface DeepScrapeRunOverview {
    windowHours: number;
    totalRuns: number;
    queuedRuns: number;
    runningRuns: number;
    completedRuns: number;
    partialRuns: number;
    failedRuns: number;
    cancelledRuns: number;
    successRate: number;
    avgDurationSeconds: number | null;
    p95DurationSeconds: number | null;
    lastFailureAt: string | null;
    totals: {
        seedListingsFound: number;
        contactsWithPhone: number;
        contactsWithoutPhone: number;
        portfolioListingsDeepScraped: number;
        omittedAgency: number;
        omittedUncertain: number;
        omittedMissingPhone: number;
        omittedNonRealEstate: number;
        omittedDuplicate: number;
        omittedBudgetExhausted: number;
        errorsTotal: number;
    };
}

export interface DeepScrapeQueueDiagnostics {
    generatedAt: string;
    workerAlive: boolean;
    workerHeartbeatAgeSeconds: number | null;
    activeWorkers: Array<{
        instanceId: string;
        role: string;
        pid: number | null;
        hostname: string | null;
        startedAt: string | null;
        updatedAt: string;
    }>;
    queueDepth: {
        waiting: number;
        active: number;
        delayed: number;
        paused: number;
        failed: number;
        completed: number;
    };
    recentFailedJobs: Array<{
        id: string;
        name: string;
        failedReason: string | null;
        finishedOn: string | null;
        attemptsMade: number;
    }>;
}

export interface ManualDeepScrapeTriggerResult {
    runId: string;
    status: 'queued';
    run: {
        id: string;
        createdAt: string;
        status: string;
        queuedAt: string | null;
        completedAt: string | null;
        triggeredBy: string | null;
        triggeredByUserId: string | null;
        queueJobId: string | null;
        seedListingsFound: number;
        contactsWithPhone: number;
        contactsWithoutPhone: number;
        portfolioListingsDeepScraped: number;
        omittedAgency: number;
        omittedUncertain: number;
        omittedMissingPhone: number;
        omittedNonRealEstate: number;
        omittedDuplicate: number;
        omittedBudgetExhausted: number;
        errorsTotal: number;
        errorLog: string | null;
        configSnapshot: Record<string, unknown> | null;
        stages: Array<{
            id: string;
            createdAt: string;
            taskId: string | null;
            stage: string;
            status: string;
            reasonCode: string | null;
            message: string | null;
            counters: Record<string, unknown> | null;
            metadata: Record<string, unknown> | null;
        }>;
    };
}

// --- CONNECTIONS ---

export async function getScrapingConnections(locationId: string) {
    if (!locationId) return [];
    return await db.scrapingConnection.findMany({
        where: { locationId },
        orderBy: { createdAt: 'desc' }
    });
}

export async function createScrapingConnection(locationId: string, data: any) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized to create scraping connections");

    const connection = await db.scrapingConnection.create({
        data: {
            locationId,
            name: data.name,
            platform: data.platform,
            enabled: data.enabled ?? true,
            // Rate limit explicitly if needed in future, currently defaults to 5000
        }
    });

    revalidatePath('/admin/settings/prospecting');
    return connection;
}

export async function updateScrapingConnection(id: string, locationId: string, data: any) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    const updateData: any = {
        name: data.name,
        platform: data.platform,
        enabled: data.enabled,
    };

    const connection = await db.scrapingConnection.update({
        where: { id, locationId },
        data: updateData
    });

    revalidatePath('/admin/settings/prospecting');
    return connection;
}

export async function deleteScrapingConnection(id: string, locationId: string) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    await db.scrapingConnection.delete({
        where: { id, locationId }
    });

    revalidatePath('/admin/settings/prospecting');
    return true;
}

// --- CREDENTIALS ---

export async function getScrapingCredentials(connectionId: string) {
    if (!connectionId) return [];
    return await db.scrapingCredential.findMany({
        where: { connectionId },
        orderBy: { createdAt: 'desc' }
    });
}

export async function createScrapingCredential(connectionId: string, locationId: string, data: any) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    let encryptedPassword = null;
    if (data.authPassword) {
        encryptedPassword = encryptPassword(data.authPassword);
    }

    const cred = await db.scrapingCredential.create({
        data: {
            connectionId,
            authUsername: data.authUsername,
            authPassword: encryptedPassword,
            status: data.status || 'active',
        }
    });

    revalidatePath('/admin/settings/prospecting');
    return cred;
}

export async function updateScrapingCredential(id: string, locationId: string, data: any) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    const updateData: any = {
        authUsername: data.authUsername,
        status: data.status,
    };

    if (data.authPassword) {
        updateData.authPassword = encryptPassword(data.authPassword);
    }

    const cred = await db.scrapingCredential.update({
        where: { id }, // connection handles tenant implicit
        data: updateData
    });

    revalidatePath('/admin/settings/prospecting');
    return cred;
}

export async function deleteScrapingCredential(id: string, locationId: string) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    await db.scrapingCredential.delete({
        where: { id }
    });

    revalidatePath('/admin/settings/prospecting');
    return true;
}

// --- TASKS ---

export async function getScrapingTasks(locationId: string) {
    if (!locationId) return [];
    return await db.scrapingTask.findMany({
        where: { locationId },
        include: { connection: true },
        orderBy: { createdAt: 'desc' }
    });
}

export async function createScrapingTask(locationId: string, data: any) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized to create scraping tasks");

    const targetUrls = data.targetUrls ? data.targetUrls.split(',').map((s: string) => s.trim()).filter(Boolean) : [];

    const task = await db.scrapingTask.create({
        data: {
            locationId,
            connectionId: data.connectionId,
            name: data.name,
            enabled: data.enabled ?? true,
            scrapeFrequency: data.scrapeFrequency || 'daily',
            extractionMode: data.extractionMode || 'hybrid',
            scrapeStrategy: data.scrapeStrategy || 'shallow_duplication',
            targetSellerType: data.targetSellerType || 'individual',
            delayBetweenPagesMs: parseInt(data.delayBetweenPagesMs) || 3000,
            delayJitterMs: parseInt(data.delayJitterMs) || 1500,
            maxInteractionsPerRun: data.maxInteractionsPerRun ? parseInt(data.maxInteractionsPerRun) : null,
            aiInstructions: data.aiInstructions,
            targetUrls,
            fieldMappings: data.fieldMappings ? JSON.parse(data.fieldMappings) : null,
        }
    });

    revalidatePath('/admin/settings/prospecting');
    return task;
}

export async function updateScrapingTask(id: string, locationId: string, data: any) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    const updateData: any = {
        name: data.name,
        connectionId: data.connectionId,
        enabled: data.enabled,
        scrapeFrequency: data.scrapeFrequency,
        extractionMode: data.extractionMode,
        scrapeStrategy: data.scrapeStrategy,
        targetSellerType: data.targetSellerType,
        delayBetweenPagesMs: parseInt(data.delayBetweenPagesMs),
        delayJitterMs: parseInt(data.delayJitterMs),
        maxInteractionsPerRun: data.maxInteractionsPerRun ? parseInt(data.maxInteractionsPerRun) : null,
        aiInstructions: data.aiInstructions,
    };

    if (data.targetUrls !== undefined) {
         updateData.targetUrls = typeof data.targetUrls === 'string' 
            ? data.targetUrls.split(',').map((s: string) => s.trim()).filter(Boolean) 
            : data.targetUrls;
    }

    if (data.fieldMappings !== undefined) {
        updateData.fieldMappings = typeof data.fieldMappings === 'string' && data.fieldMappings
            ? JSON.parse(data.fieldMappings)
            : data.fieldMappings;
    }

    const task = await db.scrapingTask.update({
        where: { id, locationId }, 
        data: updateData
    });

    revalidatePath('/admin/settings/prospecting');
    return task;
}

export async function deleteScrapingTask(id: string, locationId: string) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    await db.scrapingTask.delete({
        where: { id, locationId }
    });

    revalidatePath('/admin/settings/prospecting');
    return true;
}

export async function manualTriggerScrape(id: string, locationId: string, pageLimit?: number) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    const task = await db.scrapingTask.findUnique({
        where: { id, locationId }
    });

    if (!task) throw new Error("Task not found");

    await scrapingQueue.add(`manual-scrape-${task.id}-${Date.now()}`, {
        taskId: task.id,
        locationId: task.locationId,
        pageLimit,
        triggeredBy: 'manual',
        triggeredByUserId: userId || undefined,
        queuedAt: new Date().toISOString(),
    });

    return true;
}

export async function manualTriggerDeepScrape(
    locationId: string,
    limit?: number,
): Promise<ManualDeepScrapeTriggerResult> {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit as number))) : 50;
    const queuedAt = new Date();
    const deepScrapeConfig: DeepScrapeConfigSnapshot = {
        version: 'manual_deep_orchestrator_v1',
        maxSeedListingsPerTask: safeLimit,
        privateConfidenceThreshold: DEFAULT_PRIVATE_CONFIDENCE_THRESHOLD,
        requirePhoneForPortfolio: true,
        scope: {
            platform: 'bazaraki',
            enabledTasksOnly: true,
            targetUrlsRequired: true,
        },
    };

    const run = await db.deepScrapeRun.create({
        data: {
            locationId,
            status: 'queued',
            triggeredBy: 'manual',
            triggeredByUserId: userId || null,
            queuedAt,
            startedAt: queuedAt,
            configSnapshot: deepScrapeConfig as any,
            metadata: {
                trigger: {
                    source: 'manual',
                    initiatedByUserId: userId || null,
                    queuedAt: queuedAt.toISOString(),
                },
                flow: 'manual_deep_orchestrator',
                orchestration: deepScrapeConfig,
            } as any,
        },
    });

    await db.deepScrapeRunStage.create({
        data: {
            runId: run.id,
            locationId,
            stage: 'run_queued',
            status: 'info',
            message: 'Manual deep scrape queued.',
            metadata: {
                runId: run.id,
                locationId,
                triggeredByUserId: userId || null,
                queuedAt: queuedAt.toISOString(),
            } as any,
        },
    });

    try {
        const job = await scrapingQueue.add(`manual-deep-scrape-${locationId}-${Date.now()}`, {
            type: 'deep_scrape',
            runId: run.id,
            locationId,
            limit: safeLimit,
            deepScrapeConfig,
            triggeredBy: 'manual',
            triggeredByUserId: userId || undefined,
            queuedAt: queuedAt.toISOString(),
        });

        const queueJobId = String(job?.id ?? '');
        const updatedRun = await db.deepScrapeRun.update({
            where: { id: run.id },
            data: {
                queueJobId: queueJobId || null,
                metadata: {
                    trigger: {
                        source: 'manual',
                        initiatedByUserId: userId || null,
                        queuedAt: queuedAt.toISOString(),
                        queueJobId: queueJobId || null,
                    },
                    flow: 'manual_deep_orchestrator',
                    orchestration: deepScrapeConfig,
                } as any,
            },
            include: {
                stages: {
                    orderBy: { createdAt: 'desc' },
                    take: 60,
                },
            },
        });

        revalidatePath('/admin/settings/prospecting');

        return {
            runId: updatedRun.id,
            status: 'queued',
            run: {
                id: updatedRun.id,
                createdAt: updatedRun.createdAt.toISOString(),
                status: updatedRun.status,
                queuedAt: updatedRun.queuedAt ? updatedRun.queuedAt.toISOString() : null,
                completedAt: updatedRun.completedAt ? updatedRun.completedAt.toISOString() : null,
                triggeredBy: updatedRun.triggeredBy || null,
                triggeredByUserId: updatedRun.triggeredByUserId || null,
                queueJobId: updatedRun.queueJobId || null,
                seedListingsFound: updatedRun.seedListingsFound,
                contactsWithPhone: updatedRun.contactsWithPhone,
                contactsWithoutPhone: updatedRun.contactsWithoutPhone,
                portfolioListingsDeepScraped: updatedRun.portfolioListingsDeepScraped,
                omittedAgency: updatedRun.omittedAgency,
                omittedUncertain: updatedRun.omittedUncertain,
                omittedMissingPhone: updatedRun.omittedMissingPhone,
                omittedNonRealEstate: updatedRun.omittedNonRealEstate,
                omittedDuplicate: updatedRun.omittedDuplicate,
                omittedBudgetExhausted: updatedRun.omittedBudgetExhausted,
                errorsTotal: updatedRun.errorsTotal,
                errorLog: updatedRun.errorLog || null,
                configSnapshot: (updatedRun.configSnapshot as Record<string, unknown> | null) ?? null,
                stages: (updatedRun.stages || []).map((stage) => ({
                    id: stage.id,
                    createdAt: stage.createdAt.toISOString(),
                    taskId: stage.taskId || null,
                    stage: stage.stage,
                    status: stage.status,
                    reasonCode: stage.reasonCode || null,
                    message: stage.message || null,
                    counters: (stage.counters as Record<string, unknown> | null) ?? null,
                    metadata: (stage.metadata as Record<string, unknown> | null) ?? null,
                })),
            },
        };
    } catch (error: any) {
        const errorMessage = error?.message || 'Failed to enqueue deep scrape run';

        await db.$transaction([
            db.deepScrapeRun.update({
                where: { id: run.id },
                data: {
                    status: 'failed',
                    errorLog: errorMessage,
                    completedAt: new Date(),
                },
            }),
            db.deepScrapeRunStage.create({
                data: {
                    runId: run.id,
                    locationId,
                    stage: 'run_enqueue_failed',
                    status: 'error',
                    reasonCode: 'task_error',
                    message: `Failed to enqueue deep scrape run: ${errorMessage}`,
                    metadata: {
                        runId: run.id,
                        locationId,
                        triggeredByUserId: userId || null,
                    } as any,
                },
            }),
        ]);

        revalidatePath('/admin/settings/prospecting');
        throw new Error(errorMessage);
    }
}

export async function getDeepScrapeRuns(locationId: string, limit = 15) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 15;
    return db.deepScrapeRun.findMany({
        where: { locationId },
        include: {
            stages: {
                orderBy: { createdAt: 'desc' },
                take: 60,
            },
        },
        orderBy: { createdAt: 'desc' },
        take: safeLimit,
    });
}

export async function getDeepScrapeRunDetails(locationId: string, runId: string, stageLimit = 200) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    const safeStageLimit = Number.isFinite(stageLimit)
        ? Math.max(1, Math.min(1000, Math.floor(stageLimit)))
        : 200;

    const run = await db.deepScrapeRun.findFirst({
        where: {
            id: runId,
            locationId,
        },
        include: {
            stages: {
                orderBy: { createdAt: 'desc' },
                take: safeStageLimit,
            },
        },
    });

    if (!run) throw new Error("Deep scrape run not found");
    return run;
}

export async function getDeepScrapeQueueDiagnostics(locationId: string): Promise<DeepScrapeQueueDiagnostics> {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    return getScrapingQueueDiagnostics();
}

export async function getDeepScrapeRunOverview(locationId: string, windowHours = 24): Promise<DeepScrapeRunOverview> {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    const safeWindowHours = Number.isFinite(windowHours) ? Math.max(1, Math.min(24 * 30, Math.floor(windowHours))) : 24;
    const since = new Date(Date.now() - safeWindowHours * 60 * 60 * 1000);

    const runs = await db.deepScrapeRun.findMany({
        where: {
            locationId,
            createdAt: { gte: since },
        },
        select: {
            id: true,
            status: true,
            createdAt: true,
            completedAt: true,
            seedListingsFound: true,
            contactsWithPhone: true,
            contactsWithoutPhone: true,
            portfolioListingsDeepScraped: true,
            omittedAgency: true,
            omittedUncertain: true,
            omittedMissingPhone: true,
            omittedNonRealEstate: true,
            omittedDuplicate: true,
            omittedBudgetExhausted: true,
            errorsTotal: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
    });

    const totalRuns = runs.length;
    const queuedRuns = runs.filter((run) => run.status === 'queued').length;
    const runningRuns = runs.filter((run) => run.status === 'running').length;
    const completedRuns = runs.filter((run) => run.status === 'completed').length;
    const partialRuns = runs.filter((run) => run.status === 'partial').length;
    const failedRuns = runs.filter((run) => run.status === 'failed').length;
    const cancelledRuns = runs.filter((run) => run.status === 'cancelled').length;

    const finishedRuns = runs.filter((run) => isDeepScrapeTerminalStatus(run.status));
    const successRate = finishedRuns.length > 0
        ? Number(((completedRuns / finishedRuns.length) * 100).toFixed(1))
        : 0;

    const durationsSeconds = runs
        .filter((run) => Boolean(run.completedAt))
        .map((run) => ((run.completedAt as Date).getTime() - run.createdAt.getTime()) / 1000)
        .filter((seconds) => Number.isFinite(seconds) && seconds >= 0)
        .sort((a, b) => a - b);

    const avgDurationSeconds = durationsSeconds.length > 0
        ? Number((durationsSeconds.reduce((sum, value) => sum + value, 0) / durationsSeconds.length).toFixed(1))
        : null;
    const p95DurationSeconds = durationsSeconds.length > 0
        ? Number(durationsSeconds[Math.min(durationsSeconds.length - 1, Math.floor(durationsSeconds.length * 0.95))].toFixed(1))
        : null;

    const totals = runs.reduce((acc, run) => {
        acc.seedListingsFound += run.seedListingsFound || 0;
        acc.contactsWithPhone += run.contactsWithPhone || 0;
        acc.contactsWithoutPhone += run.contactsWithoutPhone || 0;
        acc.portfolioListingsDeepScraped += run.portfolioListingsDeepScraped || 0;
        acc.omittedAgency += run.omittedAgency || 0;
        acc.omittedUncertain += run.omittedUncertain || 0;
        acc.omittedMissingPhone += run.omittedMissingPhone || 0;
        acc.omittedNonRealEstate += run.omittedNonRealEstate || 0;
        acc.omittedDuplicate += run.omittedDuplicate || 0;
        acc.omittedBudgetExhausted += run.omittedBudgetExhausted || 0;
        acc.errorsTotal += run.errorsTotal || 0;
        return acc;
    }, {
        seedListingsFound: 0,
        contactsWithPhone: 0,
        contactsWithoutPhone: 0,
        portfolioListingsDeepScraped: 0,
        omittedAgency: 0,
        omittedUncertain: 0,
        omittedMissingPhone: 0,
        omittedNonRealEstate: 0,
        omittedDuplicate: 0,
        omittedBudgetExhausted: 0,
        errorsTotal: 0,
    });

    const lastFailure = runs.find((run) => run.status === 'failed' || run.status === 'partial');

    return {
        windowHours: safeWindowHours,
        totalRuns,
        queuedRuns,
        runningRuns,
        completedRuns,
        partialRuns,
        failedRuns,
        cancelledRuns,
        successRate,
        avgDurationSeconds,
        p95DurationSeconds,
        lastFailureAt: lastFailure?.createdAt?.toISOString?.() || null,
        totals,
    };
}

export async function getScrapingRuns(taskId: string, locationId: string, limit = 15) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    if (!taskId) return [];
    return await db.scrapingRun.findMany({
        where: {
            taskId,
            task: { locationId },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
    });
}

export async function getScrapingRunOverview(locationId: string, windowHours = 24): Promise<ScrapingRunOverview> {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    const safeWindowHours = Number.isFinite(windowHours) ? Math.max(1, Math.min(24 * 30, Math.floor(windowHours))) : 24;
    const since = new Date(Date.now() - safeWindowHours * 60 * 60 * 1000);

    const runs = await db.scrapingRun.findMany({
        where: {
            createdAt: { gte: since },
            task: { locationId },
        },
        select: {
            id: true,
            taskId: true,
            status: true,
            createdAt: true,
            completedAt: true,
            errors: true,
            task: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
    });

    const totalRuns = runs.length;
    const runningRuns = runs.filter((run) => run.status === 'running').length;
    const completedRuns = runs.filter((run) => run.status === 'completed').length;
    const partialRuns = runs.filter((run) => run.status === 'partial').length;
    const failedRuns = runs.filter((run) => run.status === 'failed').length;

    const finishedRuns = runs.filter((run) => run.status !== 'running');
    const successRate = finishedRuns.length > 0
        ? Number(((completedRuns / finishedRuns.length) * 100).toFixed(1))
        : 0;

    const durationsSeconds = runs
        .filter((run) => Boolean(run.completedAt))
        .map((run) => ((run.completedAt as Date).getTime() - run.createdAt.getTime()) / 1000)
        .filter((seconds) => Number.isFinite(seconds) && seconds >= 0)
        .sort((a, b) => a - b);

    const avgDurationSeconds = durationsSeconds.length > 0
        ? Number((durationsSeconds.reduce((sum, value) => sum + value, 0) / durationsSeconds.length).toFixed(1))
        : null;
    const p95DurationSeconds = durationsSeconds.length > 0
        ? Number(durationsSeconds[Math.min(durationsSeconds.length - 1, Math.floor(durationsSeconds.length * 0.95))].toFixed(1))
        : null;

    const failingRuns = runs.filter((run) => run.status === 'failed' || run.status === 'partial');
    const topFailingTaskMap = new Map<string, { taskName: string; failures: number }>();
    for (const run of failingRuns) {
        const current = topFailingTaskMap.get(run.taskId);
        if (!current) {
            topFailingTaskMap.set(run.taskId, { taskName: run.task.name || 'Unnamed Task', failures: 1 });
        } else {
            current.failures += 1;
        }
    }

    const topFailingTasks = Array.from(topFailingTaskMap.entries())
        .map(([taskId, value]) => ({
            taskId,
            taskName: value.taskName,
            failures: value.failures,
        }))
        .sort((a, b) => b.failures - a.failures)
        .slice(0, 5);

    const lastFailure = runs.find((run) => run.status === 'failed' || run.status === 'partial');

    return {
        windowHours: safeWindowHours,
        totalRuns,
        runningRuns,
        completedRuns,
        partialRuns,
        failedRuns,
        successRate,
        avgDurationSeconds,
        p95DurationSeconds,
        lastFailureAt: lastFailure?.createdAt?.toISOString?.() || null,
        topFailingTasks,
    };
}
