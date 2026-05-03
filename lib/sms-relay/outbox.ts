/**
 * lib/sms-relay/outbox.ts
 *
 * Reliable delivery queue for outbound SMS via the Android relay.
 * Mirrors the ProviderOutbox pattern (lock → process → ack → retry with backoff).
 *
 * Status lifecycle:
 *   pending → processing → sent         (happy path)
 *   pending → processing → failed       (retry up to MAX_ATTEMPTS with backoff)
 *   failed  → processing → dead         (exhausted retries)
 *   pending → cancelled                 (device unlinked / conversation deleted)
 */

import { randomUUID } from "crypto";
import db from "@/lib/db";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MAX_SMS_RELAY_OUTBOX_ATTEMPTS = Math.max(
    Number(process.env.SMS_RELAY_OUTBOX_MAX_ATTEMPTS || 5),
    1
);

const STALE_LOCK_MS = Math.max(
    Number(process.env.SMS_RELAY_OUTBOX_STALE_LOCK_MS || 5 * 60 * 1000), // 5 min
    60_000
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SmsRelayOutboxOutcome = "success" | "failed" | "dead" | "skipped" | "cancelled";

export type SmsRelayOutboxResult = {
    outcome: SmsRelayOutboxOutcome;
    requeueDelayMs?: number;
    error?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    try { return JSON.stringify(error); } catch { return String(error); }
}

function computeBackoffMs(attemptCount: number): number {
    const exponent = Math.max(0, attemptCount - 1);
    const baseSeconds = Math.min(30 * 60, Math.pow(2, exponent) * 15);
    const jitter = 0.85 + Math.random() * 0.3;
    return Math.round(baseSeconds * 1000 * jitter);
}

function buildIdempotencyKey(locationId: string, messageId: string): string {
    return `sms-relay:${locationId}:${messageId}`;
}

// ---------------------------------------------------------------------------
// Enqueue (create outbox row)
// ---------------------------------------------------------------------------

export async function enqueueSmsRelayOutbox(args: {
    locationId: string;
    conversationId: string;
    messageId: string;
    deviceId: string;
    toNumber: string;
    body: string;
    scheduledAt?: Date;
}) {
    const idempotencyKey = buildIdempotencyKey(args.locationId, args.messageId);

    return (db as any).smsRelayOutbox.upsert({
        where: { idempotencyKey },
        create: {
            locationId: args.locationId,
            conversationId: args.conversationId,
            messageId: args.messageId,
            deviceId: args.deviceId,
            toNumber: args.toNumber,
            body: args.body,
            scheduledAt: args.scheduledAt ?? new Date(),
            idempotencyKey,
        },
        update: {
            // Idempotent re-enqueue: reset to pending for a retry
            status: "pending",
            scheduledAt: args.scheduledAt ?? new Date(),
            lastError: null,
        },
    });
}

// ---------------------------------------------------------------------------
// List due jobs (for cron → BullMQ enqueue)
// ---------------------------------------------------------------------------

export async function listDueSmsRelayOutboxIds(limit = 200): Promise<string[]> {
    const rows = await (db as any).smsRelayOutbox.findMany({
        where: {
            status: { in: ["pending", "failed"] },
            scheduledAt: { lte: new Date() },
        },
        orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
        take: Math.max(1, Math.min(Number(limit), 500)),
        select: { id: true },
    });
    return rows.map((r: any) => String(r.id));
}

// ---------------------------------------------------------------------------
// Stale lock recovery
// ---------------------------------------------------------------------------

export async function recoverStaleSmsRelayOutboxLocks(): Promise<number> {
    const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
    const result = await (db as any).smsRelayOutbox.updateMany({
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
    return Number(result?.count || 0);
}

// ---------------------------------------------------------------------------
// Process a single outbox job
// (called by BullMQ worker; device already ACKed via job-result route)
// This function is responsible for locking the row and marking it as
// "processing" so the gateway /jobs endpoint can pick it up.
// ---------------------------------------------------------------------------

export async function processSmsRelayOutboxJob(args: {
    outboxId: string;
    workerId?: string;
}): Promise<SmsRelayOutboxResult> {
    const outboxId = String(args.outboxId || "").trim();
    if (!outboxId) return { outcome: "skipped", error: "Missing outbox id." };

    const now = new Date();
    const workerId = args.workerId || `sms-relay:${randomUUID()}`;

    // Atomic lock claim
    const lockClaim = await (db as any).smsRelayOutbox.updateMany({
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

    if (!Number(lockClaim?.count || 0)) {
        return { outcome: "skipped" };
    }

    const row = await (db as any).smsRelayOutbox.findUnique({
        where: { id: outboxId },
        include: { device: true },
    });

    if (!row) return { outcome: "skipped", error: "Outbox row no longer exists." };

    // Validate device exists and is paired — if device gone, cancel the job
    if (!row.device || !row.device.paired) {
        await (db as any).smsRelayOutbox.update({
            where: { id: outboxId },
            data: {
                status: "cancelled",
                processedAt: new Date(),
                lockedAt: null,
                lockedBy: null,
                lastError: "Device is not paired or was removed.",
            },
        });
        return { outcome: "cancelled", error: "Device not paired." };
    }

    // The row is now "processing" — the Android app polls /jobs and picks it up.
    // The actual status transition (processing → sent | failed) happens in the
    // job-result route when the device ACKs the result.
    // This function's job is done — return success so BullMQ removes the job.
    return { outcome: "success" };
}

// ---------------------------------------------------------------------------
// Mark job result (called by the job-result API route after device ACK)
// ---------------------------------------------------------------------------

export async function markSmsRelayOutboxResult(args: {
    outboxId: string;
    deviceId: string;
    result: "sent" | "failed" | "cancelled";
    errorMessage?: string | null;
}): Promise<{ status: string } | null> {
    const row = await (db as any).smsRelayOutbox.findFirst({
        where: {
            id: args.outboxId,
            deviceId: args.deviceId,
        },
    });

    if (!row) return null;

    const attemptCount = Number(row.attemptCount || 0) + 1;

    if (args.result === "sent") {
        await (db as any).smsRelayOutbox.update({
            where: { id: row.id },
            data: {
                status: "sent",
                processedAt: new Date(),
                attemptCount,
                lastError: null,
                lockedAt: null,
                lockedBy: null,
            },
        });

        // Update the linked Message status
        await db.message.update({
            where: { id: row.messageId },
            data: { status: "sent", updatedAt: new Date() },
        }).catch((err: any) =>
            console.error("[SmsRelayOutbox] Failed to update message status to sent:", err)
        );

        return { status: "sent" };
    }

    if (args.result === "cancelled") {
        await (db as any).smsRelayOutbox.update({
            where: { id: row.id },
            data: {
                status: "cancelled",
                processedAt: new Date(),
                attemptCount,
                lastError: args.errorMessage || "Cancelled by device.",
                lockedAt: null,
                lockedBy: null,
            },
        });
        await db.message.update({
            where: { id: row.messageId },
            data: { status: "failed", updatedAt: new Date() },
        }).catch(() => {});
        return { status: "cancelled" };
    }

    // result === "failed"
    const canRetry = attemptCount < MAX_SMS_RELAY_OUTBOX_ATTEMPTS;
    if (canRetry) {
        const backoffMs = computeBackoffMs(attemptCount);
        await (db as any).smsRelayOutbox.update({
            where: { id: row.id },
            data: {
                status: "failed",
                attemptCount,
                lastError: args.errorMessage || "Send failed on device.",
                scheduledAt: new Date(Date.now() + backoffMs),
                lockedAt: null,
                lockedBy: null,
            },
        });
        return { status: "failed_retrying" };
    }

    // Dead
    await (db as any).smsRelayOutbox.update({
        where: { id: row.id },
        data: {
            status: "dead",
            processedAt: new Date(),
            attemptCount,
            lastError: args.errorMessage || "Send failed — max attempts reached.",
            lockedAt: null,
            lockedBy: null,
        },
    });
    await db.message.update({
        where: { id: row.messageId },
        data: { status: "failed", updatedAt: new Date() },
    }).catch(() => {});
    return { status: "dead" };
}
