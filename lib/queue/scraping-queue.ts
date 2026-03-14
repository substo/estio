import db from '@/lib/db';

const REDIS_CONNECTION = {
    host: '127.0.0.1',
    port: 6379,
};

const QUEUE_NAME = 'scraping-queue';

// Define the Job Data Interface
export interface ScrapingJobData {
    targetId: string;
    locationId: string;
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
        const { targetId, locationId } = job.data;
        console.log(`[Queue] Processing Scraping Job for target ${targetId} (Job ${job.id})`);

        try {
            // Dynamic import to avoid circular dependencies
            const { ListingScraperService } = await import("@/lib/scraping/listing-scraper");
            
            const target = await db.scrapingTarget.findUnique({
                where: { id: targetId }
            });

            if (!target) {
                console.warn(`[Queue] ScrapingTarget ${targetId} not found. Skipping.`);
                return;
            }

            if (!target.enabled) {
                console.warn(`[Queue] ScrapingTarget ${targetId} is disabled. Skipping.`);
                return;
            }

            // Orchestrate the scrape
            const result = await ListingScraperService.scrapeTarget(target);
            console.log(`[Queue] Successfully completed scraping target ${targetId}. Stats:`, result);

        } catch (error: any) {
            console.error(`[Queue] Failed to scrape target ${targetId}:`, error.message);
            
            // Log the error to the database run (handled within the service if possible, or here as fallback)
            await db.scrapingRun.create({
                data: {
                    targetId,
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
