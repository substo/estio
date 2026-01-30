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

// 1. Queue Instance (Producer) - Lazy Loaded via Dynamic Import
// We use a factory function to avoid bundling bullmq at compile time
let _queuePromise: Promise<any> | null = null;

async function getQueueInstance() {
    if (!_queuePromise) {
        _queuePromise = (async () => {
            const { Queue } = await import('bullmq');
            return new Queue<GhlSyncJobData>(QUEUE_NAME, {
                connection: REDIS_CONNECTION,
                defaultJobOptions: {
                    attempts: 3,
                    backoff: {
                        type: 'exponential',
                        delay: 1000,
                    },
                    removeOnComplete: true,
                    removeOnFail: 100,
                },
            });
        })();
    }
    return _queuePromise;
}

// Legacy export for compatibility
export const ghlSyncQueue = {
    add: async (...args: any[]) => {
        const queue = await getQueueInstance();
        return queue.add(...args);
    }
};

// 2. Worker Instance (Consumer)
let worker: any | null = null;

export async function initGhlSyncWorker() {
    if (worker) return;

    console.log('[Queue] Initializing GHL Sync Worker...');

    const { Worker, Job } = await import('bullmq');

    worker = new Worker<GhlSyncJobData>(QUEUE_NAME, async (job: any) => {
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
        concurrency: 1,
        limiter: {
            max: 5,
            duration: 1000,
        },
    });

    worker.on('failed', (job: any, err: Error) => {
        console.error(`[Queue] Job ${job?.id} failed: ${err.message}`);
    });
}

