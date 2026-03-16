'use server';

import db from '@/lib/db';
import { ListingScraperService } from '@/lib/scraping/listing-scraper';
import { auth } from '@clerk/nextjs/server';

export async function scrapeSellerProfile(locationId: string, sellerName: string, profileUrl: string) {
    try {
        const { userId } = await auth();
        if (!userId) return { success: false, message: 'Unauthorized' };

        // 1. Find an active connection for Bazaraki in this location
        const connection = await db.scrapingConnection.findFirst({
            where: {
                locationId,
                platform: 'bazaraki',
            }
        });

        if (!connection) {
            return { success: false, message: 'No active Bazaraki scraping connection found for this account. Please configure one in Settings -> Integrations.' };
        }

        // 2. Create a one-off task for this seller
        const taskName = `[Seller Profile] ${sellerName || 'Unknown'}`;
        const task = await db.scrapingTask.create({
            data: {
                locationId,
                name: taskName,
                connectionId: connection.id,
                targetUrls: [profileUrl],
                scrapeStrategy: 'shallow_duplication', // Best for bulk profile grabbing without using up deep-scrape interactions
                extractionMode: 'index_crawler',
                maxPagesPerRun: 10,
                maxInteractionsPerRun: 50,
                enabled: true,
            }
        });

        // Add connection to satisfy ScrapeTaskWithConnection type
        const taskWithConnection = { ...task, connection };

        // 3. Kick off the scraper in the background
        // We do not await this, we just let it run async
        ListingScraperService.scrapeTask(taskWithConnection, { pageLimit: 10 })
            .then(stats => {
                console.log(`[Seller Scrape Action] Finished async task ${task.id}:`, stats);
            })
            .catch(err => {
                console.error(`[Seller Scrape Action] Failed async task ${task.id}:`, err);
            });

        return { 
            success: true, 
            message: `Scraping task "${taskName}" started successfully! Check Prospects Inbox in a few minutes.` 
        };

    } catch (e: any) {
        console.error('[Seller Scrape Action] Error:', e);
        return { success: false, message: e.message || 'Failed to start scraping task.' };
    }
}
