import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { scrapingQueue } from '@/lib/queue/scraping-queue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Max duration for Vercel/NextJS to enqueue jobs

export async function GET(req: Request) {
    try {
        // 1. Verify Vercel Cron Secret for Authorization
        const authHeader = req.headers.get('authorization');
        const expectedSecret = process.env.CRON_SECRET;

        // In development, we might not have a cron secret set, so allow manual testing
        if (process.env.NODE_ENV === 'production') {
            if (authHeader !== `Bearer ${expectedSecret}`) {
                return new NextResponse('Unauthorized', { status: 401 });
            }
        }

        // Optional specific task trigger
        const url = new URL(req.url);
        const taskId = url.searchParams.get('taskId');

        // 2. Query tasks
        const now = new Date();
        let query: any = { enabled: true };

        if (taskId) {
            query.id = taskId;
        } else {
            // Complex logic: find all where nextRunDue <= now()
            // Prisma doesn't support complex Date math in finds natively well, 
            // so we pull active, and filter in memory since scraping tasks list shouldn't be massive.
        }

        const tasks = await db.scrapingTask.findMany({
            where: query,
        });

        const enqueuedJobs = [];

        // 3. Filter schedule logistics and enqueue
        for (const task of tasks) {
            let shouldRun = false;

            if (taskId) {
                shouldRun = true; // Manual override
            } else if (!task.lastSyncAt) {
                shouldRun = true; // Never run before
            } else {
                const hoursSinceLastRun = (now.getTime() - task.lastSyncAt.getTime()) / (1000 * 60 * 60);

                switch (task.scrapeFrequency) {
                    case 'hourly': shouldRun = hoursSinceLastRun >= 1; break;
                    case 'every_6h': shouldRun = hoursSinceLastRun >= 6; break;
                    case 'daily': shouldRun = hoursSinceLastRun >= 24; break;
                    case 'weekly': shouldRun = hoursSinceLastRun >= 168; break;
                    default: shouldRun = hoursSinceLastRun >= 24;
                }
            }

            if (shouldRun) {
                // Enqueue to BullMQ
                await scrapingQueue.add(`scrape-${task.id}-${Date.now()}`, {
                    taskId: task.id,
                    locationId: task.locationId
                });
                enqueuedJobs.push(task.id);
            }
        }

        return NextResponse.json({
            status: 'success',
            reviewedTasks: tasks.length,
            enqueuedJobs: enqueuedJobs.length,
            jobs: enqueuedJobs,
        });

    } catch (error: any) {
        console.error('[Cron/ScrapeListings] Failed:', error);
        return new NextResponse(JSON.stringify({ error: error.message }), { status: 500 });
    }
}
