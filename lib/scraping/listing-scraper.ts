import db from '@/lib/db';
import { ScrapingTask, ScrapingConnection, ScrapingRun } from '@prisma/client';
import { PageFetcher } from './page-fetcher';

export interface RawListing {
    externalId: string;
    title: string;
    description: string;
    price?: number;
    currency?: string;
    location?: string;
    propertyType?: string;
    listingType?: string; // sale, rent
    ownerName?: string;
    ownerPhone?: string;
    ownerEmail?: string;
    url: string;
    images?: string[];
    rawHtml?: string;
}

export type ScrapeTaskWithConnection = ScrapingTask & { connection: ScrapingConnection };

export class ListingScraperService {
    
    /**
     * Main entry point to scrape a specific task configuration
     */
    static async scrapeTask(task: ScrapeTaskWithConnection) {
        console.log(`[ListingScraper] Starting scrape for task: ${task.name} (${task.id})`);
        
        // 1. Create a run record
        const run = await db.scrapingRun.create({
            data: {
                taskId: task.id,
                status: 'running',
            }
        });

        const fetcher = new PageFetcher();
        let pagesScraped = 0;
        let listingsFound = 0;
        let leadsCreated = 0;
        let duplicatesFound = 0;
        let errors = 0;

        try {
            // Which URLs are we scraping?
            const urlsToScrape = task.targetUrls && task.targetUrls.length > 0 
                ? task.targetUrls // If absolute paths are provided in targetUrls
                : []; // We assume targetUrls are always fully qualified URLs now for simplicity since we removed baseUrl from Schema

            for (const url of urlsToScrape) {
                console.log(`[ListingScraper] Fetching index url: ${url}`);
                
                // TODO: Paging logic (using task.maxPagesPerRun loop)
                // For this V1 implementation, we will just fetch the single provided array URL.

                const content = await fetcher.fetchContent({
                    url: url,
                    username: task.connection.authUsername || undefined,
                    password: task.connection.authPassword || undefined,
                    // FIXME: We will pass connection.sessionState here when PageFetcher supports it in Stage 2
                });
                
                pagesScraped++;
                
                // 2. Delegate Extraction based on connection platform/mode
                let rawListings: RawListing[] = [];
                
                if (task.connection.platform === 'bazaraki') {
                    const { extractBazarakiIndex } = await import('./extractors/bazaraki');
                    rawListings = await extractBazarakiIndex(content, url, fetcher);
                } else if (task.extractionMode === 'ai_extraction') {
                    // Fallback to strict AI Generic Extractor
                    const { extractGenericAI } = await import('./extractors/generic');
                    rawListings = await extractGenericAI(content, url, task.aiInstructions || '');
                } else {
                    console.warn(`[ListingScraper] No extractor configured for platform ${task.connection.platform}`);
                    continue;
                }

                listingsFound += rawListings.length;

                // 3. Process each found listing
                for (const listing of rawListings) {
                    try {
                        // Deduplication Check
                        const isDuplicate = await this.checkDuplicates(listing, task.locationId);
                        
                        if (isDuplicate) {
                            duplicatesFound++;
                            continue;
                        }

                        // Create ProspectLead in the Lead Inbox
                        await this.createProspect(listing, task.id, task.locationId);
                        leadsCreated++;

                    } catch (err: any) {
                        console.error(`[ListingScraper] Error processing listing ${listing.url}:`, err.message);
                        errors++;
                    }
                }
                
                // Rate Limiting between index pages
                await new Promise(r => setTimeout(r, 2000));
            }

            // Update Run success
            await db.scrapingRun.update({
                where: { id: run.id },
                data: {
                    status: 'completed',
                    completedAt: new Date(),
                    pagesScraped,
                    listingsFound,
                    leadsCreated,
                    duplicatesFound,
                    errors,
                }
            });

            // Update Task Stats
            await db.scrapingTask.update({
                where: { id: task.id },
                data: {
                    lastSyncAt: new Date(),
                    lastSyncStatus: 'success',
                    lastSyncStats: { pagesScraped, listingsFound, leadsCreated, duplicatesFound, errors }
                }
            });

            return { pagesScraped, listingsFound, leadsCreated, duplicatesFound, errors };

        } catch (error: any) {
            console.error(`[ListingScraper] Task ${task.id} failed deeply:`, error);
            
            await db.scrapingRun.update({
                where: { id: run.id },
                data: {
                    status: 'failed',
                    completedAt: new Date(),
                    errorLog: error.message,
                    pagesScraped,
                    listingsFound,
                    leadsCreated,
                    duplicatesFound,
                    errors,
                }
            });

            await db.scrapingTask.update({
                where: { id: task.id },
                data: {
                    lastSyncAt: new Date(),
                    lastSyncStatus: 'failed',
                    lastSyncError: error.message
                }
            });
            throw error;
        } finally {
            await fetcher.close();
        }
    }

    /**
     * Checks if we already have this listing based on URL, or if there's an existing contact with this phone/email.
     */
    static async checkDuplicates(listing: RawListing, locationId: string): Promise<boolean> {
        // 1. Check existing Prospects for exact URL or Source Listing ID
        const existingProspect = await db.prospectLead.findFirst({
            where: {
                locationId,
                OR: [
                    { sourceUrl: listing.url },
                    { sourceListingId: listing.externalId }
                ]
            }
        });

        if (existingProspect) return true;

        // 2. Check existing Contacts for Phone / Email cross-pollination
        if (listing.ownerPhone || listing.ownerEmail) {
            const orConditions: any[] = [];
            if (listing.ownerPhone) orConditions.push({ phone: { contains: listing.ownerPhone } });
            if (listing.ownerEmail) orConditions.push({ email: listing.ownerEmail });

            const existingContact = await db.contact.findFirst({
                where: {
                    locationId,
                    OR: orConditions
                }
            });

            // If we find an existing contact, it implies this lead is already in our CRM ecosystem.
            // Ideally we log an Insight or tie them together, but for Phase 2 spec, we drop it to avoid polluting inbox.
            if (existingContact) {
                console.log(`[ListingScraper] Found duplicate existing contact (${existingContact.id}) for raw phone/email.`);
                return true; 
            }
        }

        return false;
    }

    /**
     * Maps the extracted Listing into a Phase 1 Lead Inbox (ProspectLead) entity
     */
    static async createProspect(listing: RawListing, taskId: string, locationId: string) {
        
        let messageBody = `Listing Title: ${listing.title}\n`;
        messageBody += `Type: ${listing.listingType} / ${listing.propertyType}\n`;
        messageBody += `Location: ${listing.location}\n`;
        messageBody += `Price: ${listing.price} ${listing.currency}\n\n`;
        messageBody += `Description:\n${listing.description}`;

        await db.prospectLead.create({
            data: {
                locationId,
                source: 'scraper_bot',
                sourceUrl: listing.url,
                sourceListingId: listing.externalId,
                name: listing.ownerName,
                phone: listing.ownerPhone,
                email: listing.ownerEmail,
                message: messageBody,
                status: 'new', // Lands in Phase 1 Inbox
                sourceMetadata: listing as any // Dump raw for context verification
            }
        });
    }
}
