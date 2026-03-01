import {
    ensurePendingMessageTranscript,
    transcribeAttachmentWithGoogle,
    type AudioTranscriptionJobInput,
} from "@/lib/ai/audio/transcription-google";

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
};

const QUEUE_NAME = "whatsapp-audio-transcription";

interface WhatsAppAudioTranscriptionJobData extends AudioTranscriptionJobInput {
    queuedAt: string;
}

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
    return _queuePromise;
}

export async function enqueueWhatsAppAudioTranscription(input: AudioTranscriptionJobInput) {
    const prepared = await ensurePendingMessageTranscript(input);
    if (!prepared.shouldEnqueue) {
        return {
            accepted: false as const,
            mode: "skipped" as const,
            reason: "already_completed",
            transcriptId: prepared.transcriptId,
        };
    }

    try {
        const queue = await getQueueInstance();
        await queue.add(
            "transcribe-audio",
            {
                ...input,
                force: !!input.force,
                queuedAt: new Date().toISOString(),
            },
            {
                attempts: 3,
                backoff: {
                    type: "exponential",
                    delay: 1000,
                },
                jobId: `transcript:${input.attachmentId}`,
            }
        );

        return {
            accepted: true as const,
            mode: "queued" as const,
            transcriptId: prepared.transcriptId,
        };
    } catch (queueError) {
        console.warn("[Queue] Failed to enqueue audio transcription job. Falling back to inline processing:", queueError);

        void transcribeAttachmentWithGoogle(input).catch((inlineErr) => {
            console.error("[Queue] Inline audio transcription fallback failed:", inlineErr);
        });

        return {
            accepted: true as const,
            mode: "inline-fallback" as const,
            transcriptId: prepared.transcriptId,
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

    return _workerPromise;
}
