import db from "@/lib/db";
import { buildQueueJobId, isDuplicateQueueJobError } from "@/lib/queue/job-id";
import { runViewingSessionMessageInsights } from "@/lib/viewings/sessions/analysis";

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
};

const QUEUE_NAME = "viewing-session-insights";

export type EnqueueViewingSessionInsightsInput = {
    sessionId: string;
    messageId: string;
    force?: boolean;
    priority?: "normal" | "high";
    allowInlineFallback?: boolean;
};

export type EnqueueViewingSessionInsightsResult = {
    accepted: boolean;
    mode: "queued" | "already-queued" | "inline-fallback" | "skipped" | "queue-unavailable";
    reason?: "already_completed" | "enqueue_failed";
    jobId?: string;
    error?: string;
};

type ViewingSessionInsightsJobData = {
    sessionId: string;
    messageId: string;
    force: boolean;
    queuedAt: string;
};

let _queuePromise: Promise<any> | null = null;
let _workerPromise: Promise<any> | null = null;

async function getQueueInstance() {
    if (!_queuePromise) {
        _queuePromise = (async () => {
            const { Queue } = await import("bullmq");
            return new Queue<ViewingSessionInsightsJobData>(QUEUE_NAME, {
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

function resolveQueuePriority(priority?: "normal" | "high"): number {
    return priority === "high" ? 1 : 5;
}

export async function enqueueViewingSessionInsights(
    input: EnqueueViewingSessionInsightsInput
): Promise<EnqueueViewingSessionInsightsResult> {
    const sessionId = String(input.sessionId || "").trim();
    const messageId = String(input.messageId || "").trim();
    if (!sessionId || !messageId) {
        return {
            accepted: false,
            mode: "skipped",
            reason: "enqueue_failed",
            error: "Missing sessionId or messageId.",
        };
    }

    const message = await db.viewingSessionMessage.findFirst({
        where: {
            id: messageId,
            sessionId,
        },
        select: {
            id: true,
            insightStatus: true,
        },
    });
    if (!message) {
        return {
            accepted: false,
            mode: "skipped",
            reason: "enqueue_failed",
            error: "Viewing session message not found.",
        };
    }

    if (!input.force && message.insightStatus === "completed") {
        return {
            accepted: false,
            mode: "skipped",
            reason: "already_completed",
        };
    }

    const allowInlineFallback = input.allowInlineFallback !== false;
    const jobId = buildQueueJobId("viewing-session-insights", messageId);

    try {
        const queue = await getQueueInstance();
        const existingJob = await queue.getJob(jobId);
        if (existingJob) {
            return {
                accepted: true,
                mode: "already-queued",
                jobId,
            };
        }

        await queue.add(
            "analyze-viewing-session-message-insights",
            {
                sessionId,
                messageId,
                force: !!input.force,
                queuedAt: new Date().toISOString(),
            },
            {
                attempts: 3,
                backoff: {
                    type: "exponential",
                    delay: 1000,
                },
                priority: resolveQueuePriority(input.priority),
                jobId,
            }
        );

        return {
            accepted: true,
            mode: "queued",
            jobId,
        };
    } catch (queueError: any) {
        if (isDuplicateQueueJobError(queueError)) {
            return {
                accepted: true,
                mode: "already-queued",
                jobId,
            };
        }

        if (!allowInlineFallback) {
            return {
                accepted: false,
                mode: "queue-unavailable",
                reason: "enqueue_failed",
                jobId,
                error: String(queueError?.message || "Failed to enqueue viewing session insights."),
            };
        }

        console.warn("[Queue] Failed to enqueue viewing session insights. Falling back to inline processing:", queueError);
        void runViewingSessionMessageInsights({ sessionId, messageId }).catch((inlineErr) => {
            console.error("[Queue] Inline viewing session insights fallback failed:", inlineErr);
        });

        return {
            accepted: true,
            mode: "inline-fallback",
            jobId,
        };
    }
}

export async function initViewingSessionInsightsWorker() {
    if (_workerPromise) return _workerPromise;

    _workerPromise = (async () => {
        const { Worker } = await import("bullmq");
        const worker = new Worker<ViewingSessionInsightsJobData>(
            QUEUE_NAME,
            async (job: any) => {
                await runViewingSessionMessageInsights({
                    sessionId: job.data.sessionId,
                    messageId: job.data.messageId,
                });
            },
            {
                connection: REDIS_CONNECTION,
                concurrency: 2,
            }
        );

        worker.on("ready", () => {
            console.log("[Queue] Viewing session insights worker is ready.");
        });

        worker.on("failed", (job: any, err: Error) => {
            console.error(`[Queue] Viewing session insights job failed (${job?.id || "unknown"}): ${err.message}`);
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
