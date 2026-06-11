import { randomUUID } from "crypto";
import {
    listActiveContactClassificationRunIds,
    processContactClassificationRun,
    recoverStaleContactClassificationRuns,
} from "@/lib/ai/contact-classification/job";
import { buildQueueJobId, isDuplicateQueueJobError } from "@/lib/queue/job-id";

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
};

const QUEUE_NAME = "contact-classification";

type ContactClassificationJobData = {
    runId: string;
    queuedAt: string;
};

let _queuePromise: Promise<any> | null = null;
let _workerPromise: Promise<any> | null = null;

async function getQueueInstance() {
    if (!_queuePromise) {
        _queuePromise = (async () => {
            const { Queue } = await import("bullmq");
            return new Queue<ContactClassificationJobData>(QUEUE_NAME, {
                connection: REDIS_CONNECTION,
                defaultJobOptions: {
                    removeOnComplete: true,
                    removeOnFail: 200,
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

function getRunQueueJobId(runId: string) {
    return buildQueueJobId("contact-classification", runId);
}

export async function enqueueContactClassificationRun(args: {
    runId: string;
    delayMs?: number;
    dedupe?: boolean;
}) {
    const runId = String(args.runId || "").trim();
    if (!runId) {
        return { accepted: false as const, reason: "missing_run_id" as const };
    }

    const queue = await getQueueInstance();
    const jobId = args.dedupe === false
        ? buildQueueJobId("contact-classification", runId, Date.now(), randomUUID())
        : getRunQueueJobId(runId);

    try {
        await queue.add(
            "process-contact-classification-run",
            {
                runId,
                queuedAt: new Date().toISOString(),
            },
            {
                jobId,
                delay: Math.max(Number(args.delayMs || 0), 0),
                attempts: 1,
            }
        );
    } catch (error) {
        if (isDuplicateQueueJobError(error)) {
            return { accepted: true as const, jobId, duplicate: true as const };
        }
        throw error;
    }

    return { accepted: true as const, jobId };
}

export async function enqueueActiveContactClassificationRuns(args?: {
    limit?: number;
}) {
    const recovered = await recoverStaleContactClassificationRuns();
    const runIds = await listActiveContactClassificationRunIds({ limit: args?.limit || 100 });
    let queued = 0;
    let queueErrors = 0;

    for (const runId of runIds) {
        try {
            const result = await enqueueContactClassificationRun({ runId });
            if (result.accepted) queued += 1;
        } catch (error) {
            queueErrors += 1;
            console.error("[Queue] Failed to enqueue contact classification run:", runId, error);
        }
    }

    return {
        recovered,
        dueCount: runIds.length,
        queued,
        queueErrors,
    };
}

export async function initContactClassificationWorker() {
    if (_workerPromise) return _workerPromise;

    _workerPromise = (async () => {
        const { Worker } = await import("bullmq");
        const workerId = `contact-classification:${randomUUID()}`;

        const worker = new Worker<ContactClassificationJobData>(
            QUEUE_NAME,
            async (job: any) => {
                const runId = String(job?.data?.runId || "").trim();
                if (!runId) return;
                const result = await processContactClassificationRun({
                    runId,
                    workerId,
                    maxContacts: Number(process.env.CONTACT_CLASSIFICATION_JOB_CONTACT_LIMIT || 250),
                });
                if (result.outcome === "processed_limit") {
                    await enqueueContactClassificationRun({ runId, delayMs: 1000, dedupe: false });
                }
                console.info("[Queue] Contact classification run processed", {
                    runId,
                    workerId,
                    outcome: result.outcome,
                    processed: result.processed,
                });
            },
            {
                connection: REDIS_CONNECTION,
                concurrency: Math.max(Number(process.env.CONTACT_CLASSIFICATION_WORKER_CONCURRENCY || 1), 1),
            }
        );

        worker.on("ready", () => {
            console.log("[Queue] Contact classification worker is ready.");
        });

        worker.on("failed", (job: any, err: Error) => {
            console.error(`[Queue] Contact classification job failed (${job?.id || "unknown"}): ${err.message}`);
        });

        await enqueueActiveContactClassificationRuns().catch((error) => {
            console.error("[Queue] Failed to enqueue active contact classification runs on startup:", error);
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
