"use server";

import db from "@/lib/db";
import { revalidatePath } from "next/cache";
import {
    ACTIVE_OUTBOX_STATUSES,
    PROBLEM_OUTBOX_STATUSES,
    PROBLEM_SYNC_STATUSES,
    buildProviderSyncAlerts,
    sumStatusCounts,
} from "@/lib/integrations/provider-sync-dashboard";
import { resolveIntegrationAdminContext } from "../admin-context";

const DASHBOARD_PATH = "/admin/settings/integrations/provider-sync";
const STALE_LOCK_MS = 15 * 60 * 1000;

function getRequiredFormId(formData: FormData) {
    const id = String(formData.get("id") || "").trim();
    if (!id) {
        throw new Error("Missing job id");
    }
    return id;
}

function toCountRows<T extends { status: string; _count: { _all: number } }>(rows: T[]) {
    return rows.map((row) => ({ status: row.status, count: row._count._all }));
}

function buildRetryOutboxJobData() {
    return {
        status: "pending",
        scheduledAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        processedAt: null,
        lastError: null,
    };
}

function buildDisableOutboxJobData() {
    return {
        status: "disabled",
        lockedAt: null,
        lockedBy: null,
        processedAt: new Date(),
        lastError: "Manually disabled from provider sync operations dashboard.",
    };
}

async function updateProviderOutboxJob(formData: FormData, buildData: () => any) {
    const { locationId } = await resolveIntegrationAdminContext();
    const id = getRequiredFormId(formData);

    const job = await db.providerOutbox.findFirst({
        where: { id, locationId },
        select: { id: true },
    });
    if (!job) {
        throw new Error("Provider job not found");
    }

    await db.providerOutbox.update({
        where: { id },
        data: buildData(),
    });

    revalidatePath(DASHBOARD_PATH);
}

async function updateGmailSyncOutboxJob(formData: FormData, buildData: () => any) {
    const { locationId } = await resolveIntegrationAdminContext();
    const id = getRequiredFormId(formData);

    const job = await db.gmailSyncOutbox.findFirst({
        where: { id, user: { locations: { some: { id: locationId } } } },
        select: { id: true },
    });
    if (!job) {
        throw new Error("Gmail job not found");
    }

    await db.gmailSyncOutbox.update({
        where: { id },
        data: buildData(),
    });

    revalidatePath(DASHBOARD_PATH);
}

export async function getProviderSyncDashboard() {
    const { locationId } = await resolveIntegrationAdminContext();
    const staleLockBefore = new Date(Date.now() - STALE_LOCK_MS);

    const users = await db.user.findMany({
        where: { locations: { some: { id: locationId } } },
        select: { id: true, email: true },
        orderBy: { email: "asc" },
    });
    const userIds = users.map((user) => user.id);

    const [
        providerOutboxByProvider,
        providerOutboxByStatus,
        gmailOutboxByStatus,
        contactOutboxByProvider,
        taskOutboxByProvider,
        viewingOutboxByProvider,
        conversationSyncByProvider,
        messageSyncByProvider,
        contactSyncByProvider,
        recentProviderJobs,
        recentGmailJobs,
        providerStaleLocks,
        gmailStaleLocks,
    ] = await Promise.all([
        db.providerOutbox.groupBy({
            by: ["provider", "status"],
            where: { locationId, status: { in: [...ACTIVE_OUTBOX_STATUSES] } },
            _count: { _all: true },
            orderBy: [{ provider: "asc" }, { status: "asc" }],
        }),
        db.providerOutbox.groupBy({
            by: ["status"],
            where: { locationId, status: { in: [...ACTIVE_OUTBOX_STATUSES] } },
            _count: { _all: true },
        }),
        userIds.length
            ? db.gmailSyncOutbox.groupBy({
                by: ["status"],
                where: { userId: { in: userIds }, status: { in: [...ACTIVE_OUTBOX_STATUSES] } },
                _count: { _all: true },
            })
            : Promise.resolve([]),
        db.contactOutbox.groupBy({
            by: ["provider", "status"],
            where: { locationId, status: { in: [...ACTIVE_OUTBOX_STATUSES] } },
            _count: { _all: true },
            orderBy: [{ provider: "asc" }, { status: "asc" }],
        }),
        db.contactTaskOutbox.groupBy({
            by: ["provider", "status"],
            where: { locationId, status: { in: [...ACTIVE_OUTBOX_STATUSES] } },
            _count: { _all: true },
            orderBy: [{ provider: "asc" }, { status: "asc" }],
        }),
        db.viewingOutbox.groupBy({
            by: ["provider", "status"],
            where: { locationId, status: { in: [...ACTIVE_OUTBOX_STATUSES] } },
            _count: { _all: true },
            orderBy: [{ provider: "asc" }, { status: "asc" }],
        }),
        db.conversationSync.groupBy({
            by: ["provider", "status"],
            where: { locationId, status: { in: [...PROBLEM_SYNC_STATUSES] } },
            _count: { _all: true },
            orderBy: [{ provider: "asc" }, { status: "asc" }],
        }),
        db.messageSync.groupBy({
            by: ["provider", "status"],
            where: { locationId, status: { in: [...PROBLEM_SYNC_STATUSES] } },
            _count: { _all: true },
            orderBy: [{ provider: "asc" }, { status: "asc" }],
        }),
        db.contactSync.groupBy({
            by: ["provider", "status"],
            where: {
                contact: { locationId },
                status: { in: [...PROBLEM_SYNC_STATUSES] },
            },
            _count: { _all: true },
            orderBy: [{ provider: "asc" }, { status: "asc" }],
        }),
        db.providerOutbox.findMany({
            where: { locationId, status: { in: [...ACTIVE_OUTBOX_STATUSES] } },
            select: {
                id: true,
                provider: true,
                providerAccountId: true,
                operation: true,
                status: true,
                attemptCount: true,
                scheduledAt: true,
                lockedAt: true,
                processedAt: true,
                updatedAt: true,
                lastError: true,
                conversationId: true,
                messageId: true,
                contactId: true,
            },
            orderBy: [{ updatedAt: "desc" }],
            take: 25,
        }),
        userIds.length
            ? db.gmailSyncOutbox.findMany({
                where: { userId: { in: userIds }, status: { in: [...ACTIVE_OUTBOX_STATUSES] } },
                select: {
                    id: true,
                    userId: true,
                    operation: true,
                    status: true,
                    attemptCount: true,
                    scheduledAt: true,
                    lockedAt: true,
                    processedAt: true,
                    updatedAt: true,
                    lastError: true,
                    user: { select: { email: true } },
                },
                orderBy: [{ updatedAt: "desc" }],
                take: 25,
            })
            : Promise.resolve([]),
        db.providerOutbox.count({
            where: { locationId, status: "processing", lockedAt: { lt: staleLockBefore } },
        }),
        userIds.length
            ? db.gmailSyncOutbox.count({
                where: { userId: { in: userIds }, status: "processing", lockedAt: { lt: staleLockBefore } },
            })
            : Promise.resolve(0),
    ]);

    const providerStatusRows = toCountRows(providerOutboxByStatus);
    const gmailStatusRows = toCountRows(gmailOutboxByStatus);
    const syncRecordProblemCount =
        conversationSyncByProvider.reduce((total, row) => total + row._count._all, 0) +
        messageSyncByProvider.reduce((total, row) => total + row._count._all, 0) +
        contactSyncByProvider.reduce((total, row) => total + row._count._all, 0);

    const alerts = buildProviderSyncAlerts({
        deadJobs: sumStatusCounts([...providerStatusRows, ...gmailStatusRows], ["dead"]),
        failedJobs: sumStatusCounts([...providerStatusRows, ...gmailStatusRows], ["failed"]),
        disabledJobs: sumStatusCounts([...providerStatusRows, ...gmailStatusRows], ["disabled"]),
        staleRecords: syncRecordProblemCount,
        staleLocks: providerStaleLocks + gmailStaleLocks,
    });

    return {
        locationId,
        users,
        generatedAt: new Date().toISOString(),
        alerts,
        providerOutboxByProvider,
        providerOutboxByStatus,
        gmailOutboxByStatus,
        contactOutboxByProvider,
        taskOutboxByProvider,
        viewingOutboxByProvider,
        conversationSyncByProvider,
        messageSyncByProvider,
        contactSyncByProvider,
        recentProviderJobs,
        recentGmailJobs,
        staleLocks: {
            provider: providerStaleLocks,
            gmail: gmailStaleLocks,
        },
        totals: {
            providerProblemJobs: sumStatusCounts(providerStatusRows, PROBLEM_OUTBOX_STATUSES),
            gmailProblemJobs: sumStatusCounts(gmailStatusRows, PROBLEM_OUTBOX_STATUSES),
            syncRecordProblems: syncRecordProblemCount,
        },
    };
}

export async function retryProviderOutboxJob(formData: FormData) {
    await updateProviderOutboxJob(formData, buildRetryOutboxJobData);
}

export async function disableProviderOutboxJob(formData: FormData) {
    await updateProviderOutboxJob(formData, buildDisableOutboxJobData);
}

export async function retryGmailSyncOutboxJob(formData: FormData) {
    await updateGmailSyncOutboxJob(formData, buildRetryOutboxJobData);
}

export async function disableGmailSyncOutboxJob(formData: FormData) {
    await updateGmailSyncOutboxJob(formData, buildDisableOutboxJobData);
}
