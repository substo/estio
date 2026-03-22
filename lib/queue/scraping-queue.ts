import os from 'os';
import db from '@/lib/db';
import { isDeepScrapeInFlightStatus, type DeepScrapeConfigSnapshot } from '@/lib/scraping/deep-scrape-types';

const REDIS_CONNECTION = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
};

const QUEUE_NAME = 'scraping-queue';
const WORKER_HEARTBEAT_KEY_PREFIX = 'scraping-worker:heartbeat:instance:';
const WORKER_HEARTBEAT_INTERVAL_MS = 15_000;
const WORKER_HEARTBEAT_TTL_SECONDS = 90;
const WORKER_HEARTBEAT_STALE_SECONDS = 60;
const MAX_FAILED_JOB_DIAGNOSTICS = 10;

type RedisClient = {
    set: (...args: any[]) => Promise<unknown>;
    scan: (...args: any[]) => Promise<[string, string[]]>;
    mget: (...args: string[]) => Promise<(string | null)[]>;
    on: (event: string, callback: (...args: any[]) => void) => void;
};

interface WorkerHeartbeatPayload {
    instanceId: string;
    role: string;
    pid: number;
    hostname: string;
    startedAt: string;
    updatedAt: string;
}

function isScrapeWorkerRole(role: string | null | undefined): boolean {
    return role === 'scrape-worker' || role === 'all';
}

interface ActiveDeepRunContext {
    runId: string;
    locationId: string;
    queueJobId: string;
}

export interface ScrapingJobData {
    taskId?: string; // Optional for deep scrapes
    runId?: string;
    locationId: string;
    pageLimit?: number;
    type?: 'index_scrape' | 'deep_scrape';
    limit?: number;
    deepScrapeConfig?: Partial<DeepScrapeConfigSnapshot>;
    triggeredBy?: 'manual' | 'scheduled' | 'system';
    triggeredByUserId?: string;
    queuedAt?: string;
}

export interface ScrapingQueueDiagnostics {
    generatedAt: string;
    workerAlive: boolean;
    workerReady: boolean;
    workerHeartbeatAgeSeconds: number | null;
    activeWorkers: Array<{
        instanceId: string;
        role: string;
        pid: number | null;
        hostname: string | null;
        startedAt: string | null;
        updatedAt: string;
    }>;
    queueDepth: {
        waiting: number;
        active: number;
        delayed: number;
        paused: number;
        failed: number;
        completed: number;
    };
    recentFailedJobs: Array<{
        id: string;
        name: string;
        failedReason: string | null;
        finishedOn: string | null;
        attemptsMade: number;
    }>;
}

export interface ScrapingQueueCancellationResult {
    jobId: string | null;
    found: boolean;
    state: string | null;
    removed: boolean;
    note: string | null;
}

// 1. Queue Instance (Producer) - Lazy Loaded via Dynamic Import
let _queuePromise: Promise<any> | null = null;
let _redisPromise: Promise<RedisClient> | null = null;

// 2. Worker Instance (Consumer)
let worker: any | null = null;
let workerHeartbeatInterval: ReturnType<typeof setInterval> | null = null;
let signalHandlersBound = false;
let activeDeepRunContext: ActiveDeepRunContext | null = null;

const workerStartedAt = new Date().toISOString();
const workerInstanceId = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;

async function getQueueInstance() {
    if (!_queuePromise) {
        _queuePromise = (async () => {
            const { Queue } = await import('bullmq');
            return new Queue<ScrapingJobData>(QUEUE_NAME, {
                connection: REDIS_CONNECTION,
                defaultJobOptions: {
                    attempts: 1, // Don't retry scrapes immediately to avoid bans
                    removeOnComplete: true,
                    removeOnFail: 100, // Keep some history of failed jobs
                },
            });
        })();
    }
    return _queuePromise;
}

async function getRedisClient(): Promise<RedisClient> {
    if (!_redisPromise) {
        _redisPromise = (async () => {
            const Redis = (await import('ioredis')).default;
            const client = new Redis(REDIS_CONNECTION);
            client.on('error', (error: unknown) => {
                console.error('[Scraping] ❌ Redis client error:', String((error as any)?.message || error));
            });
            return client as unknown as RedisClient;
        })();
    }
    return _redisPromise;
}

function buildWorkerHeartbeatPayload(): WorkerHeartbeatPayload {
    return {
        instanceId: workerInstanceId,
        role: process.env.PROCESS_ROLE || (process.env.NODE_ENV === 'production' ? 'web' : 'all'),
        pid: process.pid,
        hostname: os.hostname(),
        startedAt: workerStartedAt,
        updatedAt: new Date().toISOString(),
    };
}

async function publishWorkerHeartbeat() {
    const redis = await getRedisClient();
    const key = `${WORKER_HEARTBEAT_KEY_PREFIX}${workerInstanceId}`;
    const payload = buildWorkerHeartbeatPayload();
    await redis.set(key, JSON.stringify(payload), 'EX', WORKER_HEARTBEAT_TTL_SECONDS);
}

async function listWorkerHeartbeats() {
    const redis = await getRedisClient();
    const pattern = `${WORKER_HEARTBEAT_KEY_PREFIX}*`;
    const keys: string[] = [];
    let cursor = '0';

    do {
        const [nextCursor, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (batch.length > 0) {
            keys.push(...batch);
        }
    } while (cursor !== '0');

    if (keys.length === 0) return [] as WorkerHeartbeatPayload[];

    const rawValues = await redis.mget(...keys);
    const now = Date.now();
    const heartbeats: WorkerHeartbeatPayload[] = [];

    for (const rawValue of rawValues) {
        if (!rawValue) continue;
        try {
            const parsed = JSON.parse(rawValue) as WorkerHeartbeatPayload;
            const updatedAtMs = new Date(parsed.updatedAt).getTime();
            if (!Number.isFinite(updatedAtMs)) continue;

            const ageSeconds = Math.floor((now - updatedAtMs) / 1000);
            if (ageSeconds <= WORKER_HEARTBEAT_STALE_SECONDS) {
                heartbeats.push(parsed);
            }
        } catch {
            // Ignore malformed heartbeat entries.
        }
    }

    return heartbeats.sort((a, b) => (
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    ));
}

async function markDeepRunAsFailed(runId: string, locationId: string, queueJobId: string, error: unknown) {
    const errorMessage = String((error as any)?.message || error || 'Unknown deep scrape worker error');
    const run = await db.deepScrapeRun.findUnique({
        where: { id: runId },
        select: {
            id: true,
            status: true,
            locationId: true,
            triggeredByUserId: true,
        },
    });

    if (!run || run.locationId !== locationId || !isDeepScrapeInFlightStatus(run.status)) {
        return;
    }

    const now = new Date();
    await db.$transaction([
        db.deepScrapeRun.update({
            where: { id: runId },
            data: {
                status: 'failed',
                completedAt: now,
                queueJobId,
                errorLog: errorMessage,
            },
        }),
        db.deepScrapeRunStage.create({
            data: {
                runId,
                locationId,
                stage: 'run_failed',
                status: 'error',
                reasonCode: 'task_error',
                message: `Deep run failed before orchestrator completion: ${errorMessage}`,
                metadata: {
                    runId,
                    queueJobId,
                    locationId,
                    triggeredByUserId: run.triggeredByUserId || null,
                    fallbackFailureLoggedBy: 'scraping-queue-worker',
                } as any,
            },
        }),
    ]);
}

async function markActiveDeepRunCancelledOnShutdown(signal: NodeJS.Signals) {
    const context = activeDeepRunContext;
    if (!context) return;

    const run = await db.deepScrapeRun.findUnique({
        where: { id: context.runId },
        select: {
            id: true,
            status: true,
            locationId: true,
            triggeredByUserId: true,
        },
    });

    if (!run || run.locationId !== context.locationId || !isDeepScrapeInFlightStatus(run.status)) {
        return;
    }

    const now = new Date();
    const message = `Worker interrupted by ${signal}. Run marked as cancelled.`;

    await db.$transaction([
        db.deepScrapeRun.update({
            where: { id: context.runId },
            data: {
                status: 'cancelled',
                completedAt: now,
                queueJobId: context.queueJobId,
                errorLog: message,
            },
        }),
        db.deepScrapeRunStage.create({
            data: {
                runId: context.runId,
                locationId: context.locationId,
                stage: 'run_cancelled',
                status: 'warning',
                reasonCode: 'task_error',
                message,
                metadata: {
                    runId: context.runId,
                    queueJobId: context.queueJobId,
                    locationId: context.locationId,
                    signal,
                    triggeredByUserId: run.triggeredByUserId || null,
                } as any,
            },
        }),
    ]);
}

function bindScrapingWorkerSignalHandlers() {
    if (signalHandlersBound) return;
    signalHandlersBound = true;

    const handleSignal = (signal: NodeJS.Signals) => {
        console.warn(`[Scraping] ⚠ Received ${signal}. Closing scraping worker...`);
        void (async () => {
            try {
                await markActiveDeepRunCancelledOnShutdown(signal);
            } catch (error: any) {
                console.error('[Scraping] ❌ Failed to mark active deep run as cancelled during shutdown:', error?.message || error);
            }

            try {
                if (worker) {
                    await worker.close();
                }
            } catch (error: any) {
                console.error('[Scraping] ❌ Failed to close worker on shutdown:', error?.message || error);
            }

            if (workerHeartbeatInterval) {
                clearInterval(workerHeartbeatInterval);
                workerHeartbeatInterval = null;
            }

            process.exit(0);
        })();
    };

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);
}

export const scrapingQueue = {
    add: async (name: string, data: ScrapingJobData, opts?: any) => {
        const queue = await getQueueInstance();
        console.log(`[Scraping] Job queued: ${name}`, JSON.stringify({
            taskId: data.taskId || null,
            runId: data.runId || null,
            type: data.type || 'index_scrape',
            locationId: data.locationId,
            pageLimit: data.pageLimit ?? null,
            limit: data.limit ?? null,
            triggeredBy: data.triggeredBy || null,
            triggeredByUserId: data.triggeredByUserId || null,
            queuedAt: data.queuedAt || null,
        }));
        return queue.add(name, data, opts);
    }
};

export async function cancelScrapingQueueJob(queueJobId: string | null | undefined): Promise<ScrapingQueueCancellationResult> {
    const normalizedJobId = String(queueJobId || '').trim();
    if (!normalizedJobId) {
        return {
            jobId: null,
            found: false,
            state: null,
            removed: false,
            note: 'No queue job id was attached to this run.',
        };
    }

    const queue = await getQueueInstance();
    const job = await queue.getJob(normalizedJobId);
    if (!job) {
        return {
            jobId: normalizedJobId,
            found: false,
            state: null,
            removed: false,
            note: 'Queue job not found (it may have already finished).',
        };
    }

    let state: string | null = null;
    try {
        state = await job.getState();
    } catch {
        state = null;
    }

    if (state === 'active') {
        return {
            jobId: normalizedJobId,
            found: true,
            state,
            removed: false,
            note: 'Queue job is already active; cancellation will proceed cooperatively via run status.',
        };
    }

    try {
        await job.remove();
        return {
            jobId: normalizedJobId,
            found: true,
            state,
            removed: true,
            note: null,
        };
    } catch (error: any) {
        return {
            jobId: normalizedJobId,
            found: true,
            state,
            removed: false,
            note: String(error?.message || error || 'Failed to remove queue job'),
        };
    }
}

export async function getScrapingQueueDiagnostics(): Promise<ScrapingQueueDiagnostics> {
    const [queue, heartbeats] = await Promise.all([
        getQueueInstance(),
        listWorkerHeartbeats(),
    ]);

    const [counts, failedJobs] = await Promise.all([
        queue.getJobCounts('waiting', 'active', 'delayed', 'paused', 'failed', 'completed'),
        queue.getJobs(['failed'], 0, MAX_FAILED_JOB_DIAGNOSTICS - 1, true),
    ]);

    const readyWorkers = heartbeats.filter((workerHeartbeat) => isScrapeWorkerRole(workerHeartbeat.role));
    const now = Date.now();
    const freshestHeartbeat = readyWorkers[0] || heartbeats[0];
    const heartbeatAgeSeconds = freshestHeartbeat
        ? Math.max(0, Math.floor((now - new Date(freshestHeartbeat.updatedAt).getTime()) / 1000))
        : null;

    return {
        generatedAt: new Date().toISOString(),
        workerAlive: heartbeats.length > 0,
        workerReady: readyWorkers.length > 0,
        workerHeartbeatAgeSeconds: heartbeatAgeSeconds,
        activeWorkers: heartbeats.map((workerHeartbeat) => ({
            instanceId: workerHeartbeat.instanceId,
            role: workerHeartbeat.role,
            pid: Number.isFinite(workerHeartbeat.pid) ? workerHeartbeat.pid : null,
            hostname: workerHeartbeat.hostname || null,
            startedAt: workerHeartbeat.startedAt || null,
            updatedAt: workerHeartbeat.updatedAt,
        })),
        queueDepth: {
            waiting: Number(counts.waiting || 0),
            active: Number(counts.active || 0),
            delayed: Number(counts.delayed || 0),
            paused: Number(counts.paused || 0),
            failed: Number(counts.failed || 0),
            completed: Number(counts.completed || 0),
        },
        recentFailedJobs: (failedJobs || []).map((job: any) => ({
            id: String(job?.id || ''),
            name: String(job?.name || ''),
            failedReason: job?.failedReason ? String(job.failedReason) : null,
            finishedOn: job?.finishedOn ? new Date(job.finishedOn).toISOString() : null,
            attemptsMade: Number(job?.attemptsMade || 0),
        })),
    };
}

export async function initScrapingWorker() {
    if (worker) return;

    console.log('[Scraping] 🚀 Initializing Scraping Worker...');
    console.log(`[Scraping] Worker heartbeat identity: instance=${workerInstanceId}, role=${process.env.PROCESS_ROLE || 'unspecified'}`);

    const { Worker } = await import('bullmq');

    worker = new Worker<ScrapingJobData>(QUEUE_NAME, async (job: any) => {
        const { taskId, runId, locationId, pageLimit, type, limit } = job.data;
        const queueJobId = String(job.id);
        console.log(`[Scraping] ▶ Processing job ${queueJobId}`, JSON.stringify({
            taskId: taskId || null,
            runId: runId || null,
            locationId,
            type: type || 'index_scrape',
            pageLimit: pageLimit ?? null,
            limit: limit ?? null,
        }));

        try {
            if (type === 'deep_scrape') {
                if (runId) {
                    activeDeepRunContext = {
                        runId,
                        locationId,
                        queueJobId,
                    };
                }

                const { DeepScrapeOrchestratorService } = await import("@/lib/scraping/deep-scrape-orchestrator");
                const result = await DeepScrapeOrchestratorService.processLocation(locationId, {
                    runId: runId || undefined,
                    limit: limit || 50,
                    configSnapshot: job.data.deepScrapeConfig,
                    triggerContext: {
                        source: job.data.triggeredBy || 'system',
                        initiatedByUserId: job.data.triggeredByUserId || undefined,
                        queueJobId,
                        queuedAt: job.data.queuedAt,
                    },
                });

                console.log('[Scraping] ✅ Deep orchestration completed', JSON.stringify({
                    runId: result?.runId || runId || null,
                    queueJobId,
                    locationId,
                    status: result?.status || null,
                    tasksScanned: result?.tasksScanned ?? null,
                    seedListingsFound: result?.seedListingsFound ?? null,
                    errorsTotal: result?.errorsTotal ?? null,
                }));
                return;
            }

            if (!taskId) throw new Error("Index scrape requires a taskId");
            const { ListingScraperService } = await import("@/lib/scraping/listing-scraper");

            const task = await db.scrapingTask.findUnique({
                where: { id: taskId },
                include: { connection: true }
            });

            if (!task) {
                console.warn(`[Scraping] ⚠ Task ${taskId} not found in DB. Skipping.`);
                return;
            }

            if (!task.enabled || !task.connection.enabled) {
                console.warn(`[Scraping] ⚠ Task "${task.name}" or its connection is disabled. Skipping.`);
                return;
            }

            console.log(`[Scraping] 🔧 Running task "${task.name}" on platform=${task.connection.platform}`);

            const result = await ListingScraperService.scrapeTask(task as any, {
                pageLimit: job.data.pageLimit,
                triggerContext: {
                    source: job.data.triggeredBy || (type === 'deep_scrape' ? 'system' : 'scheduled'),
                    initiatedByUserId: job.data.triggeredByUserId || undefined,
                    queueJobId,
                    queuedAt: job.data.queuedAt,
                },
            });

            console.log(`[Scraping] ✅ Task "${task.name}" completed:`, JSON.stringify(result));
        } catch (error: any) {
            console.error(`[Scraping] ❌ Job ${queueJobId} failed:`, error?.message || error);
            console.error(`[Scraping] Stack:`, error?.stack || 'No stack');

            try {
                if (type === 'deep_scrape' && runId) {
                    await markDeepRunAsFailed(runId, locationId, queueJobId, error);
                } else if (taskId) {
                    const activeRun = await db.scrapingRun.findFirst({
                        where: {
                            taskId,
                            status: 'running',
                        },
                        orderBy: { createdAt: 'desc' },
                    });

                    const fallbackMetadata = {
                        trigger: {
                            source: job.data.triggeredBy || 'system',
                            initiatedByUserId: job.data.triggeredByUserId || null,
                            queueJobId,
                            queuedAt: job.data.queuedAt || null,
                        },
                        fallbackFailureLoggedBy: 'scraping-queue-worker',
                        errorName: error?.name || null,
                    };

                    if (activeRun) {
                        await db.scrapingRun.update({
                            where: { id: activeRun.id },
                            data: {
                                status: 'failed',
                                errorLog: error.message || 'Unknown error',
                                completedAt: new Date(),
                                metadata: fallbackMetadata,
                            }
                        });
                    } else {
                        await db.scrapingRun.create({
                            data: {
                                taskId,
                                status: 'failed',
                                errorLog: error.message || 'Unknown error',
                                completedAt: new Date(),
                                metadata: fallbackMetadata,
                            }
                        });
                    }
                }
            } catch (dbErr: any) {
                console.error(`[Scraping] ❌ Failed to write error to DB:`, dbErr?.message || dbErr);
            }

            throw error; // Let BullMQ mark it failed
        } finally {
            if (type === 'deep_scrape') {
                activeDeepRunContext = null;
            }
            void publishWorkerHeartbeat();
        }
    }, {
        connection: REDIS_CONNECTION,
        concurrency: 1, // Scrape sequentially to respect rate limits
        limiter: {
            max: 1,
            duration: 5000, // 1 job per 5 seconds globally
        },
    });

    bindScrapingWorkerSignalHandlers();
    await publishWorkerHeartbeat();

    if (!workerHeartbeatInterval) {
        workerHeartbeatInterval = setInterval(() => {
            void publishWorkerHeartbeat();
        }, WORKER_HEARTBEAT_INTERVAL_MS);
        workerHeartbeatInterval.unref?.();
    }

    worker.on('failed', (job: any, err: Error) => {
        console.error(`[Scraping] ❌ Job ${job?.id} failed permanently: ${err.message}`);
        void publishWorkerHeartbeat();
    });

    worker.on('completed', (job: any) => {
        console.log(`[Scraping] ✅ Job ${job?.id} completed successfully`);
        void publishWorkerHeartbeat();
    });

    worker.on('error', (err: Error) => {
        console.error(`[Scraping] ❌ Worker connection error:`, err.message);
    });

    console.log('[Scraping] ✅ Worker initialized and listening for jobs');
}
