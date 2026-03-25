import {
    ensurePendingMessageTranscript,
    transcribeAttachmentWithGoogle,
    type AudioTranscriptionJobInput,
} from "@/lib/ai/audio/transcription-google";
import { buildQueueJobId, isDuplicateQueueJobError } from "@/lib/queue/job-id";

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
};

const QUEUE_NAME = "whatsapp-audio-transcription";

interface WhatsAppAudioTranscriptionJobData extends AudioTranscriptionJobInput {
    queuedAt: string;
}

export type WhatsAppAudioTranscriptionPriority = "normal" | "high";

export type EnqueueWhatsAppAudioTranscriptionInput = AudioTranscriptionJobInput & {
    priority?: WhatsAppAudioTranscriptionPriority;
    allowInlineFallback?: boolean;
};

export type EnqueueWhatsAppAudioTranscriptionResult = {
    accepted: boolean;
    mode: "queued" | "already-queued" | "inline-fallback" | "skipped" | "queue-unavailable";
    reason?: "already_completed" | "enqueue_failed";
    transcriptId: string;
    jobId?: string;
    error?: string;
};

let _queuePromise: Promise<any> | null = null;
let _workerPromise: Promise<any> | null = null;

async function getQueueInstance() {
    if (!_queuePromise) {
        _queuePromise = (async () => {
            const { Queue } = await import("bullmq");
            return new Queue<WhatsAppAudioTranscriptionJobData>(QUEUE_NAME, {
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

function resolveQueuePriority(priority?: WhatsAppAudioTranscriptionPriority): number {
    return priority === "high" ? 1 : 5;
}

export async function enqueueWhatsAppAudioTranscription(
    input: EnqueueWhatsAppAudioTranscriptionInput
): Promise<EnqueueWhatsAppAudioTranscriptionResult> {
    const prepared = await ensurePendingMessageTranscript(input);
    if (!prepared.shouldEnqueue) {
        return {
            accepted: false as const,
            mode: "skipped" as const,
            reason: "already_completed",
            transcriptId: prepared.transcriptId,
        };
    }

    const jobId = buildQueueJobId("transcript", input.attachmentId);
    const allowInlineFallback = input.allowInlineFallback !== false;

    try {
        const queue = await getQueueInstance();
        const existingJob = await queue.getJob(jobId);
        if (existingJob) {
            return {
                accepted: true as const,
                mode: "already-queued" as const,
                transcriptId: prepared.transcriptId,
                jobId,
            };
        }

        await queue.add(
            "transcribe-audio",
            {
                locationId: input.locationId,
                messageId: input.messageId,
                attachmentId: input.attachmentId,
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
            accepted: true as const,
            mode: "queued" as const,
            transcriptId: prepared.transcriptId,
            jobId,
        };
    } catch (queueError) {
        if (isDuplicateQueueJobError(queueError)) {
            return {
                accepted: true as const,
                mode: "already-queued" as const,
                transcriptId: prepared.transcriptId,
                jobId,
            };
        }

        if (!allowInlineFallback) {
            return {
                accepted: false as const,
                mode: "queue-unavailable" as const,
                reason: "enqueue_failed" as const,
                transcriptId: prepared.transcriptId,
                jobId,
                error: String((queueError as any)?.message || "Failed to enqueue job."),
            };
        }

        console.warn("[Queue] Failed to enqueue audio transcription job. Falling back to inline processing:", queueError);

        void transcribeAttachmentWithGoogle(input).catch((inlineErr) => {
            console.error("[Queue] Inline audio transcription fallback failed:", inlineErr);
        });

        return {
            accepted: true as const,
            mode: "inline-fallback" as const,
            transcriptId: prepared.transcriptId,
            jobId,
        };
    }
}

export async function initWhatsAppAudioTranscriptionWorker() {
    if (_workerPromise) return _workerPromise;

    _workerPromise = (async () => {
        const { Worker } = await import("bullmq");

        const worker = new Worker<WhatsAppAudioTranscriptionJobData>(
            QUEUE_NAME,
            async (job: any) => {
                await transcribeAttachmentWithGoogle({
                    locationId: job.data.locationId,
                    messageId: job.data.messageId,
                    attachmentId: job.data.attachmentId,
                    force: !!job.data.force,
                });
            },
            {
                connection: REDIS_CONNECTION,
                concurrency: 2,
            }
        );

        worker.on("ready", () => {
            console.log("[Queue] WhatsApp audio transcription worker is ready.");
        });

        worker.on("failed", (job: any, err: Error) => {
            console.error(
                `[Queue] Audio transcription job failed (${job?.id || "unknown"}): ${err.message}`
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
