import db from '@/lib/db';

const REDIS_CONNECTION = {
    host: '127.0.0.1',
    port: 6379,
};

const QUEUE_NAME = 'scraping-queue';

// Define the Job Data Interface
export interface ScrapingJobData {
    taskId?: string; // Optional for deep scrapes
    locationId: string;
    pageLimit?: number;
    type?: 'index_scrape' | 'deep_scrape';
    limit?: number;
}

// 1. Queue Instance (Producer) - Lazy Loaded via Dynamic Import
let _queuePromise: Promise<any> | null = null;

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

export const scrapingQueue = {
    add: async (name: string, data: ScrapingJobData, opts?: any) => {
        const queue = await getQueueInstance();
        console.log(`[Scraping] Job queued: ${name} (task=${data.taskId}, pages=${data.pageLimit ?? 'unlimited'})`);
        return queue.add(name, data, opts);
    }
};

// 2. Worker Instance (Consumer)
let worker: any | null = null;

export async function initScrapingWorker() {
    if (worker) return;

    console.log('[Scraping] 🚀 Initializing Scraping Worker...');

    const { Worker } = await import('bullmq');

    worker = new Worker<ScrapingJobData>(QUEUE_NAME, async (job: any) => {
        const { taskId, locationId, pageLimit, type, limit } = job.data;
        console.log(`[Scraping] ▶ Processing job ${job.id} — task=${taskId ?? 'N/A'}, type=${type || 'index_scrape'}`);

        try {
            // Check if this is a Deep Scrape job
            if (type === 'deep_scrape') {
                const { DeepScraperService } = await import("@/lib/scraping/deep-scraper");
                const result = await DeepScraperService.processPendingListings(locationId, limit || 20);
                console.log(`[Scraping] ✅ Deep Scrape completed:`, JSON.stringify(result));
                return;
            }

            // Normal Index Scrape Logic
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

            // Orchestrate the scrape
            const result = await ListingScraperService.scrapeTask(task as any, {
                pageLimit: job.data.pageLimit
            });

            console.log(`[Scraping] ✅ Task "${task.name}" completed:`, JSON.stringify(result));

        } catch (error: any) {
            console.error(`[Scraping] ❌ Task ${taskId} failed:`, error.message);
            console.error(`[Scraping] Stack:`, error.stack);

            // Log the error to the database run (fallback if not already handled by Service)
            try {
                if (taskId) {
                    await db.scrapingRun.create({
                        data: {
                            taskId,
                            status: 'failed',
                            errorLog: error.message || 'Unknown error',
                            completedAt: new Date()
                        }
                    });
                }
            } catch (dbErr: any) {
                console.error(`[Scraping] ❌ Failed to write error to DB:`, dbErr.message);
            }

            throw error; // Let BullMQ mark it failed
        }

    }, {
        connection: REDIS_CONNECTION,
        concurrency: 1, // Scrape sequentially to respect rate limits
        limiter: {
            max: 1,
            duration: 5000, // 1 job per 5 seconds globally
        },
    });

    worker.on('failed', (job: any, err: Error) => {
        console.error(`[Scraping] ❌ Job ${job?.id} failed permanently: ${err.message}`);
    });

    worker.on('completed', (job: any) => {
        console.log(`[Scraping] ✅ Job ${job?.id} completed successfully`);
    });

    worker.on('error', (err: Error) => {
        console.error(`[Scraping] ❌ Worker connection error:`, err.message);
    });

    console.log('[Scraping] ✅ Worker initialized and listening for jobs');
}
