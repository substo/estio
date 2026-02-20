import type { NormalizedMessage } from "@/lib/whatsapp/sync";

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
};

const QUEUE_NAME = 'whatsapp-lid-resolve';
const LID_RETRY_INTERVAL_MS = Number(process.env.WHATSAPP_LID_RETRY_INTERVAL_MS || 30000);
const LID_RETRY_MAX_ATTEMPTS = Number(process.env.WHATSAPP_LID_MAX_ATTEMPTS || 240);

type DeferredLidMessagePayload = Omit<NormalizedMessage, 'timestamp'> & {
    timestamp: string;
};

interface DeferredLidJobData {
    lidJid: string;
    msg: DeferredLidMessagePayload;
}

let _queuePromise: Promise<any> | null = null;
let _workerPromise: Promise<any> | null = null;

function toPayload(msg: NormalizedMessage, lidJid: string): DeferredLidMessagePayload {
    const timestamp = msg.timestamp instanceof Date
        ? msg.timestamp.toISOString()
        : new Date(msg.timestamp).toISOString();

    return {
        ...msg,
        lid: msg.lid || lidJid,
        timestamp,
        __skipUnresolvedLidDeferral: undefined,
        __deferredAttempt: undefined,
    };
}

function toNormalizedMessage(payload: DeferredLidMessagePayload, lidJid: string): NormalizedMessage {
    const date = new Date(payload.timestamp);
    const timestamp = Number.isNaN(date.getTime()) ? new Date() : date;

    return {
        ...payload,
        lid: payload.lid || lidJid,
        timestamp,
    };
}

async function getQueueInstance() {
    if (!_queuePromise) {
        _queuePromise = (async () => {
            const { Queue } = await import('bullmq');
            return new Queue<DeferredLidJobData>(QUEUE_NAME, {
                connection: REDIS_CONNECTION,
                defaultJobOptions: {
                    removeOnComplete: true,
                    removeOnFail: 500,
                },
            });
        })();
    }
    return _queuePromise;
}

export async function enqueueDeferredLidMessage(msg: NormalizedMessage, lidJid: string) {
    const queue = await getQueueInstance();
    const jobId = `${msg.locationId}:${msg.wamId}`;

    await queue.add(
        'resolve-lid-message',
        {
            lidJid,
            msg: toPayload(msg, lidJid),
        },
        {
            jobId,
            delay: LID_RETRY_INTERVAL_MS,
            attempts: LID_RETRY_MAX_ATTEMPTS,
            backoff: {
                type: 'fixed',
                delay: LID_RETRY_INTERVAL_MS,
            },
        }
    );
}

export async function initWhatsAppLidResolveWorker() {
    if (_workerPromise) return _workerPromise;

    _workerPromise = (async () => {
        const { Worker } = await import('bullmq');

        const worker = new Worker<DeferredLidJobData>(
            QUEUE_NAME,
            async (job: any) => {
                const normalized = toNormalizedMessage(job.data.msg, job.data.lidJid);
                const { processNormalizedMessage } = await import('@/lib/whatsapp/sync');

                const result = await processNormalizedMessage({
                    ...normalized,
                    __skipUnresolvedLidDeferral: true,
                    __deferredAttempt: (job.attemptsMade || 0) + 1,
                });

                if (result?.status === 'deferred_unresolved_lid') {
                    throw new Error('LID_UNRESOLVED');
                }
            },
            {
                connection: REDIS_CONNECTION,
                concurrency: 1,
            }
        );

        worker.on('ready', () => {
            console.log('[Queue] WhatsApp LID Resolve Worker is ready.');
        });

        worker.on('failed', (job: any, err: Error) => {
            const attempts = Number(job?.opts?.attempts || 1);
            const attemptsMade = Number(job?.attemptsMade || 0);
            const exhausted = attemptsMade >= attempts;

            if (exhausted) {
                console.warn(
                    `[Queue] Deferred LID resolution exhausted retries for job ${job?.id} (wamId: ${job?.data?.msg?.wamId}).`
                );
            } else {
                console.warn(
                    `[Queue] Deferred LID resolution retry ${attemptsMade}/${attempts} failed for job ${job?.id}: ${err.message}`
                );
            }
        });

        return worker;
    })();

    return _workerPromise;
}

