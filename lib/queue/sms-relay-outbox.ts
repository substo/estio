/**
 * lib/queue/sms-relay-outbox.ts
 *
 * BullMQ queue + worker for processing SmsRelayOutbox rows.
 * Mirrors lib/queue/provider-outbox.ts exactly.
 *
 * The worker's job is lightweight: it locks the outbox row (status=processing)
 * so the Android gateway /jobs endpoint can pick it up.
 * Actual status resolution (sent/failed) happens in the /job-result route.
 */

import { randomUUID } from "crypto";
import { listDueSmsRelayOutboxIds, processSmsRelayOutboxJob, recoverStaleSmsRelayOutboxLocks } from "@/lib/sms-relay/outbox";
import { buildQueueJobId, isDuplicateQueueJobError } from "@/lib/queue/job-id";

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
};

const QUEUE_NAME = "sms-relay-outbox";

type SmsRelayOutboxQueueJobData = {
    outboxId: string;
    queuedAt: string;
};

let _queuePromise: Promise<any> | null = null;
let _workerPromise: Promise<any> | null = null;

async function getQueueInstance() {
    if (!_queuePromise) {
        _queuePromise = (async () => {
            const { Queue } = await import("bullmq");
            return new Queue<SmsRelayOutboxQueueJobData>(QUEUE_NAME, {
                connection: REDIS_CONNECTION,
                defaultJobOptions: {
                    removeOnComplete: true,
                    removeOnFail: 300,
                },
            });
        })();
    }
    try {
        return await _queuePromise;
    } catch (error) {
        _queuePromise = null;
        throw error;
    }
}

function getSmsRelayQueueJobId(outboxId: string): string {
    return buildQueueJobId("sms-relay-outbox", outboxId);
}

export async function enqueueSmsRelayOutboxQueueJob(args: {
    outboxId: string;
    delayMs?: number;
}) {
    const outboxId = String(args.outboxId || "").trim();
    if (!outboxId) return { accepted: false as const, reason: "missing_outbox_id" as const };

    const queue = await getQueueInstance();
    const delayMs = Math.max(Number(args.delayMs || 0), 0);
    const jobId = getSmsRelayQueueJobId(outboxId);

    try {
        await queue.add(
            "dispatch-sms-relay-outbox",
            { outboxId, queuedAt: new Date().toISOString() },
            { jobId, delay: delayMs, attempts: 1 }
        );
    } catch (error) {
        if (isDuplicateQueueJobError(error)) {
            return { accepted: true as const, jobId };
        }
        throw error;
    }

    return { accepted: true as const, jobId };
}

export async function initSmsRelayOutboxWorker() {
    if (_workerPromise) return _workerPromise;

    _workerPromise = (async () => {
        const { Worker } = await import("bullmq");
        const workerId = `sms-relay:${randomUUID()}`;

        const worker = new Worker<SmsRelayOutboxQueueJobData>(
            QUEUE_NAME,
            async (job: any) => {
                const outboxId = String(job?.data?.outboxId || "").trim();
                if (!outboxId) return;

                const result = await processSmsRelayOutboxJob({ outboxId, workerId });

                // If failed (e.g. device not paired), requeue with delay
                if (result.outcome === "failed" && Number(result.requeueDelayMs || 0) >= 0) {
                    await enqueueSmsRelayOutboxQueueJob({
                        outboxId,
                        delayMs: Number(result.requeueDelayMs || 0),
                    });
                }
            },
            {
                connection: REDIS_CONNECTION,
                concurrency: Math.max(
                    Number(process.env.SMS_RELAY_OUTBOX_WORKER_CONCURRENCY || 2),
                    1
                ),
            }
        );

        worker.on("ready", () => {
            console.log("[Queue] SMS Relay outbox worker is ready.");
        });
        worker.on("failed", (job: any, err: Error) => {
            console.error(
                `[Queue] SMS Relay outbox job failed (${job?.id || "unknown"}): ${err.message}`
            );
        });

        return worker;
    })();

    try {
        return await _workerPromise;
    } catch (error) {
        _workerPromise = null;
        throw error;
    }
}

export async function enqueueDueSmsRelayOutboxJobs(args?: { limit?: number }) {
    const recoveredLocks = await recoverStaleSmsRelayOutboxLocks();
    const dueIds = await listDueSmsRelayOutboxIds(args?.limit || 250);

    let queued = 0;
    let queueErrors = 0;

    for (const outboxId of dueIds) {
        try {
            const result = await enqueueSmsRelayOutboxQueueJob({ outboxId });
            if (result.accepted) queued += 1;
        } catch (error) {
            queueErrors += 1;
            console.error("[Queue] Failed to enqueue SMS relay outbox row:", outboxId, error);
        }
    }

    return { recoveredLocks, dueCount: dueIds.length, queued, queueErrors };
}
