import db from '@/lib/db';
import { ScrapingTask, ScrapingConnection, ScrapingRun, ScrapingCredential } from '@prisma/client';
import { PageFetcher } from './page-fetcher';

// Random Gaussian-like delay for human emulation
const humanDelay = async (baseMs: number, jitterMs: number) => {
    // Generate an offset between -jitterMs and +jitterMs
    const offset = Math.floor(Math.random() * (jitterMs * 2 + 1)) - jitterMs;
    const finalDelay = Math.max(500, baseMs + offset); // never less than 500ms
    console.log(`[ListingScraper] 😴 Human delay: ${finalDelay}ms`);
    await new Promise((resolve) => setTimeout(resolve, finalDelay));
};

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
    thumbnails?: string[];
    rawHtml?: string;

    // Property Details
    bedrooms?: number;
    bathrooms?: number;
    propertyArea?: number; // m²
    plotArea?: number; // m²
    constructionYear?: number;

    // Geo
    latitude?: number;
    longitude?: number;

    // Seller Intelligence
    sellerExternalId?: string; // Platform user ID
    sellerRegisteredAt?: string; // "Posting since sep, 2024"
    otherListingsUrl?: string;
    contactChannels?: string[];
    whatsappPhone?: string;
    rawAttributes?: Record<string, string>;
}

export type ScrapeTaskWithConnection = ScrapingTask & { connection: ScrapingConnection };

export class ListingScraperService {
    
    /**
     * Main entry point to scrape a specific task configuration
     */
    static async scrapeTask(task: ScrapeTaskWithConnection, options?: { pageLimit?: number }) {
        console.log(`[ListingScraper] Starting scrape for task: ${task.name} (${task.id}) with options:`, options);
        
        // 1. Create a run record
        const run = await db.scrapingRun.create({
            data: {
                taskId: task.id,
                status: 'running',
            }
        });

        const activeCredential = await this.checkoutCredential(task.connection.id);

        if (!activeCredential) {
            console.warn(`[ListingScraper] No active credentials available for connection pool ${task.connection.id}. Failing task gracefully.`);
            await db.scrapingRun.update({
                where: { id: run.id },
                data: { status: 'failed', errorLog: 'No active credentials available in the platform pool.' }
            });
            return { pagesScraped: 0, listingsFound: 0, leadsCreated: 0, duplicatesFound: 0, errors: 1 };
        }

        console.log(`[ListingScraper] Checked out credential: ${activeCredential.authUsername || activeCredential.id}`);

        const fetcher = new PageFetcher();
        let pagesScraped = 0;
        let listingsFound = 0;
        let leadsCreated = 0;
        let duplicatesFound = 0;
        let errors = 0;
        
        let interactionsRemaining = task.maxInteractionsPerRun ?? Number.MAX_SAFE_INTEGER;
        // Global safety: Don't exceed connection limit
        const dailyLimit = task.connection.maxDailyInteractions || 100; 
        if (interactionsRemaining > dailyLimit) interactionsRemaining = dailyLimit;

        try {
            // Which URLs are we scraping?
            const urlsToScrape = task.targetUrls && task.targetUrls.length > 0 
                ? task.targetUrls // If absolute paths are provided in targetUrls
                : []; // We assume targetUrls are always fully qualified URLs now for simplicity since we removed baseUrl from Schema

            for (const rootUrl of urlsToScrape) {
                console.log(`[ListingScraper] Fetching tree starting at: ${rootUrl}`);
                
                let currentUrl: string | undefined = rootUrl;
                let pageCount = 0;
                // Avoid infinite loops, limit to some reasonable max depth if target is infinite
                const MAX_DEPTH = options?.pageLimit ?? task.maxPagesPerRun ?? 100;
                
                while (currentUrl && interactionsRemaining > 0 && pageCount < MAX_DEPTH) {
                    pageCount++;
                    console.log(`[ListingScraper] Fetching page ${pageCount}: ${currentUrl}`);

                    const content = await fetcher.fetchContent({
                        url: currentUrl,
                        username: activeCredential.authUsername || undefined,
                        password: activeCredential.authPassword || undefined,
                        sessionState: activeCredential.sessionState ? activeCredential.sessionState : undefined,
                    });
                    
                    pagesScraped++;
                    
                    // 2. Delegate Extraction based on connection platform/mode
                    let rawListings: RawListing[] = [];
                    let nextPageUrl: string | undefined = undefined;
                    
                    if (task.connection.platform === 'bazaraki') {
                        const { extractBazarakiIndex } = await import('./extractors/bazaraki');
                        // Pass the strategy context and interaction budget
                        const extractionResult = await extractBazarakiIndex(content, currentUrl, fetcher, {
                            strategy: task.scrapeStrategy as 'shallow_duplication' | 'deep_extraction',
                            sellerType: task.targetSellerType as 'individual' | 'agency' | 'all',
                            interactionsAvailable: interactionsRemaining,
                            delayBaseMs: task.delayBetweenPagesMs,
                            delayJitterMs: task.delayJitterMs
                        });
                        rawListings = extractionResult.listings;
                        nextPageUrl = extractionResult.nextPageUrl; // Capture pagination link
                        
                        // Deduct budget
                        if (extractionResult.interactionsUsed > 0) {
                            interactionsRemaining -= extractionResult.interactionsUsed;
                            console.log(`[ListingScraper] Used ${extractionResult.interactionsUsed} interactions. Remaining: ${interactionsRemaining}`);
                        }
                    } else if (task.extractionMode === 'ai_extraction') {
                        // Fallback to strict AI Generic Extractor
                        const { extractGenericAI } = await import('./extractors/generic');
                        rawListings = await extractGenericAI(content, currentUrl, task.aiInstructions || '');
                        // Generic AI doesn't support structured pagination out-of-the-box yet, break the while loop
                        nextPageUrl = undefined;
                    } else {
                        console.warn(`[ListingScraper] No extractor configured for platform ${task.connection.platform}`);
                        break;
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
                    
                    if (!nextPageUrl) {
                        console.log(`[ListingScraper] Reached end of pagination for root URL.`);
                        break;
                    }

                    // Rate Limiting between index pages with Jitter
                    console.log(`[ListingScraper] Pagination sleep before jumping to ${nextPageUrl}`);
                    await humanDelay(task.delayBetweenPagesMs, task.delayJitterMs);
                    
                    currentUrl = nextPageUrl;
                }
            }

            // Update Credential Rotation TS
            await db.scrapingCredential.update({
                where: { id: activeCredential.id },
                data: {
                    lastUsedAt: new Date(),
                    healthScore: 100 // Reset/Bump health on successful run
                }
            });

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
     * Finds the Least Recently Used (LRU) active credential for the pool
     */
    private static async checkoutCredential(connectionId: string): Promise<ScrapingCredential | null> {
        return db.scrapingCredential.findFirst({
            where: {
                connectionId,
                status: 'active'
            },
            orderBy: [
                { lastUsedAt: 'asc' } // The oldest gets priority
            ]
        });
    }

    /**
     * Checks if we already have this listing based on URL, or if there's an existing contact with this phone/email.
     */
    static async checkDuplicates(listing: RawListing, locationId: string): Promise<boolean> {
        // 1. Check existing ScrapedListings for exact URL or Platform ID
        const existingListing = await db.scrapedListing.findFirst({
            where: {
                locationId,
                platform: 'bazaraki', // TODO: dynamic platform from task config
                externalId: listing.externalId
            }
        });

        if (existingListing) return true;

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
     * Maps the extracted Listing into a ScrapedListing and ProspectLead entity
     */
    static async createProspect(listing: RawListing, taskId: string, locationId: string) {
        
        // 1. Default to false for initial scrape. Deep Scrape will classify this later.
        let isAgency = false;

        // 2. Find or Create ProspectLead based on phone/email
        let prospectLeadId: string | null = null;
        
        if (listing.ownerPhone || listing.ownerEmail) {
            const orConditions: any[] = [];
            if (listing.ownerPhone) orConditions.push({ phone: { contains: listing.ownerPhone } });
            if (listing.ownerEmail) orConditions.push({ email: listing.ownerEmail });

            let existingProspect = await db.prospectLead.findFirst({
                where: { locationId, OR: orConditions }
            });

            if (!existingProspect) {
                existingProspect = await db.prospectLead.create({
                    data: {
                        locationId,
                        source: 'scraper_bot',
                        name: listing.ownerName || null,
                        phone: listing.whatsappPhone || listing.ownerPhone || null,
                        email: listing.ownerEmail || null,
                        status: 'new', // Lands in People Inbox
                        isAgency,
                        platformUserId: listing.sellerExternalId,
                        platformRegistered: listing.sellerRegisteredAt,
                    }
                });
            } else {
                const updateData: any = {};
                if (listing.ownerName && !existingProspect.name) updateData.name = listing.ownerName;
                
                const bestPhone = listing.whatsappPhone || listing.ownerPhone;
                if (bestPhone && !existingProspect.phone) updateData.phone = bestPhone;
                
                if (listing.sellerExternalId && !existingProspect.platformUserId) updateData.platformUserId = listing.sellerExternalId;
                if (listing.sellerRegisteredAt && !existingProspect.platformRegistered) updateData.platformRegistered = listing.sellerRegisteredAt;

                if (Object.keys(updateData).length > 0) {
                    await db.prospectLead.update({ where: { id: existingProspect.id }, data: updateData });
                }
            }
            prospectLeadId = existingProspect.id;
        }

        // 3. Create ScrapedListing connected to the Prospect
        await db.scrapedListing.create({
            data: {
                locationId,
                platform: 'bazaraki', // TODO: pass platform dynamically
                externalId: listing.externalId,
                url: listing.url,
                title: listing.title,
                description: listing.description,
                price: listing.price,
                currency: listing.currency,
                propertyType: listing.propertyType,
                listingType: listing.listingType,
                locationText: listing.location,
                images: listing.images || [],
                thumbnails: listing.thumbnails || [],
                bedrooms: listing.bedrooms,
                bathrooms: listing.bathrooms,
                propertyArea: listing.propertyArea,
                plotArea: listing.plotArea,
                constructionYear: listing.constructionYear,
                latitude: listing.latitude,
                longitude: listing.longitude,
                sellerExternalId: listing.sellerExternalId,
                sellerRegisteredAt: listing.sellerRegisteredAt,
                otherListingsUrl: listing.otherListingsUrl,
                contactChannels: listing.contactChannels,
                whatsappPhone: listing.whatsappPhone,
                rawAttributes: listing.rawAttributes,
                status: 'NEW', // Lands in Listings Inbox
                prospectLeadId
            }
        });
    }
}
