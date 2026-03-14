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

        // Optional specific target trigger
        const url = new URL(req.url);
        const targetId = url.searchParams.get('targetId');
        
        // 2. Query targets
        const now = new Date();
        let query: any = { enabled: true };
        
        if (targetId) {
            query.id = targetId;
        } else {
            // Complex logic: find all where nextRunDue <= now()
            // Prisma doesn't support complex Date math in finds natively well, 
            // so we pull active, and filter in memory since scraping targets list shouldn't be massive.
        }

        const targets = await db.scrapingTarget.findMany({
            where: query,
        });

        const enqueuedJobs = [];
        
        // 3. Filter schedule logistics and enqueue
        for (const target of targets) {
            let shouldRun = false;
            
            if (targetId) {
                shouldRun = true; // Manual override
            } else if (!target.lastSyncAt) {
                 shouldRun = true; // Never run before
            } else {
                const hoursSinceLastRun = (now.getTime() - target.lastSyncAt.getTime()) / (1000 * 60 * 60);

                switch (target.scrapeFrequency) {
                    case 'hourly': shouldRun = hoursSinceLastRun >= 1; break;
                    case 'every_6h': shouldRun = hoursSinceLastRun >= 6; break;
                    case 'daily': shouldRun = hoursSinceLastRun >= 24; break;
                    case 'weekly': shouldRun = hoursSinceLastRun >= 168; break;
                    default: shouldRun = hoursSinceLastRun >= 24;
                }
            }

            if (shouldRun) {
                // Enqueue to BullMQ
                await scrapingQueue.add(`scrape-${target.id}-${Date.now()}`, {
                    targetId: target.id,
                    locationId: target.locationId
                });
                enqueuedJobs.push(target.id);
            }
        }

        return NextResponse.json({
            status: 'success',
            reviewedTargets: targets.length,
            enqueuedJobs: enqueuedJobs.length,
            jobs: enqueuedJobs,
        });

    } catch (error: any) {
        console.error('[Cron/ScrapeListings] Failed:', error);
        return new NextResponse(JSON.stringify({ error: error.message }), { status: 500 });
    }
}
