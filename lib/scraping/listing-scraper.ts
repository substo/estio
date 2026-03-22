import db from '@/lib/db';
import { ScrapingTask, ScrapingConnection, ScrapingCredential } from '@prisma/client';
import { PageFetcher } from './page-fetcher';
import {
    buildListingRelevanceRawAttributes,
    classifyListingRelevance,
} from './listing-relevance-classifier';

// Random Gaussian-like delay for human emulation
const humanDelay = async (baseMs: number, jitterMs: number) => {
    const offset = Math.floor(Math.random() * (jitterMs * 2 + 1)) - jitterMs;
    const finalDelay = Math.max(500, baseMs + offset);
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
    otherListingsCount?: number;
    contactChannels?: string[];
    whatsappPhone?: string;
    rawAttributes?: Record<string, string>;
}

export type ScrapeTaskWithConnection = ScrapingTask & { connection: ScrapingConnection };

interface ScrapeCounters {
    pagesScraped: number;
    listingsFound: number;
    leadsCreated: number;
    duplicatesFound: number;
    errors: number;
}

interface UpsertListingResult {
    prospectLeadId: string | null;
    listingCreated: boolean;
    listingAlreadyExisted: boolean;
    skippedAsDuplicateContact: boolean;
    isRealEstate: boolean;
    relevanceSource: string;
    relevanceConfidence: number;
}

interface ProspectClassificationState {
    isAgency: boolean | null;
    confidence: number | null;
    manualOverride: boolean | null;
    phone: string | null;
}

interface BazarakiPortfolioResult {
    pagesScraped: number;
    listings: RawListing[];
}

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
        const counters: ScrapeCounters = {
            pagesScraped: 0,
            listingsFound: 0,
            leadsCreated: 0,
            duplicatesFound: 0,
            errors: 0,
        };
        const touchedProspectIds = new Set<string>();

        let interactionsRemaining = task.maxInteractionsPerRun ?? Number.MAX_SAFE_INTEGER;
        const dailyLimit = task.connection.maxDailyInteractions || 100;
        if (interactionsRemaining > dailyLimit) interactionsRemaining = dailyLimit;

        try {
            if (this.shouldUseStrategicContactFlow(task)) {
                console.log('[ListingScraper] 🧠 Running strategic contact-first flow (private-first deep extraction).');
                const strategic = await this.runStrategicBazarakiFlow({
                    task,
                    options,
                    fetcher,
                    activeCredential,
                    interactionsRemaining,
                    touchedProspectIds,
                });
                counters.pagesScraped += strategic.pagesScraped;
                counters.listingsFound += strategic.listingsFound;
                counters.leadsCreated += strategic.leadsCreated;
                counters.duplicatesFound += strategic.duplicatesFound;
                counters.errors += strategic.errors;
                interactionsRemaining = strategic.interactionsRemaining;
            } else {
                let knownPhone: string | undefined = undefined;
                if (task.targetProspectId) {
                    const prospect = await db.prospectLead.findUnique({ where: { id: task.targetProspectId } });
                    if (prospect?.phone) knownPhone = prospect.phone;
                }

                const urlsToScrape = task.targetUrls && task.targetUrls.length > 0
                    ? task.targetUrls
                    : [];

                for (const rootUrl of urlsToScrape) {
                    console.log(`[ListingScraper] Fetching tree starting at: ${rootUrl}`);

                    let currentUrl: string | undefined = rootUrl;
                    let pageCount = 0;
                    const maxDepth = options?.pageLimit ?? task.maxPagesPerRun ?? 100;

                    while (currentUrl && interactionsRemaining > 0 && pageCount < maxDepth) {
                        pageCount++;
                        console.log(`[ListingScraper] Fetching page ${pageCount}: ${currentUrl}`);

                        const content = await fetcher.fetchContent({
                            url: currentUrl,
                            username: activeCredential.authUsername || undefined,
                            password: activeCredential.authPassword || undefined,
                            sessionState: activeCredential.sessionState ? activeCredential.sessionState : undefined,
                        });

                        counters.pagesScraped++;

                        let rawListings: RawListing[] = [];
                        let nextPageUrl: string | undefined = undefined;
                        const shouldRunTargetedDeepPortfolio = task.connection.platform === 'bazaraki'
                            && Boolean(task.targetProspectId);

                        if (task.connection.platform === 'bazaraki') {
                            const { extractBazarakiIndex } = await import('./extractors/bazaraki');
                            const extractionStrategy = shouldRunTargetedDeepPortfolio
                                ? 'shallow_duplication'
                                : (task.scrapeStrategy as 'shallow_duplication' | 'deep_extraction');
                            const extractionResult = await extractBazarakiIndex(content, currentUrl, fetcher, {
                                strategy: extractionStrategy,
                                sellerType: task.targetSellerType as 'individual' | 'agency' | 'all',
                                interactionsAvailable: interactionsRemaining,
                                delayBaseMs: task.delayBetweenPagesMs,
                                delayJitterMs: task.delayJitterMs,
                                knownPhone
                            });
                            rawListings = extractionResult.listings;
                            nextPageUrl = extractionResult.nextPageUrl;

                            if (extractionResult.interactionsUsed > 0) {
                                interactionsRemaining -= extractionResult.interactionsUsed;
                                console.log(`[ListingScraper] Used ${extractionResult.interactionsUsed} interactions. Remaining: ${interactionsRemaining}`);
                            }
                        } else if (task.extractionMode === 'ai_extraction') {
                            const { extractGenericAI } = await import('./extractors/generic');
                            rawListings = await extractGenericAI(content, currentUrl, task.aiInstructions || '');
                            nextPageUrl = undefined;
                        } else {
                            console.warn(`[ListingScraper] No extractor configured for platform ${task.connection.platform}`);
                            break;
                        }

                        counters.listingsFound += rawListings.length;
                        const deepCandidates: RawListing[] = [];

                        for (const listing of rawListings) {
                            try {
                                const saveResult = await this.upsertListingAndProspect(listing, task, task.locationId);

                                if (saveResult.skippedAsDuplicateContact || saveResult.listingAlreadyExisted) {
                                    counters.duplicatesFound++;
                                }

                                if (saveResult.listingCreated && saveResult.isRealEstate) {
                                    counters.leadsCreated++;
                                }

                                if (saveResult.prospectLeadId) {
                                    touchedProspectIds.add(saveResult.prospectLeadId);
                                }

                                if (shouldRunTargetedDeepPortfolio && saveResult.isRealEstate) {
                                    deepCandidates.push({
                                        ...listing,
                                        ownerPhone: knownPhone || listing.ownerPhone,
                                    });
                                }
                            } catch (err: any) {
                                console.error(`[ListingScraper] Error processing listing ${listing.url}:`, err.message);
                                counters.errors++;
                            }
                        }

                        if (shouldRunTargetedDeepPortfolio && deepCandidates.length > 0 && interactionsRemaining > 0) {
                            const { deepScrapeBazarakiListing } = await import('./extractors/bazaraki');
                            for (const candidate of deepCandidates) {
                                if (interactionsRemaining <= 0) break;
                                try {
                                    const deepResult = await deepScrapeBazarakiListing(candidate, fetcher, {
                                        sellerType: 'all',
                                        knownPhone,
                                    });
                                    interactionsRemaining -= deepResult.interactionsUsed;

                                    const deepSave = await this.upsertListingAndProspect(deepResult.listing, task, task.locationId);
                                    if (deepSave.prospectLeadId) {
                                        touchedProspectIds.add(deepSave.prospectLeadId);
                                    }
                                } catch (deepErr: any) {
                                    console.warn(`[ListingScraper] Targeted deep scrape failed for ${candidate.url}: ${deepErr.message}`);
                                    counters.errors++;
                                }
                            }
                        }

                        if (!nextPageUrl) {
                            console.log('[ListingScraper] Reached end of pagination for root URL.');
                            break;
                        }

                        console.log(`[ListingScraper] Pagination sleep before jumping to ${nextPageUrl}`);
                        await humanDelay(task.delayBetweenPagesMs, task.delayJitterMs);

                        currentUrl = nextPageUrl;
                    }
                }
            }

            if (touchedProspectIds.size > 0) {
                await this.classifyTouchedProspects(task.locationId, Array.from(touchedProspectIds));
            }

            await db.scrapingCredential.update({
                where: { id: activeCredential.id },
                data: {
                    lastUsedAt: new Date(),
                    healthScore: 100
                }
            });

            await db.scrapingRun.update({
                where: { id: run.id },
                data: {
                    status: 'completed',
                    completedAt: new Date(),
                    pagesScraped: counters.pagesScraped,
                    listingsFound: counters.listingsFound,
                    leadsCreated: counters.leadsCreated,
                    duplicatesFound: counters.duplicatesFound,
                    errors: counters.errors,
                    metadata: {
                        interactionsRemaining,
                    },
                }
            });

            await db.scrapingTask.update({
                where: { id: task.id },
                data: {
                    lastSyncAt: new Date(),
                    lastSyncStatus: 'success',
                    lastSyncStats: {
                        pagesScraped: counters.pagesScraped,
                        listingsFound: counters.listingsFound,
                        leadsCreated: counters.leadsCreated,
                        duplicatesFound: counters.duplicatesFound,
                        errors: counters.errors,
                    }
                }
            });

            return counters;

        } catch (error: any) {
            console.error(`[ListingScraper] Task ${task.id} failed deeply:`, error);

            await db.scrapingRun.update({
                where: { id: run.id },
                data: {
                    status: 'failed',
                    completedAt: new Date(),
                    errorLog: error.message,
                    pagesScraped: counters.pagesScraped,
                    listingsFound: counters.listingsFound,
                    leadsCreated: counters.leadsCreated,
                    duplicatesFound: counters.duplicatesFound,
                    errors: counters.errors,
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

    private static shouldUseStrategicContactFlow(task: ScrapeTaskWithConnection): boolean {
        return task.connection.platform === 'bazaraki' && task.targetSellerType === 'individual' && !task.targetProspectId;
    }

    private static async runStrategicBazarakiFlow(params: {
        task: ScrapeTaskWithConnection;
        options?: { pageLimit?: number };
        fetcher: PageFetcher;
        activeCredential: ScrapingCredential;
        interactionsRemaining: number;
        touchedProspectIds: Set<string>;
    }): Promise<ScrapeCounters & { interactionsRemaining: number }> {
        const {
            task,
            options,
            fetcher,
            activeCredential,
            touchedProspectIds,
        } = params;
        let interactionsRemaining = params.interactionsRemaining;

        const counters: ScrapeCounters = {
            pagesScraped: 0,
            listingsFound: 0,
            leadsCreated: 0,
            duplicatesFound: 0,
            errors: 0,
        };

        const {
            extractBazarakiIndex,
            deepScrapeBazarakiListing,
        } = await import('./extractors/bazaraki');

        const urlsToScrape = task.targetUrls && task.targetUrls.length > 0 ? task.targetUrls : [];
        const seedListings = new Map<string, RawListing>();
        const discoveredExternalIds = new Set<string>();
        const processedSellerKeys = new Set<string>();

        for (const rootUrl of urlsToScrape) {
            let currentUrl: string | undefined = rootUrl;
            let pageCount = 0;
            const maxDepth = options?.pageLimit ?? task.maxPagesPerRun ?? 100;

            while (currentUrl && pageCount < maxDepth) {
                pageCount++;
                console.log(`[ListingScraper][Strategic] Index page ${pageCount}: ${currentUrl}`);

                const content = await fetcher.fetchContent({
                    url: currentUrl,
                    username: activeCredential.authUsername || undefined,
                    password: activeCredential.authPassword || undefined,
                    sessionState: activeCredential.sessionState ? activeCredential.sessionState : undefined,
                });

                counters.pagesScraped++;

                const extractionResult = await extractBazarakiIndex(content, currentUrl, fetcher, {
                    strategy: 'shallow_duplication',
                    sellerType: 'all',
                    interactionsAvailable: 0,
                    delayBaseMs: task.delayBetweenPagesMs,
                    delayJitterMs: task.delayJitterMs,
                });

                for (const listing of extractionResult.listings) {
                    if (!seedListings.has(listing.externalId)) {
                        seedListings.set(listing.externalId, listing);
                    }
                    if (!discoveredExternalIds.has(listing.externalId)) {
                        discoveredExternalIds.add(listing.externalId);
                        counters.listingsFound++;
                    }
                }

                if (!extractionResult.nextPageUrl) break;
                await humanDelay(task.delayBetweenPagesMs, task.delayJitterMs);
                currentUrl = extractionResult.nextPageUrl;
            }
        }

        const assignedToProcessedSeller = new Set<string>();

        for (const seed of seedListings.values()) {
            if (assignedToProcessedSeller.has(seed.externalId)) continue;
            const seedSellerKey = this.buildSellerProcessingKey(seed);
            if (seedSellerKey && processedSellerKeys.has(seedSellerKey)) continue;

            let seedListing = seed;

            if (interactionsRemaining > 0) {
                try {
                    const deepSeed = await deepScrapeBazarakiListing(seed, fetcher, {
                        sellerType: 'all',
                    });
                    seedListing = deepSeed.listing;
                    interactionsRemaining -= deepSeed.interactionsUsed;
                } catch (e: any) {
                    console.warn(`[ListingScraper][Strategic] Seed deep scrape failed for ${seed.url}: ${e.message}`);
                    counters.errors++;
                }
            }

            try {
                const seedSave = await this.upsertListingAndProspect(seedListing, task, task.locationId);
                if (seedSave.skippedAsDuplicateContact || seedSave.listingAlreadyExisted) {
                    counters.duplicatesFound++;
                }
                if (seedSave.listingCreated && seedSave.isRealEstate) {
                    counters.leadsCreated++;
                }

                assignedToProcessedSeller.add(seedListing.externalId);
                const processedSeedSellerKey = this.buildSellerProcessingKey(seedListing);
                if (processedSeedSellerKey) {
                    processedSellerKeys.add(processedSeedSellerKey);
                }

                if (!seedSave.isRealEstate) {
                    continue;
                }

                const prospectLeadId = seedSave.prospectLeadId;
                if (!prospectLeadId) {
                    continue;
                }
                touchedProspectIds.add(prospectLeadId);

                const boundTask = { ...task, targetProspectId: prospectLeadId } as ScrapeTaskWithConnection;

                const sellerPortfolioListings: RawListing[] = [];
                if (seedListing.otherListingsUrl) {
                    const portfolio = await this.collectBazarakiPortfolioListings({
                        profileUrl: seedListing.otherListingsUrl,
                        task,
                        options,
                        fetcher,
                        activeCredential,
                    });

                    counters.pagesScraped += portfolio.pagesScraped;

                    for (const portfolioListing of portfolio.listings) {
                        if (!discoveredExternalIds.has(portfolioListing.externalId)) {
                            discoveredExternalIds.add(portfolioListing.externalId);
                            counters.listingsFound++;
                        }

                        const listingWithSellerContext: RawListing = {
                            ...portfolioListing,
                            ownerName: seedListing.ownerName || portfolioListing.ownerName,
                            ownerPhone: seedListing.ownerPhone || portfolioListing.ownerPhone,
                            ownerEmail: seedListing.ownerEmail || portfolioListing.ownerEmail,
                            sellerExternalId: seedListing.sellerExternalId || portfolioListing.sellerExternalId,
                            sellerRegisteredAt: seedListing.sellerRegisteredAt || portfolioListing.sellerRegisteredAt,
                            otherListingsUrl: seedListing.otherListingsUrl || portfolioListing.otherListingsUrl,
                            otherListingsCount: seedListing.otherListingsCount ?? portfolioListing.otherListingsCount,
                            contactChannels: Array.from(new Set([
                                ...(portfolioListing.contactChannels || []),
                                ...(seedListing.contactChannels || []),
                            ])),
                            whatsappPhone: portfolioListing.whatsappPhone || seedListing.whatsappPhone,
                        };

                        const portfolioSave = await this.upsertListingAndProspect(listingWithSellerContext, boundTask, task.locationId);
                        if (portfolioSave.skippedAsDuplicateContact || portfolioSave.listingAlreadyExisted) {
                            counters.duplicatesFound++;
                        }
                        if (portfolioSave.listingCreated && portfolioSave.isRealEstate) {
                            counters.leadsCreated++;
                        }
                        if (portfolioSave.prospectLeadId) {
                            touchedProspectIds.add(portfolioSave.prospectLeadId);
                        }

                        assignedToProcessedSeller.add(listingWithSellerContext.externalId);
                        const processedPortfolioSellerKey = this.buildSellerProcessingKey(listingWithSellerContext);
                        if (processedPortfolioSellerKey) {
                            processedSellerKeys.add(processedPortfolioSellerKey);
                        }

                        if (listingWithSellerContext.externalId !== seedListing.externalId && portfolioSave.isRealEstate) {
                            sellerPortfolioListings.push(listingWithSellerContext);
                        }
                    }
                }

                const classification = await this.ensureProspectClassification(task.locationId, prospectLeadId, seedListing);
                if (this.shouldDeepScrapePrivatePortfolio(classification)) {
                    const knownPhone = classification.phone || seedListing.ownerPhone || seedListing.whatsappPhone;
                    for (const portfolioListing of sellerPortfolioListings) {
                        if (interactionsRemaining <= 0) break;

                        try {
                            const deepPortfolioListing = await deepScrapeBazarakiListing(
                                {
                                    ...portfolioListing,
                                    ownerPhone: knownPhone || portfolioListing.ownerPhone,
                                },
                                fetcher,
                                {
                                    sellerType: 'individual',
                                    knownPhone: knownPhone || undefined,
                                }
                            );

                            interactionsRemaining -= deepPortfolioListing.interactionsUsed;

                            const deepSave = await this.upsertListingAndProspect(deepPortfolioListing.listing, boundTask, task.locationId);
                            if (deepSave.skippedAsDuplicateContact || deepSave.listingAlreadyExisted) {
                                counters.duplicatesFound++;
                            }
                            if (deepSave.listingCreated && deepSave.isRealEstate) {
                                counters.leadsCreated++;
                            }
                        } catch (e: any) {
                            console.warn(`[ListingScraper][Strategic] Failed deep scrape for portfolio listing ${portfolioListing.url}: ${e.message}`);
                            counters.errors++;
                        }
                    }
                } else {
                    console.log(`[ListingScraper][Strategic] Skipping deep portfolio scrape for prospect ${prospectLeadId} (agency/uncertain).`);
                }
            } catch (e: any) {
                console.error(`[ListingScraper][Strategic] Failed seller orchestration for ${seed.url}:`, e.message);
                counters.errors++;
            }
        }

        return {
            ...counters,
            interactionsRemaining,
        };
    }

    private static async collectBazarakiPortfolioListings(params: {
        profileUrl: string;
        task: ScrapeTaskWithConnection;
        options?: { pageLimit?: number };
        fetcher: PageFetcher;
        activeCredential: ScrapingCredential;
    }): Promise<BazarakiPortfolioResult> {
        const {
            profileUrl,
            task,
            options,
            fetcher,
            activeCredential,
        } = params;

        const { extractBazarakiIndex } = await import('./extractors/bazaraki');

        let pagesScraped = 0;
        const listings = new Map<string, RawListing>();
        let currentUrl: string | undefined = profileUrl;
        let pageCount = 0;
        const maxDepth = Math.max(1, options?.pageLimit ?? task.maxPagesPerRun ?? 10);

        while (currentUrl && pageCount < maxDepth) {
            pageCount++;
            console.log(`[ListingScraper][Strategic] Seller profile page ${pageCount}: ${currentUrl}`);

            const content = await fetcher.fetchContent({
                url: currentUrl,
                username: activeCredential.authUsername || undefined,
                password: activeCredential.authPassword || undefined,
                sessionState: activeCredential.sessionState ? activeCredential.sessionState : undefined,
            });

            pagesScraped++;

            const extractionResult = await extractBazarakiIndex(content, currentUrl, fetcher, {
                strategy: 'shallow_duplication',
                sellerType: 'all',
                interactionsAvailable: 0,
                delayBaseMs: task.delayBetweenPagesMs,
                delayJitterMs: task.delayJitterMs,
            });

            for (const listing of extractionResult.listings) {
                if (!listings.has(listing.externalId)) {
                    listings.set(listing.externalId, listing);
                }
            }

            if (!extractionResult.nextPageUrl) {
                break;
            }

            await humanDelay(task.delayBetweenPagesMs, task.delayJitterMs);
            currentUrl = extractionResult.nextPageUrl;
        }

        return {
            pagesScraped,
            listings: Array.from(listings.values()),
        };
    }

    private static async ensureProspectClassification(
        locationId: string,
        prospectId: string,
        seedListing: RawListing,
    ): Promise<ProspectClassificationState> {
        const {
            classifyAndUpdateProspect,
            buildClassificationInputForProspect,
            shouldRunProspectClassification,
        } = await import('@/lib/ai/prospect-classifier');

        try {
            const decision = await shouldRunProspectClassification(prospectId);
            if (decision.shouldClassify) {
                const input = await buildClassificationInputForProspect(prospectId, {
                    name: seedListing.ownerName,
                    description: seedListing.description,
                    platformRegistered: seedListing.sellerRegisteredAt,
                    profileUrl: seedListing.otherListingsUrl,
                    contactChannels: seedListing.contactChannels,
                });
                if (input) {
                    await classifyAndUpdateProspect(prospectId, locationId, input);
                }
            }
        } catch (e: any) {
            console.warn(`[ListingScraper] Prospect classification skipped for ${prospectId}: ${e.message}`);
        }

        const prospect = await db.prospectLead.findUnique({
            where: { id: prospectId },
            select: {
                isAgency: true,
                agencyConfidence: true,
                isAgencyManual: true,
                phone: true,
            }
        });

        return {
            isAgency: prospect?.isAgency ?? null,
            confidence: prospect?.agencyConfidence ?? null,
            manualOverride: prospect?.isAgencyManual ?? null,
            phone: prospect?.phone ?? null,
        };
    }

    private static shouldDeepScrapePrivatePortfolio(state: ProspectClassificationState): boolean {
        if (state.manualOverride !== null && state.manualOverride !== undefined) {
            return state.manualOverride === false;
        }

        if (state.confidence === null || state.confidence === undefined) {
            return false;
        }

        if (state.confidence < 70) {
            return false;
        }

        return state.isAgency === false;
    }

    private static normalizePhoneForSellerKey(phone?: string): string | null {
        if (!phone) return null;
        const normalized = phone.replace(/[^\d+]/g, '');
        return normalized.length >= 6 ? normalized : null;
    }

    private static buildSellerProcessingKey(listing: RawListing): string | null {
        if (listing.sellerExternalId) {
            return `seller:${listing.sellerExternalId.trim()}`;
        }

        if (listing.otherListingsUrl) {
            try {
                const parsed = new URL(listing.otherListingsUrl);
                return `profile:${parsed.origin}${parsed.pathname}`;
            } catch {
                return `profile:${listing.otherListingsUrl.trim().toLowerCase()}`;
            }
        }

        const phone = this.normalizePhoneForSellerKey(listing.ownerPhone || listing.whatsappPhone);
        if (phone) {
            return `phone:${phone}`;
        }

        if (listing.ownerName) {
            const normalizedName = listing.ownerName.trim().toLowerCase();
            if (normalizedName.length >= 3) {
                return `name:${normalizedName}`;
            }
        }

        return null;
    }

    /**
     * Runs agency/private classification for all prospects touched in a scrape run.
     */
    private static async classifyTouchedProspects(locationId: string, prospectIds: string[]): Promise<void> {
        if (prospectIds.length === 0) return;

        const {
            classifyAndUpdateProspect,
            buildClassificationInputForProspect,
            shouldRunProspectClassification,
        } = await import('@/lib/ai/prospect-classifier');

        for (const prospectId of prospectIds) {
            try {
                const decision = await shouldRunProspectClassification(prospectId);
                if (!decision.shouldClassify) continue;
                const input = await buildClassificationInputForProspect(prospectId);
                if (!input) continue;
                await classifyAndUpdateProspect(prospectId, locationId, input);
            } catch (e: any) {
                console.warn(`[ListingScraper] Prospect classification skipped for ${prospectId}: ${e.message}`);
            }
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
                { lastUsedAt: 'asc' }
            ]
        });
    }

    /**
     * Upserts listing + prospect while preserving existing records and allowing richer re-scrapes.
     */
    private static async upsertListingAndProspect(
        listing: RawListing,
        task: ScrapeTaskWithConnection,
        locationId: string,
    ): Promise<UpsertListingResult> {
        const platform = task.connection.platform;

        const existingListing = await db.scrapedListing.findUnique({
            where: {
                platform_externalId: {
                    platform,
                    externalId: listing.externalId,
                }
            }
        });

        if (existingListing && existingListing.locationId !== locationId) {
            console.warn(
                `[ListingScraper] Listing ${platform}:${listing.externalId} belongs to another location (${existingListing.locationId}). Skipping.`
            );
            return {
                prospectLeadId: existingListing.prospectLeadId,
                listingCreated: false,
                listingAlreadyExisted: true,
                skippedAsDuplicateContact: true,
                isRealEstate: true,
                relevanceSource: 'cached',
                relevanceConfidence: 100,
            };
        }

        const existingRawAttributes = (
            existingListing?.rawAttributes && typeof existingListing.rawAttributes === 'object'
                ? existingListing.rawAttributes
                : null
        ) as Record<string, string> | null;

        const relevanceDecision = await classifyListingRelevance(listing, existingRawAttributes);
        const relevanceAttributes = buildListingRelevanceRawAttributes(relevanceDecision);
        const shouldAttachProspect = relevanceDecision.isRealEstate || Boolean(task.targetProspectId) || Boolean(existingListing?.prospectLeadId);

        const isProspectBoundTask = Boolean(task.targetProspectId);

        if (!existingListing && !isProspectBoundTask && (listing.ownerPhone || listing.ownerEmail)) {
            const orConditions: any[] = [];
            if (listing.ownerPhone) orConditions.push({ phone: { contains: listing.ownerPhone } });
            if (listing.ownerEmail) orConditions.push({ email: listing.ownerEmail });

            if (orConditions.length > 0) {
                const existingContact = await db.contact.findFirst({
                    where: {
                        locationId,
                        OR: orConditions,
                    }
                });

                if (existingContact) {
                    console.log(`[ListingScraper] Found duplicate existing contact (${existingContact.id}) for raw phone/email.`);
                    return {
                        prospectLeadId: null,
                        listingCreated: false,
                        listingAlreadyExisted: false,
                        skippedAsDuplicateContact: true,
                        isRealEstate: relevanceDecision.isRealEstate,
                        relevanceSource: relevanceDecision.source,
                        relevanceConfidence: relevanceDecision.confidence,
                    };
                }
            }
        }

        let prospect = null as any;

        if (shouldAttachProspect) {
            if (task.targetProspectId) {
                prospect = await db.prospectLead.findUnique({ where: { id: task.targetProspectId } });
            }

            if (!prospect && existingListing?.prospectLeadId) {
                prospect = await db.prospectLead.findUnique({ where: { id: existingListing.prospectLeadId } });
            }

            if (!prospect && (listing.ownerPhone || listing.ownerEmail || listing.sellerExternalId)) {
                if (listing.sellerExternalId) {
                    prospect = await db.prospectLead.findFirst({
                        where: { locationId, platformUserId: listing.sellerExternalId }
                    });
                }

                if (!prospect && listing.ownerEmail) {
                    prospect = await db.prospectLead.findFirst({
                        where: { locationId, email: listing.ownerEmail }
                    });
                }

                if (!prospect && listing.ownerPhone) {
                    prospect = await db.prospectLead.findFirst({
                        where: { locationId, phone: { contains: listing.ownerPhone } }
                    });
                }
            }

            if (!prospect && (listing.ownerPhone || listing.ownerEmail || listing.sellerExternalId)) {
                prospect = await db.prospectLead.create({
                    data: {
                        locationId,
                        source: 'scraper_bot',
                        name: listing.ownerName || null,
                        phone: listing.ownerPhone || listing.whatsappPhone || null,
                        email: listing.ownerEmail || null,
                        status: 'new',
                        isAgency: false,
                        platformUserId: listing.sellerExternalId,
                        platformRegistered: listing.sellerRegisteredAt,
                        profileUrl: listing.otherListingsUrl || null,
                        listingCount: listing.otherListingsCount ?? null,
                    }
                });
            } else if (prospect) {
                const updateData: any = {};

                if (listing.ownerName && (!prospect.name || prospect.name === 'Bazaraki Owner')) {
                    updateData.name = listing.ownerName;
                }

                const bestPhone = listing.ownerPhone || listing.whatsappPhone;
                if (bestPhone && !prospect.phone) {
                    updateData.phone = bestPhone;
                }

                if (listing.ownerEmail && !prospect.email) {
                    updateData.email = listing.ownerEmail;
                }

                if (listing.sellerExternalId && !prospect.platformUserId) {
                    updateData.platformUserId = listing.sellerExternalId;
                }

                if (listing.sellerRegisteredAt && !prospect.platformRegistered) {
                    updateData.platformRegistered = listing.sellerRegisteredAt;
                }

                if (
                    listing.otherListingsUrl &&
                    (!prospect.profileUrl || prospect.profileUrl !== listing.otherListingsUrl)
                ) {
                    updateData.profileUrl = listing.otherListingsUrl;
                }

                if (listing.otherListingsCount && (prospect.listingCount || 0) < listing.otherListingsCount) {
                    updateData.listingCount = listing.otherListingsCount;
                }

                if (Object.keys(updateData).length > 0) {
                    prospect = await db.prospectLead.update({ where: { id: prospect.id }, data: updateData });
                }
            }
        }

        const prospectLeadId = prospect?.id || null;
        const normalizedTitle = listing.title && listing.title.trim().toLowerCase() !== 'no title'
            ? listing.title.trim()
            : null;
        const normalizedDescription = listing.description && listing.description.trim().length > 0
            ? listing.description.trim()
            : null;
        const normalizedLocation = listing.location && listing.location.trim().toLowerCase() !== 'cyprus'
            ? listing.location.trim()
            : null;
        const normalizedPrice = typeof listing.price === 'number' && listing.price > 0
            ? listing.price
            : null;
        const mergedContactChannels = Array.from(
            new Set([...(existingListing?.contactChannels || []), ...(listing.contactChannels || [])])
        );
        const mergedRawAttributes = listing.rawAttributes
            ? {
                ...(existingRawAttributes || {}),
                ...listing.rawAttributes,
                ...relevanceAttributes,
            }
            : {
                ...(existingRawAttributes || {}),
                ...relevanceAttributes,
            };
        const normalizedStatus = existingListing?.status?.toUpperCase?.() || null;
        const resolvedExistingStatus = relevanceDecision.isRealEstate
            ? (normalizedStatus === 'SKIPPED' ? 'NEW' : (existingListing?.status || 'NEW'))
            : (normalizedStatus === 'IMPORTED' || normalizedStatus === 'REJECTED'
                ? (existingListing?.status || 'SKIPPED')
                : 'SKIPPED');

        if (existingListing) {
            await db.scrapedListing.update({
                where: { id: existingListing.id },
                data: {
                    url: listing.url || existingListing.url,
                    title: normalizedTitle || existingListing.title,
                    description: normalizedDescription || existingListing.description,
                    price: normalizedPrice ?? existingListing.price,
                    currency: listing.currency || existingListing.currency,
                    propertyType: listing.propertyType || existingListing.propertyType,
                    listingType: listing.listingType || existingListing.listingType,
                    locationText: normalizedLocation || existingListing.locationText,
                    images: listing.images && listing.images.length > 0 ? listing.images : existingListing.images,
                    thumbnails: listing.thumbnails && listing.thumbnails.length > 0 ? listing.thumbnails : existingListing.thumbnails,
                    bedrooms: listing.bedrooms ?? existingListing.bedrooms,
                    bathrooms: listing.bathrooms ?? existingListing.bathrooms,
                    propertyArea: listing.propertyArea ?? existingListing.propertyArea,
                    plotArea: listing.plotArea ?? existingListing.plotArea,
                    constructionYear: listing.constructionYear ?? existingListing.constructionYear,
                    latitude: listing.latitude ?? existingListing.latitude,
                    longitude: listing.longitude ?? existingListing.longitude,
                    sellerExternalId: listing.sellerExternalId || existingListing.sellerExternalId,
                    sellerRegisteredAt: listing.sellerRegisteredAt || existingListing.sellerRegisteredAt,
                    otherListingsUrl: listing.otherListingsUrl || existingListing.otherListingsUrl,
                    otherListingsCount: listing.otherListingsCount ?? existingListing.otherListingsCount,
                    contactChannels: mergedContactChannels,
                    whatsappPhone: listing.whatsappPhone || existingListing.whatsappPhone,
                    rawAttributes: mergedRawAttributes as any,
                    status: resolvedExistingStatus,
                    prospectLeadId: prospectLeadId || existingListing.prospectLeadId,
                }
            });

            return {
                prospectLeadId: prospectLeadId || existingListing.prospectLeadId,
                listingCreated: false,
                listingAlreadyExisted: true,
                skippedAsDuplicateContact: false,
                isRealEstate: relevanceDecision.isRealEstate,
                relevanceSource: relevanceDecision.source,
                relevanceConfidence: relevanceDecision.confidence,
            };
        }

        await db.scrapedListing.create({
            data: {
                locationId,
                platform,
                externalId: listing.externalId,
                url: listing.url,
                title: normalizedTitle,
                description: normalizedDescription,
                price: normalizedPrice,
                currency: listing.currency || 'EUR',
                propertyType: listing.propertyType || null,
                listingType: listing.listingType || null,
                locationText: normalizedLocation,
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
                otherListingsCount: listing.otherListingsCount,
                contactChannels: listing.contactChannels || [],
                whatsappPhone: listing.whatsappPhone,
                rawAttributes: mergedRawAttributes as any,
                status: relevanceDecision.isRealEstate ? 'NEW' : 'SKIPPED',
                prospectLeadId,
            }
        });

        return {
            prospectLeadId,
            listingCreated: true,
            listingAlreadyExisted: false,
            skippedAsDuplicateContact: false,
            isRealEstate: relevanceDecision.isRealEstate,
            relevanceSource: relevanceDecision.source,
            relevanceConfidence: relevanceDecision.confidence,
        };
    }
}
