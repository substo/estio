import { Queue, Worker, Job } from 'bullmq';
import db from '@/lib/db';

const REDIS_CONNECTION = {
    host: '127.0.0.1',
    port: 6379,
};

const QUEUE_NAME = 'ghl-sync';

// Define the Job Data Interface
interface GhlSyncJobData {
    contactId: string; // The remote GHL Contact ID
    body: string;
    type: string;
    conversationProviderId?: string;
    direction?: 'inbound' | 'outbound';
    accessToken: string;
    wamId: string; // For logging
}

// 1. Queue Instance (Producer)
export const ghlSyncQueue = new Queue<GhlSyncJobData>(QUEUE_NAME, {
    connection: REDIS_CONNECTION,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: true, // Keep memory clean
        removeOnFail: 100, // Keep last 100 failed jobs for debugging
    },
});

// 2. Worker Instance (Consumer)
// Note: In Next.js serverless environment, workers need careful instantiation.
// We will instantiate this in a singleton pattern or keeping it running.
// If this file is imported by the API route that receives webhooks, the worker *might* start.
// But for reliability, this should be run in a separate process or via instrumentation.
// For now, we will lazy-load the worker to ensure it runs when the app interacts with it.

let worker: Worker<GhlSyncJobData> | null = null;

export function initGhlSyncWorker() {
    if (worker) return;

    console.log('[Queue] Initializing GHL Sync Worker...');

    worker = new Worker<GhlSyncJobData>(QUEUE_NAME, async (job: Job<GhlSyncJobData>) => {
        const { contactId, body, type, conversationProviderId, accessToken, wamId } = job.data;
        console.log(`[Queue] Processing GHL Sync for message ${wamId} (Job ${job.id})`);

        try {
            // Dynamic import to avoid circular deps if any
            const { sendMessage } = await import("@/lib/ghl/conversations");

            const ghlPayload: any = {
                contactId: contactId,
                type: type,
                message: body,
            };

            if (conversationProviderId) {
                ghlPayload.conversationProviderId = conversationProviderId;
            }

            await sendMessage(accessToken, ghlPayload);
            console.log(`[Queue] Successfully synced message ${wamId} to GHL.`);

        } catch (error: any) {
            console.error(`[Queue] Failed to sync message ${wamId}:`, error.message);
            throw error; // Triggers retry
        }

    }, {
        connection: REDIS_CONNECTION,
        concurrency: 1, // Process 1 job at a time per worker instance
        limiter: {
            max: 5, // Max 5 jobs
            duration: 1000, // Per 1000ms (1 second)
        },
    });

    worker.on('failed', (job: Job<GhlSyncJobData> | undefined, err: Error) => {
        console.error(`[Queue] Job ${job?.id} failed: ${err.message}`);
    });
}
