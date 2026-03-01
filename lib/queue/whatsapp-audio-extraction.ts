import {
    ensurePendingTranscriptExtraction,
    extractViewingNotesWithGoogle,
    type WhatsAppViewingNotesExtractionInput,
} from "@/lib/ai/audio/viewing-notes-extraction-google";

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
};

const QUEUE_NAME = "whatsapp-audio-extraction";

interface WhatsAppAudioExtractionJobData extends WhatsAppViewingNotesExtractionInput {
    queuedAt: string;
}

export type WhatsAppAudioExtractionPriority = "normal" | "high";

export type EnqueueWhatsAppAudioExtractionInput = WhatsAppViewingNotesExtractionInput & {
    priority?: WhatsAppAudioExtractionPriority;
    allowInlineFallback?: boolean;
};

export type EnqueueWhatsAppAudioExtractionResult = {
    accepted: boolean;
    mode: "queued" | "already-queued" | "inline-fallback" | "skipped" | "queue-unavailable";
    reason?: "already_completed" | "already_in_progress" | "enqueue_failed";
    extractionId: string;
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
            return new Queue<WhatsAppAudioExtractionJobData>(QUEUE_NAME, {
                connection: REDIS_CONNECTION,
                defaultJobOptions: {
                    removeOnComplete: true,
                    removeOnFail: 200,
                },
            });
        })();
    }
    return _queuePromise;
}

function resolveQueuePriority(priority?: WhatsAppAudioExtractionPriority): number {
    return priority === "high" ? 1 : 5;
}

function isDuplicateQueueJobError(error: unknown): boolean {
    const message = String((error as any)?.message || "").toLowerCase();
    if (!message) return false;
    return message.includes("job") && message.includes("already") && message.includes("exist");
}

export async function enqueueWhatsAppAudioExtraction(
    input: EnqueueWhatsAppAudioExtractionInput
): Promise<EnqueueWhatsAppAudioExtractionResult> {
    const prepared = await ensurePendingTranscriptExtraction(input);
    if (!prepared.shouldEnqueue) {
        if (prepared.reason === "already_in_progress") {
            return {
                accepted: true as const,
                mode: "already-queued" as const,
                reason: "already_in_progress" as const,
                extractionId: prepared.extractionId,
                transcriptId: prepared.transcriptId,
                jobId: `extract:${prepared.extractionId}`,
            };
        }

        return {
            accepted: false as const,
            mode: "skipped" as const,
            reason: "already_completed" as const,
            extractionId: prepared.extractionId,
            transcriptId: prepared.transcriptId,
            jobId: `extract:${prepared.extractionId}`,
        };
    }

    const jobId = `extract:${prepared.extractionId}`;
    const allowInlineFallback = input.allowInlineFallback !== false;

    try {
        const queue = await getQueueInstance();
        const existingJob = await queue.getJob(jobId);
        if (existingJob) {
            return {
                accepted: true as const,
                mode: "already-queued" as const,
                reason: "already_in_progress" as const,
                extractionId: prepared.extractionId,
                transcriptId: prepared.transcriptId,
                jobId,
            };
        }

        await queue.add(
            "extract-viewing-notes",
            {
                locationId: input.locationId,
                messageId: input.messageId,
                attachmentId: input.attachmentId,
                extractionId: prepared.extractionId,
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
            extractionId: prepared.extractionId,
            transcriptId: prepared.transcriptId,
            jobId,
        };
    } catch (queueError) {
        if (isDuplicateQueueJobError(queueError)) {
            return {
                accepted: true as const,
                mode: "already-queued" as const,
                reason: "already_in_progress" as const,
                extractionId: prepared.extractionId,
                transcriptId: prepared.transcriptId,
                jobId,
            };
        }

        if (!allowInlineFallback) {
            return {
                accepted: false as const,
                mode: "queue-unavailable" as const,
                reason: "enqueue_failed" as const,
                extractionId: prepared.extractionId,
                transcriptId: prepared.transcriptId,
                jobId,
                error: String((queueError as any)?.message || "Failed to enqueue extraction job."),
            };
        }

        console.warn("[Queue] Failed to enqueue audio extraction job. Falling back to inline processing:", queueError);

        void extractViewingNotesWithGoogle({
            locationId: input.locationId,
            messageId: input.messageId,
            attachmentId: input.attachmentId,
            extractionId: prepared.extractionId,
            force: !!input.force,
        }).catch((inlineErr) => {
            console.error("[Queue] Inline audio extraction fallback failed:", inlineErr);
        });

        return {
            accepted: true as const,
            mode: "inline-fallback" as const,
            extractionId: prepared.extractionId,
            transcriptId: prepared.transcriptId,
            jobId,
        };
    }
}

export async function initWhatsAppAudioExtractionWorker() {
    if (_workerPromise) return _workerPromise;

    _workerPromise = (async () => {
        const { Worker } = await import("bullmq");

        const worker = new Worker<WhatsAppAudioExtractionJobData>(
            QUEUE_NAME,
            async (job: any) => {
                await extractViewingNotesWithGoogle({
                    locationId: job.data.locationId,
                    messageId: job.data.messageId,
                    attachmentId: job.data.attachmentId,
                    extractionId: job.data.extractionId,
                    force: !!job.data.force,
                });
            },
            {
                connection: REDIS_CONNECTION,
                concurrency: 2,
            }
        );

        worker.on("ready", () => {
            console.log("[Queue] WhatsApp audio extraction worker is ready.");
        });

        worker.on("failed", (job: any, err: Error) => {
            console.error(
                `[Queue] Audio extraction job failed (${job?.id || "unknown"}): ${err.message}`
            );
        });

        return worker;
    })();

    return _workerPromise;
}
