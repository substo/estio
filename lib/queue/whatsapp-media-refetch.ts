import { randomUUID } from "crypto";
import { buildQueueJobId, isDuplicateQueueJobError } from "@/lib/queue/job-id";
import {
    processWhatsAppWebBridgeMediaRefetchAttempt,
    type WhatsAppWebBridgeMediaRefetchJob,
} from "@/lib/whatsapp/web-bridge-media-refetch";

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
};

const QUEUE_NAME = "whatsapp-media-refetch";

type WhatsAppMediaRefetchJobData = WhatsAppWebBridgeMediaRefetchJob & {
    queuedAt: string;
};

let _queuePromise: Promise<any> | null = null;
let _workerPromise: Promise<any> | null = null;

async function getQueueInstance() {
    if (!_queuePromise) {
        _queuePromise = (async () => {
            const { Queue } = await import("bullmq");
            return new Queue<WhatsAppMediaRefetchJobData>(QUEUE_NAME, {
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

export function getWhatsAppMediaRefetchQueueJobId(attemptId: string) {
    return buildQueueJobId("whatsapp-media-refetch", attemptId);
}

export async function enqueueWhatsAppMediaRefetchJob(input: WhatsAppWebBridgeMediaRefetchJob) {
    const attemptId = String(input.attemptId || "").trim();
    if (!attemptId) return { accepted: false as const, reason: "missing_attempt_id" as const };

    const queue = await getQueueInstance();
    const jobId = getWhatsAppMediaRefetchQueueJobId(attemptId);

    try {
        await queue.add(
            "refetch-whatsapp-media",
            {
                ...input,
                queuedAt: new Date().toISOString(),
            },
            {
                attempts: 2,
                backoff: {
                    type: "exponential",
                    delay: 1500,
                },
                jobId,
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

export async function initWhatsAppMediaRefetchWorker() {
    if (_workerPromise) return _workerPromise;

    _workerPromise = (async () => {
        const { Worker } = await import("bullmq");
        const workerId = `whatsapp-media-refetch:${randomUUID()}`;
        const worker = new Worker<WhatsAppMediaRefetchJobData>(
            QUEUE_NAME,
            async (job: any) => {
                await processWhatsAppWebBridgeMediaRefetchAttempt(job.data);
            },
            {
                connection: REDIS_CONNECTION,
                concurrency: Math.max(Number(process.env.WHATSAPP_MEDIA_REFETCH_WORKER_CONCURRENCY || 2), 1),
            }
        );

        worker.on("ready", () => {
            console.log(`[Queue] WhatsApp media refetch worker is ready (${workerId}).`);
        });
        worker.on("failed", (job: any, err: Error) => {
            console.error(`[Queue] WhatsApp media refetch job failed (${job?.id || "unknown"}): ${err.message}`);
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
