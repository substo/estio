import { buildQueueJobId, isDuplicateQueueJobError } from "@/lib/queue/job-id";
import { upsertViewingSessionSummaryFromInsights } from "@/lib/viewings/sessions/summary";

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
};

const QUEUE_NAME = "viewing-session-synthesis";
const DRAFT_DEBOUNCE_MS = 4_000;

export type EnqueueViewingSessionSynthesisInput = {
    sessionId: string;
    status?: "draft" | "final";
    actorUserId?: string | null;
    trigger?: "manual" | "debounced_worker" | "completion";
    allowInlineFallback?: boolean;
};

export type EnqueueViewingSessionSynthesisResult = {
    accepted: boolean;
    mode: "queued" | "already-queued" | "inline-fallback" | "queue-unavailable" | "skipped";
    jobId?: string;
    error?: string;
};

type ViewingSessionSynthesisJobData = {
    sessionId: string;
    status: "draft" | "final";
    actorUserId: string | null;
    trigger: "manual" | "debounced_worker" | "completion";
    queuedAt: string;
};

let _queuePromise: Promise<any> | null = null;
let _workerPromise: Promise<any> | null = null;

async function getQueueInstance() {
    if (!_queuePromise) {
        _queuePromise = (async () => {
            const { Queue } = await import("bullmq");
            return new Queue<ViewingSessionSynthesisJobData>(QUEUE_NAME, {
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

export async function runViewingSessionSynthesis(input: {
    sessionId: string;
    status?: "draft" | "final";
    actorUserId?: string | null;
    trigger?: "manual" | "debounced_worker" | "completion";
}) {
    const sessionId = String(input.sessionId || "").trim();
    if (!sessionId) {
        throw new Error("Missing sessionId.");
    }
    const status = input.status === "final" ? "final" : "draft";
    const trigger = input.trigger || (status === "final" ? "completion" : "debounced_worker");
    return upsertViewingSessionSummaryFromInsights({
        sessionId,
        status,
        actorUserId: input.actorUserId || null,
        trigger,
    });
}

export async function enqueueViewingSessionSynthesis(
    input: EnqueueViewingSessionSynthesisInput
): Promise<EnqueueViewingSessionSynthesisResult> {
    const sessionId = String(input.sessionId || "").trim();
    if (!sessionId) {
        return {
            accepted: false,
            mode: "skipped",
            error: "Missing sessionId.",
        };
    }

    const status = input.status === "final" ? "final" : "draft";
    const trigger = input.trigger || (status === "final" ? "completion" : "debounced_worker");
    const allowInlineFallback = input.allowInlineFallback !== false;
    const queueKey = `${sessionId}:${status}`;
    const jobId = buildQueueJobId("viewing-session-synthesis", queueKey);
    const delay = status === "draft" ? DRAFT_DEBOUNCE_MS : 0;

    try {
        const queue = await getQueueInstance();
        const existingJob = await queue.getJob(jobId);
        if (existingJob) {
            if (delay > 0) {
                await existingJob.remove().catch(() => undefined);
            } else {
                return {
                    accepted: true,
                    mode: "already-queued",
                    jobId,
                };
            }
        }

        await queue.add(
            "build-viewing-session-summary",
            {
                sessionId,
                status,
                actorUserId: input.actorUserId || null,
                trigger,
                queuedAt: new Date().toISOString(),
            },
            {
                attempts: 2,
                backoff: {
                    type: "exponential",
                    delay: 1000,
                },
                delay,
                priority: status === "final" ? 1 : 6,
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
                jobId,
                error: String(queueError?.message || "Failed to enqueue viewing session synthesis."),
            };
        }

        console.warn("[Queue] Failed to enqueue viewing session synthesis. Falling back to inline processing:", queueError);
        void runViewingSessionSynthesis({
            sessionId,
            status,
            actorUserId: input.actorUserId || null,
            trigger,
        }).catch((inlineError) => {
            console.error("[Queue] Inline viewing session synthesis fallback failed:", inlineError);
        });

        return {
            accepted: true,
            mode: "inline-fallback",
            jobId,
        };
    }
}

export async function initViewingSessionSynthesisWorker() {
    if (_workerPromise) return _workerPromise;

    _workerPromise = (async () => {
        const { Worker } = await import("bullmq");
        const worker = new Worker<ViewingSessionSynthesisJobData>(
            QUEUE_NAME,
            async (job: any) => {
                await runViewingSessionSynthesis({
                    sessionId: job.data.sessionId,
                    status: job.data.status,
                    actorUserId: job.data.actorUserId,
                    trigger: job.data.trigger,
                });
            },
            {
                connection: REDIS_CONNECTION,
                concurrency: 1,
            }
        );

        worker.on("ready", () => {
            console.log("[Queue] Viewing session synthesis worker is ready.");
        });

        worker.on("failed", (job: any, err: Error) => {
            console.error(`[Queue] Viewing session synthesis job failed (${job?.id || "unknown"}): ${err.message}`);
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
