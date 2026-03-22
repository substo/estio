'use server';

import { revalidatePath } from 'next/cache';
import db from '@/lib/db';
import { verifyUserIsLocationAdmin } from '@/lib/auth/permissions';
import { scrapingQueue } from '@/lib/queue/scraping-queue';
import { encryptPassword } from '@/lib/crypto/password-encryption';

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

export async function manualTriggerDeepScrape(locationId: string, limit?: number) {
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    const isAdmin = await verifyUserIsLocationAdmin(userId || '', locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    // We can piggy-back on the same BullMQ scraping queue but with a distinct job name format
    await scrapingQueue.add(`manual-deep-scrape-${locationId}-${Date.now()}`, {
        type: 'deep_scrape',
        locationId: locationId,
        limit: limit || 50,
        triggeredBy: 'manual',
        triggeredByUserId: userId || undefined,
        queuedAt: new Date().toISOString(),
    });

    return true;
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
