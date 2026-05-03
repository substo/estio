import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { syncRecentMessages, watchGmail } from "@/lib/google/gmail-sync";

const MAX_GMAIL_SYNC_OUTBOX_ATTEMPTS = Math.max(Number(process.env.GMAIL_SYNC_OUTBOX_MAX_ATTEMPTS || 6), 1);
const STALE_GMAIL_SYNC_LOCK_MS = Math.max(Number(process.env.GMAIL_SYNC_OUTBOX_STALE_LOCK_MS || 5 * 60 * 1000), 60_000);

export type GmailSyncOutboxOperation = "sync_user_gmail" | "renew_watch" | "bootstrap_user_gmail";
export type GmailSyncOutboxOutcome = "success" | "failed" | "dead" | "disabled" | "skipped";

export type GmailSyncOutboxProcessResult = {
    outcome: GmailSyncOutboxOutcome;
    requeueDelayMs?: number;
    error?: string;
};

function normalizeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

function computeBackoffMs(attemptCount: number): number {
    const exponent = Math.max(0, attemptCount - 1);
    const baseSeconds = Math.min(30 * 60, Math.pow(2, exponent) * 15);
    const jitter = 0.85 + Math.random() * 0.3;
    return Math.round(baseSeconds * 1000 * jitter);
}

function isRetryableGmailError(error: unknown): boolean {
    const message = String((error as any)?.message || "");
    if (message === "User not connected to Google" || message === "GOOGLE_AUTH_EXPIRED") return false;

    const status = Number((error as any)?.code || (error as any)?.response?.status || (error as any)?.status || 0);
    if (status === 401 || status === 403) return false;
    if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) return true;
    if (status >= 400 && status < 500) return false;

    const code = String((error as any)?.code || (error as any)?.cause?.code || "");
    if (["ECONNABORTED", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(code)) return true;
    return status <= 0;
}

export function buildGmailSyncOutboxIdempotencyKey(args: {
    userId: string;
    operation: GmailSyncOutboxOperation;
}) {
    return ["gmail_sync", args.userId, args.operation].join(":");
}

export async function enqueueGmailSyncOutboxJob(args: {
    userId: string;
    operation: GmailSyncOutboxOperation;
    payload?: Prisma.InputJsonValue | null;
    scheduledAt?: Date;
}) {
    const idempotencyKey = buildGmailSyncOutboxIdempotencyKey({
        userId: args.userId,
        operation: args.operation,
    });

    return (db as any).gmailSyncOutbox.upsert({
        where: { idempotencyKey },
        create: {
            userId: args.userId,
            operation: args.operation,
            payload: args.payload || undefined,
            scheduledAt: args.scheduledAt || new Date(),
            idempotencyKey,
        },
        update: {
            status: "pending",
            scheduledAt: args.scheduledAt || new Date(),
            payload: args.payload || undefined,
            lastError: null,
            lockedAt: null,
            lockedBy: null,
        },
    });
}

async function executeGmailSyncOutbox(row: any) {
    const user = await db.user.findUnique({
        where: { id: row.userId },
        select: {
            id: true,
            googleSyncEnabled: true,
        },
    });

    if (!user) return { disabled: "User no longer exists." };
    if (!user.googleSyncEnabled) {
        return { disabled: "Google Gmail sync is not connected/enabled for this user." };
    }

    await (db as any).gmailSyncState.upsert({
        where: { userId: row.userId },
        create: {
            userId: row.userId,
            status: "synced",
            lastAttemptAt: new Date(),
        },
        update: {
            status: "synced",
            lastAttemptAt: new Date(),
            lastError: null,
        },
    });

    if (row.operation === "renew_watch") {
        await watchGmail(row.userId);
        return { completed: true };
    }

    if (row.operation === "sync_user_gmail") {
        await syncRecentMessages(row.userId);
        return { completed: true };
    }

    if (row.operation === "bootstrap_user_gmail") {
        await syncRecentMessages(row.userId, { forceBootstrap: true });
        return { completed: true };
    }

    return { disabled: `Unsupported Gmail sync outbox operation: ${row.operation}` };
}

async function markGmailSyncOutboxDisabled(row: any, reason: string, attemptCount: number): Promise<GmailSyncOutboxProcessResult> {
    await (db as any).gmailSyncOutbox.update({
        where: { id: row.id },
        data: {
            status: "disabled",
            processedAt: new Date(),
            attemptCount,
            lastError: reason,
            lockedAt: null,
            lockedBy: null,
        },
    });
    await (db as any).gmailSyncState.upsert({
        where: { userId: row.userId },
        create: {
            userId: row.userId,
            status: "disabled",
            lastAttemptAt: new Date(),
            lastError: reason,
        },
        update: {
            status: "disabled",
            lastAttemptAt: new Date(),
            lastError: reason,
        },
    });
    return { outcome: "disabled", error: reason };
}

export async function processGmailSyncOutboxJob(args: {
    outboxId: string;
    workerId?: string;
}): Promise<GmailSyncOutboxProcessResult> {
    const outboxId = String(args.outboxId || "").trim();
    if (!outboxId) return { outcome: "skipped", error: "Missing Gmail sync outbox id." };

    const now = new Date();
    const workerId = args.workerId || `gmail-sync:${randomUUID()}`;
    const lockClaim = await (db as any).gmailSyncOutbox.updateMany({
        where: {
            id: outboxId,
            status: { in: ["pending", "failed"] },
            scheduledAt: { lte: now },
        },
        data: {
            status: "processing",
            lockedAt: now,
            lockedBy: workerId,
        },
    });
    if (!Number(lockClaim?.count || 0)) return { outcome: "skipped" };

    const row = await (db as any).gmailSyncOutbox.findUnique({ where: { id: outboxId } });
    if (!row) return { outcome: "skipped", error: "Gmail sync outbox row no longer exists." };

    const attemptCount = Number(row.attemptCount || 0) + 1;
    try {
        const result = await executeGmailSyncOutbox(row);
        if ((result as any)?.disabled) {
            return markGmailSyncOutboxDisabled(row, String((result as any).disabled), attemptCount);
        }

        await (db as any).gmailSyncOutbox.update({
            where: { id: row.id },
            data: {
                status: "completed",
                processedAt: new Date(),
                attemptCount,
                lastError: null,
                lockedAt: null,
                lockedBy: null,
            },
        });
        await (db as any).gmailSyncState.updateMany({
            where: { userId: row.userId },
            data: {
                status: "synced",
                lastSuccessAt: new Date(),
                lastError: null,
            },
        });
        return { outcome: "success" };
    } catch (error) {
        const message = normalizeError(error);
        const canRetry = isRetryableGmailError(error) && attemptCount < MAX_GMAIL_SYNC_OUTBOX_ATTEMPTS;
        if (canRetry) {
            const backoffMs = computeBackoffMs(attemptCount);
            await (db as any).gmailSyncOutbox.update({
                where: { id: row.id },
                data: {
                    status: "failed",
                    attemptCount,
                    lastError: message,
                    scheduledAt: new Date(Date.now() + backoffMs),
                    lockedAt: null,
                    lockedBy: null,
                },
            });
            await (db as any).gmailSyncState.updateMany({
                where: { userId: row.userId },
                data: {
                    status: "error",
                    lastAttemptAt: new Date(),
                    lastError: message,
                },
            });
            return { outcome: "failed", requeueDelayMs: backoffMs, error: message };
        }

        await (db as any).gmailSyncOutbox.update({
            where: { id: row.id },
            data: {
                status: "dead",
                processedAt: new Date(),
                attemptCount,
                lastError: message,
                lockedAt: null,
                lockedBy: null,
            },
        });
        await (db as any).gmailSyncState.updateMany({
            where: { userId: row.userId },
            data: {
                status: "error",
                lastAttemptAt: new Date(),
                lastError: message,
            },
        });
        return { outcome: "dead", error: message };
    }
}

export async function recoverStaleGmailSyncOutboxLocks() {
    const staleBefore = new Date(Date.now() - STALE_GMAIL_SYNC_LOCK_MS);
    const recovered = await (db as any).gmailSyncOutbox.updateMany({
        where: {
            status: "processing",
            lockedAt: { lt: staleBefore },
        },
        data: {
            status: "failed",
            lockedAt: null,
            lockedBy: null,
            scheduledAt: new Date(),
            lastError: "Recovered stale processing lock; re-queued.",
        },
    });
    return Number(recovered?.count || 0);
}

export async function listDueGmailSyncOutboxIds(limit = 100): Promise<string[]> {
    const rows = await (db as any).gmailSyncOutbox.findMany({
        where: {
            status: { in: ["pending", "failed"] },
            scheduledAt: { lte: new Date() },
        },
        orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
        take: Math.max(1, Math.min(Number(limit || 100), 500)),
        select: { id: true },
    });
    return rows.map((row: any) => String(row.id));
}
