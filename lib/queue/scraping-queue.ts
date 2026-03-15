import db from '@/lib/db';

const REDIS_CONNECTION = {
    host: '127.0.0.1',
    port: 6379,
};

const QUEUE_NAME = 'scraping-queue';

// Define the Job Data Interface
export interface ScrapingJobData {
    taskId: string;
    locationId: string;
    pageLimit?: number;
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
        return queue.add(name, data, opts);
    }
};

// 2. Worker Instance (Consumer)
let worker: any | null = null;

export async function initScrapingWorker() {
    if (worker) return;

    console.log('[Queue] Initializing Scraping Worker...');

    const { Worker } = await import('bullmq');

    worker = new Worker<ScrapingJobData>(QUEUE_NAME, async (job: any) => {
        const { taskId, locationId } = job.data;
        console.log(`[Queue] Processing Scraping Job for task ${taskId} (Job ${job.id})`);

        try {
            // Dynamic import to avoid circular dependencies
            const { ListingScraperService } = await import("@/lib/scraping/listing-scraper");
            
            const task = await db.scrapingTask.findUnique({
                where: { id: taskId },
                include: { connection: true }
            });

            if (!task) {
                console.warn(`[Queue] ScrapingTask ${taskId} not found. Skipping.`);
                return;
            }

            if (!task.enabled || !task.connection.enabled) {
                console.warn(`[Queue] ScrapingTask ${taskId} or its connection is disabled. Skipping.`);
                return;
            }

            // Orchestrate the scrape
            const result = await ListingScraperService.scrapeTask(task as any, { 
                pageLimit: job.data.pageLimit 
            });
            console.log(`[Queue] Successfully completed scraping task ${taskId}. Stats:`, result);

        } catch (error: any) {
            console.error(`[Queue] Failed to scrape task ${taskId}:`, error.message);
            
            // Log the error to the database run (handled within the service if possible, or here as fallback)
            await db.scrapingRun.create({
                data: {
                    taskId,
                    status: 'failed',
                    errorLog: error.message || 'Unknown error',
                    completedAt: new Date()
                }
            });

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
        console.error(`[Queue] Job ${job?.id} failed: ${err.message}`);
    });
}
