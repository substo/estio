import { randomUUID } from "crypto";
import {
    listDueWhatsAppOutboundOutboxIds,
    processWhatsAppOutboundOutboxJob,
    recoverStaleWhatsAppOutboundOutboxLocks,
} from "@/lib/whatsapp/outbound-outbox";
import { buildQueueJobId, isDuplicateQueueJobError } from "@/lib/queue/job-id";

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
};

const QUEUE_NAME = "whatsapp-outbound";

type WhatsAppOutboundQueueJobData = {
    outboxId: string;
    queuedAt: string;
};

let _queuePromise: Promise<any> | null = null;
let _workerPromise: Promise<any> | null = null;

async function getQueueInstance() {
    if (!_queuePromise) {
        _queuePromise = (async () => {
            const { Queue } = await import("bullmq");
            return new Queue<WhatsAppOutboundQueueJobData>(QUEUE_NAME, {
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

function getOutboxQueueJobId(outboxId: string): string {
    return buildQueueJobId("outbox", outboxId);
}

export async function enqueueWhatsAppOutboundOutboxJob(args: {
    outboxId: string;
    delayMs?: number;
}) {
    const outboxId = String(args.outboxId || "").trim();
    if (!outboxId) {
        return { accepted: false as const, reason: "missing_outbox_id" as const };
    }

    const queue = await getQueueInstance();
    const delayMs = Math.max(Number(args.delayMs || 0), 0);
    const jobId = getOutboxQueueJobId(outboxId);

    try {
        await queue.add(
            "dispatch-whatsapp-outbound",
            {
                outboxId,
                queuedAt: new Date().toISOString(),
            },
            {
                jobId,
                delay: delayMs,
                attempts: 1,
            }
        );
    } catch (error) {
        if (isDuplicateQueueJobError(error)) {
            return { accepted: true as const, jobId };
        }
        throw error;
    }

    return { accepted: true as const, jobId };
}

export async function initWhatsAppOutboundWorker() {
    if (_workerPromise) return _workerPromise;

    _workerPromise = (async () => {
        const { Worker } = await import("bullmq");
        const workerId = `wa-outbound:${randomUUID()}`;

        const worker = new Worker<WhatsAppOutboundQueueJobData>(
            QUEUE_NAME,
            async (job: any) => {
                const outboxId = String(job?.data?.outboxId || "").trim();
                if (!outboxId) return;

                const result = await processWhatsAppOutboundOutboxJob({
                    outboxId,
                    workerId,
                });

                if (result.outcome === "failed" && Number(result.requeueDelayMs || 0) >= 0) {
                    await enqueueWhatsAppOutboundOutboxJob({
                        outboxId,
                        delayMs: Number(result.requeueDelayMs || 0),
                    });
                }
            },
            {
                connection: REDIS_CONNECTION,
                concurrency: Math.max(Number(process.env.WHATSAPP_OUTBOUND_WORKER_CONCURRENCY || 2), 1),
            }
        );

        worker.on("ready", () => {
            console.log("[Queue] WhatsApp outbound worker is ready.");
        });

        worker.on("failed", (job: any, err: Error) => {
            console.error(`[Queue] WhatsApp outbound job failed (${job?.id || "unknown"}): ${err.message}`);
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

export async function enqueueDueWhatsAppOutboundOutboxJobs(args?: { limit?: number }) {
    const recoveredLocks = await recoverStaleWhatsAppOutboundOutboxLocks();
    const dueIds = await listDueWhatsAppOutboundOutboxIds(args?.limit || 250);
    let queued = 0;
    let queueErrors = 0;

    for (const outboxId of dueIds) {
        try {
            const result = await enqueueWhatsAppOutboundOutboxJob({ outboxId });
            if (result.accepted) queued += 1;
        } catch (error) {
            queueErrors += 1;
            console.error("[Queue] Failed to enqueue WhatsApp outbound outbox row:", outboxId, error);
        }
    }

    return {
        recoveredLocks,
        dueCount: dueIds.length,
        queued,
        queueErrors,
    };
}
