import db from '@/lib/db';
import { buildQueueJobId, isDuplicateQueueJobError } from '@/lib/queue/job-id';

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
};

const QUEUE_NAME = 'legacy-crm-lead-email';

interface LegacyCrmLeadEmailJobData {
    locationId: string;
    messageId: string;
    force?: boolean;
    triggerSource?: string;
}

let _queuePromise: Promise<any> | null = null;
let _workerPromise: Promise<any> | null = null;

async function getQueueInstance() {
    if (!_queuePromise) {
        _queuePromise = (async () => {
            const { Queue } = await import('bullmq');
            return new Queue<LegacyCrmLeadEmailJobData>(QUEUE_NAME, {
                connection: REDIS_CONNECTION,
                defaultJobOptions: {
                    attempts: 4,
                    backoff: {
                        type: 'exponential',
                        delay: 2000,
                    },
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

export async function initLegacyCrmLeadEmailWorker() {
    if (_workerPromise) return _workerPromise;

    _workerPromise = (async () => {
        const { Worker } = await import('bullmq');

        const worker = new Worker<LegacyCrmLeadEmailJobData>(
            QUEUE_NAME,
            async (job: any) => {
                const { processLegacyCrmLeadEmailForLocation } = await import('@/app/(main)/admin/conversations/actions');

                const result = await processLegacyCrmLeadEmailForLocation({
                    locationId: job.data.locationId,
                    messageId: job.data.messageId,
                    force: !!job.data.force,
                    runAutoDraftFromSettings: true,
                    triggerSource: job.data.triggerSource || 'queue_auto_process',
                });

                if (!result?.success && !result?.skipped) {
                    throw new Error(result?.error || 'Legacy CRM lead email processing failed');
                }

                return result;
            },
            {
                connection: REDIS_CONNECTION,
                concurrency: 2,
            }
        );

        worker.on('ready', () => {
            console.log('[Queue] Legacy CRM lead email worker is ready.');
        });

        worker.on('failed', (job: any, err: Error) => {
            console.error(`[Queue] Legacy CRM lead email job ${job?.id} failed: ${err.message}`);
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

export async function enqueueLegacyCrmLeadEmailProcessing(data: LegacyCrmLeadEmailJobData) {
    const jobId = buildQueueJobId("legacy_crm_email", data.locationId, data.messageId);

    try {
        await initLegacyCrmLeadEmailWorker();
        const queue = await getQueueInstance();
        try {
            return await queue.add(
                'process-legacy-crm-lead-email',
                data,
                {
                    jobId,
                }
            );
        } catch (queueAddError) {
            if (isDuplicateQueueJobError(queueAddError)) {
                return { alreadyQueued: true, jobId };
            }
            throw queueAddError;
        }
    } catch (queueError) {
        console.warn('[Queue] Failed to enqueue legacy CRM lead email job, falling back to inline processing:', queueError);

        try {
            const { processLegacyCrmLeadEmailForLocation } = await import('@/app/(main)/admin/conversations/actions');
            const result = await processLegacyCrmLeadEmailForLocation({
                locationId: data.locationId,
                messageId: data.messageId,
                force: !!data.force,
                runAutoDraftFromSettings: true,
                triggerSource: `${data.triggerSource || 'auto_process'}:inline_fallback`,
            });
            return { fallbackInline: true, result };
        } catch (inlineError) {
            console.error('[Queue] Inline fallback legacy CRM lead email processing failed:', inlineError);
            throw inlineError;
        }
    }
}

export async function enqueueLegacyCrmLeadEmailAutoProcessForMessage(
    messageId: string,
    options?: { force?: boolean; triggerSource?: string }
) {
    if (!messageId || messageId.trim().length < 3) {
        return { queued: false, reason: 'Invalid messageId' };
    }

    const message = await db.message.findUnique({
        where: { id: messageId },
        select: {
            id: true,
            type: true,
            source: true,
            legacyCrmLeadEmailProcessing: {
                select: { status: true }
            },
            conversation: {
                select: {
                    locationId: true,
                }
            }
        }
    });

    if (!message) {
        return { queued: false, reason: 'Message not found' };
    }

    if (!String(message.type || '').toUpperCase().includes('EMAIL')) {
        return { queued: false, reason: 'Not an email message' };
    }

    if (
        (message.legacyCrmLeadEmailProcessing?.status === 'processed' ||
            message.legacyCrmLeadEmailProcessing?.status === 'processing') &&
        !options?.force
    ) {
        return { queued: false, reason: 'Already processing/processed' };
    }

    const locationId = message.conversation?.locationId;
    if (!locationId) {
        return { queued: false, reason: 'Conversation location missing' };
    }

    const location = await db.location.findUnique({
        where: { id: locationId },
        select: {
            legacyCrmLeadEmailEnabled: true,
            legacyCrmLeadEmailAutoProcess: true,
        } as any
    });

    if (!(location as any)?.legacyCrmLeadEmailEnabled) {
        return { queued: false, reason: 'Legacy CRM lead email detection disabled' };
    }

    if (!(location as any)?.legacyCrmLeadEmailAutoProcess) {
        return { queued: false, reason: 'Legacy CRM lead email auto-process disabled' };
    }

    await enqueueLegacyCrmLeadEmailProcessing({
        locationId,
        messageId: message.id,
        force: !!options?.force,
        triggerSource: options?.triggerSource || 'auto_process',
    });

    return { queued: true };
}
