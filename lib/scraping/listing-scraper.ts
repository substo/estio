import db from '@/lib/db';
import { ScrapingTask, ScrapingConnection, ScrapingCredential } from '@prisma/client';
import { PageFetcher } from './page-fetcher';
import {
    buildListingRelevanceRawAttributes,
    classifyListingRelevance,
} from './listing-relevance-classifier';
import {
    buildCrawlVisitKey,
    normalizeTargetUrls,
    normalizeUrlForPlatform,
} from './url-utils';

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
    prospectCreated: boolean;
    prospectMatched: boolean;
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

interface ScrapeTriggerContext {
    source?: 'manual' | 'scheduled' | 'system';
    initiatedByUserId?: string;
    queueJobId?: string;
    queuedAt?: string;
}

interface ScrapeTaskOptions {
    pageLimit?: number;
    triggerContext?: ScrapeTriggerContext;
}

export class ListingScraperService {

    /**
     * Main entry point to scrape a specific task configuration
     */
    static async scrapeTask(task: ScrapeTaskWithConnection, options?: ScrapeTaskOptions) {
        console.log(`[ListingScraper] Starting scrape for task: ${task.name} (${task.id}) with options:`, options);

        let initialInteractionsBudget = task.maxInteractionsPerRun ?? Number.MAX_SAFE_INTEGER;
        const dailyLimit = task.connection.maxDailyInteractions || 100;
        if (initialInteractionsBudget > dailyLimit) initialInteractionsBudget = dailyLimit;
        const isStrategicFlow = this.shouldUseStrategicContactFlow(task);
        const runMetadataBase = {
            trigger: {
                source: options?.triggerContext?.source || 'system',
                initiatedByUserId: options?.triggerContext?.initiatedByUserId || null,
                queueJobId: options?.triggerContext?.queueJobId || null,
                queuedAt: options?.triggerContext?.queuedAt || null,
            },
            flow: isStrategicFlow ? 'strategic_contact_first' : 'standard',
            pageLimitRequested: options?.pageLimit ?? null,
            scrapeStrategy: task.scrapeStrategy,
            targetSellerType: task.targetSellerType,
            targetUrlsCount: task.targetUrls?.length || 0,
            interactionBudget: {
                initial: initialInteractionsBudget,
                dailyLimit,
                maxPerRun: task.maxInteractionsPerRun ?? null,
            },
            startedAt: new Date().toISOString(),
        };

        // 1. Create a run record
        const run = await db.scrapingRun.create({
            data: {
                taskId: task.id,
                status: 'running',
                metadata: runMetadataBase,
            }
        });

        const activeCredential = await this.checkoutCredential(task.connection.id);

        if (!activeCredential) {
            console.warn(`[ListingScraper] No active credentials available for connection pool ${task.connection.id}. Failing task gracefully.`);
            await db.scrapingRun.update({
                where: { id: run.id },
                data: {
                    status: 'failed',
                    errorLog: 'No active credentials available in the platform pool.',
                    completedAt: new Date(),
                    metadata: {
                        ...runMetadataBase,
                        failedAt: new Date().toISOString(),
                        errorCategory: 'auth',
                    }
                }
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

        let interactionsRemaining = initialInteractionsBudget;

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

                const urlsToScrape = normalizeTargetUrls(task.targetUrls, task.connection.platform);

                for (const rootUrl of urlsToScrape) {
                    console.log(`[ListingScraper] Fetching tree starting at: ${rootUrl}`);

                    let currentUrl: string | undefined = normalizeUrlForPlatform(rootUrl, task.connection.platform);
                    let pageCount = 0;
                    const maxDepth = options?.pageLimit ?? task.maxPagesPerRun ?? 100;
                    const visitedPageUrls = new Set<string>();

                    while (currentUrl && interactionsRemaining > 0 && pageCount < maxDepth) {
                        const normalizedCurrentUrl = normalizeUrlForPlatform(currentUrl, task.connection.platform);
                        if (!normalizedCurrentUrl) break;

                        const currentVisitKey = buildCrawlVisitKey(normalizedCurrentUrl);
                        if (visitedPageUrls.has(currentVisitKey)) {
                            console.log(`[ListingScraper] Pagination loop detected for ${normalizedCurrentUrl}. Stopping this root URL.`);
                            break;
                        }
                        visitedPageUrls.add(currentVisitKey);

                        pageCount++;
                        console.log(`[ListingScraper] Fetching page ${pageCount}: ${normalizedCurrentUrl}`);

                        const content = await fetcher.fetchContent({
                            url: normalizedCurrentUrl,
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
                            const extractionResult = await extractBazarakiIndex(content, normalizedCurrentUrl, fetcher, {
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

                        const normalizedNextPageUrl = normalizeUrlForPlatform(nextPageUrl, task.connection.platform);
                        if (!normalizedNextPageUrl) {
                            console.log('[ListingScraper] Next page URL was empty after normalization. Stopping this root URL.');
                            break;
                        }
                        const nextVisitKey = buildCrawlVisitKey(normalizedNextPageUrl);
                        if (visitedPageUrls.has(nextVisitKey)) {
                            console.log(`[ListingScraper] Pagination loop detected at next page ${normalizedNextPageUrl}. Stopping this root URL.`);
                            break;
                        }

                        console.log(`[ListingScraper] Pagination sleep before jumping to ${nextPageUrl}`);
                        await humanDelay(task.delayBetweenPagesMs, task.delayJitterMs);

                        currentUrl = normalizedNextPageUrl;
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

            const completedAt = new Date();
            const interactionsUsed = Math.max(0, initialInteractionsBudget - interactionsRemaining);
            const runStatus = counters.errors > 0 ? 'partial' : 'completed';

            await db.scrapingRun.update({
                where: { id: run.id },
                data: {
                    status: runStatus,
                    completedAt,
                    pagesScraped: counters.pagesScraped,
                    listingsFound: counters.listingsFound,
                    leadsCreated: counters.leadsCreated,
                    duplicatesFound: counters.duplicatesFound,
                    errors: counters.errors,
                    metadata: {
                        ...runMetadataBase,
                        completedAt: completedAt.toISOString(),
                        interactionsUsed,
                        interactionsRemaining,
                        pagesScraped: counters.pagesScraped,
                        listingsFound: counters.listingsFound,
                        leadsCreated: counters.leadsCreated,
                        duplicatesFound: counters.duplicatesFound,
                        errors: counters.errors,
                    },
                }
            });

            await db.scrapingTask.update({
                where: { id: task.id },
                data: {
                    lastSyncAt: completedAt,
                    lastSyncStatus: runStatus === 'completed' ? 'success' : 'partial',
                    lastSyncError: runStatus === 'completed' ? null : `${counters.errors} non-fatal errors during last run`,
                    lastSyncStats: {
                        pagesScraped: counters.pagesScraped,
                        listingsFound: counters.listingsFound,
                        leadsCreated: counters.leadsCreated,
                        duplicatesFound: counters.duplicatesFound,
                        errors: counters.errors,
                        interactionsUsed,
                        interactionsRemaining,
                    }
                }
            });

            return counters;

        } catch (error: any) {
            console.error(`[ListingScraper] Task ${task.id} failed deeply:`, error);

            const failedAt = new Date();
            const interactionsUsed = Math.max(0, initialInteractionsBudget - interactionsRemaining);

            await db.scrapingRun.update({
                where: { id: run.id },
                data: {
                    status: 'failed',
                    completedAt: failedAt,
                    errorLog: error.message,
                    pagesScraped: counters.pagesScraped,
                    listingsFound: counters.listingsFound,
                    leadsCreated: counters.leadsCreated,
                    duplicatesFound: counters.duplicatesFound,
                    errors: counters.errors,
                    metadata: {
                        ...runMetadataBase,
                        failedAt: failedAt.toISOString(),
                        interactionsUsed,
                        interactionsRemaining,
                        errorCategory: this.categorizeRunError(error),
                        errorName: error?.name || null,
                    }
                }
            });

            await db.scrapingTask.update({
                where: { id: task.id },
                data: {
                    lastSyncAt: failedAt,
                    lastSyncStatus: 'failed',
                    lastSyncError: error.message,
                    lastSyncStats: {
                        pagesScraped: counters.pagesScraped,
                        listingsFound: counters.listingsFound,
                        leadsCreated: counters.leadsCreated,
                        duplicatesFound: counters.duplicatesFound,
                        errors: counters.errors,
                        interactionsUsed,
                        interactionsRemaining,
                    }
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

    private static categorizeRunError(error: any): string {
        const message = String(error?.message || '').toLowerCase();
        if (!message) return 'unknown';
        const hasAuthSignal = /\b(auth|authorization|unauthorized|forbidden|credential|credentials|session|token|cookie|login)\b/.test(message);
        if (hasAuthSignal) return 'auth';
        if (message.includes('invalid url') || message.includes('cannot navigate')) return 'extraction';
        if (message.includes('timeout')) return 'timeout';
        if (message.includes('429') || message.includes('rate limit') || message.includes('too many requests')) return 'rate_limit';
        if (message.includes('network') || message.includes('econn') || message.includes('fetch')) return 'network';
        if (message.includes('selector') || message.includes('extract')) return 'extraction';
        return 'unknown';
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

        const urlsToScrape = normalizeTargetUrls(task.targetUrls, task.connection.platform);
        const seedListings = new Map<string, RawListing>();
        const discoveredExternalIds = new Set<string>();
        const processedSellerKeys = new Set<string>();

        for (const rootUrl of urlsToScrape) {
            let currentUrl: string | undefined = normalizeUrlForPlatform(rootUrl, task.connection.platform);
            let pageCount = 0;
            const maxDepth = options?.pageLimit ?? task.maxPagesPerRun ?? 100;
            const visitedPageUrls = new Set<string>();

            while (currentUrl && pageCount < maxDepth) {
                const normalizedCurrentUrl = normalizeUrlForPlatform(currentUrl, task.connection.platform);
                if (!normalizedCurrentUrl) break;

                const currentVisitKey = buildCrawlVisitKey(normalizedCurrentUrl);
                if (visitedPageUrls.has(currentVisitKey)) {
                    console.log(`[ListingScraper][Strategic] Pagination loop detected for ${normalizedCurrentUrl}. Stopping this root URL.`);
                    break;
                }
                visitedPageUrls.add(currentVisitKey);

                pageCount++;
                console.log(`[ListingScraper][Strategic] Index page ${pageCount}: ${normalizedCurrentUrl}`);

                const content = await fetcher.fetchContent({
                    url: normalizedCurrentUrl,
                    username: activeCredential.authUsername || undefined,
                    password: activeCredential.authPassword || undefined,
                    sessionState: activeCredential.sessionState ? activeCredential.sessionState : undefined,
                });

                counters.pagesScraped++;

                const extractionResult = await extractBazarakiIndex(content, normalizedCurrentUrl, fetcher, {
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
                const normalizedNextPageUrl = normalizeUrlForPlatform(extractionResult.nextPageUrl, task.connection.platform);
                if (!normalizedNextPageUrl) break;
                if (visitedPageUrls.has(buildCrawlVisitKey(normalizedNextPageUrl))) {
                    console.log(`[ListingScraper][Strategic] Pagination loop detected at next page ${normalizedNextPageUrl}. Stopping this root URL.`);
                    break;
                }
                await humanDelay(task.delayBetweenPagesMs, task.delayJitterMs);
                currentUrl = normalizedNextPageUrl;
            }
        }

        const assignedToProcessedSeller = new Set<string>();

        for (const seed of seedListings.values()) {
            if (assignedToProcessedSeller.has(seed.externalId)) continue;
            const seedSellerKeys = this.collectSellerProcessingKeys(seed);
            if (seedSellerKeys.some((key) => processedSellerKeys.has(key))) continue;

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
                for (const sellerKey of this.collectSellerProcessingKeys(seedListing, seedSave.prospectLeadId)) {
                    processedSellerKeys.add(sellerKey);
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
                        for (const sellerKey of this.collectSellerProcessingKeys(listingWithSellerContext, portfolioSave.prospectLeadId)) {
                            processedSellerKeys.add(sellerKey);
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

    static async collectBazarakiPortfolioListings(params: {
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
        let currentUrl: string | undefined = normalizeUrlForPlatform(profileUrl, task.connection.platform);
        let pageCount = 0;
        const maxDepth = Math.max(1, options?.pageLimit ?? task.maxPagesPerRun ?? 10);
        const visitedPageUrls = new Set<string>();

        while (currentUrl && pageCount < maxDepth) {
            const normalizedCurrentUrl = normalizeUrlForPlatform(currentUrl, task.connection.platform);
            if (!normalizedCurrentUrl) break;

            const currentVisitKey = buildCrawlVisitKey(normalizedCurrentUrl);
            if (visitedPageUrls.has(currentVisitKey)) {
                console.log(`[ListingScraper][Strategic] Seller profile pagination loop detected for ${normalizedCurrentUrl}. Stopping profile crawl.`);
                break;
            }
            visitedPageUrls.add(currentVisitKey);

            pageCount++;
            console.log(`[ListingScraper][Strategic] Seller profile page ${pageCount}: ${normalizedCurrentUrl}`);

            const content = await fetcher.fetchContent({
                url: normalizedCurrentUrl,
                username: activeCredential.authUsername || undefined,
                password: activeCredential.authPassword || undefined,
                sessionState: activeCredential.sessionState ? activeCredential.sessionState : undefined,
            });

            pagesScraped++;

            const extractionResult = await extractBazarakiIndex(content, normalizedCurrentUrl, fetcher, {
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

            const normalizedNextPageUrl = normalizeUrlForPlatform(extractionResult.nextPageUrl, task.connection.platform);
            if (!normalizedNextPageUrl) break;
            if (visitedPageUrls.has(buildCrawlVisitKey(normalizedNextPageUrl))) {
                console.log(`[ListingScraper][Strategic] Seller profile pagination loop detected at ${normalizedNextPageUrl}. Stopping profile crawl.`);
                break;
            }

            await humanDelay(task.delayBetweenPagesMs, task.delayJitterMs);
            currentUrl = normalizedNextPageUrl;
        }

        return {
            pagesScraped,
            listings: Array.from(listings.values()),
        };
    }

    static async ensureProspectClassification(
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

    static shouldDeepScrapePrivatePortfolio(state: ProspectClassificationState): boolean {
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

    static buildSellerProcessingKey(listing: RawListing): string | null {
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

    static collectSellerProcessingKeys(
        listing: RawListing,
        prospectLeadId?: string | null,
    ): string[] {
        const keys = new Set<string>();

        const primaryKey = this.buildSellerProcessingKey(listing);
        if (primaryKey) keys.add(primaryKey);

        if (listing.sellerExternalId) {
            const normalizedSellerId = listing.sellerExternalId.trim();
            if (normalizedSellerId) keys.add(`seller:${normalizedSellerId}`);
        }

        if (listing.otherListingsUrl) {
            const normalizedProfileUrl = normalizeUrlForPlatform(listing.otherListingsUrl, 'bazaraki');
            if (normalizedProfileUrl) {
                try {
                    const parsed = new URL(normalizedProfileUrl);
                    const pathname = parsed.pathname.length > 1
                        ? parsed.pathname.replace(/\/+$/, '')
                        : parsed.pathname;
                    keys.add(`profile:${parsed.origin}${pathname}`);
                } catch {
                    keys.add(`profile:${normalizedProfileUrl.toLowerCase()}`);
                }
            }
        }

        const normalizedPhone = this.normalizePhoneForSellerKey(listing.ownerPhone || listing.whatsappPhone);
        if (normalizedPhone) keys.add(`phone:${normalizedPhone}`);

        if (listing.ownerName) {
            const normalizedName = listing.ownerName.trim().toLowerCase();
            if (normalizedName.length >= 3) {
                keys.add(`name:${normalizedName}`);
                if (normalizedPhone) {
                    keys.add(`name_phone:${normalizedName}:${normalizedPhone}`);
                }
            }
        }

        if (prospectLeadId) {
            keys.add(`prospect:${prospectLeadId}`);
        }

        return Array.from(keys);
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
    static async checkoutCredential(connectionId: string): Promise<ScrapingCredential | null> {
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
    static async upsertListingAndProspect(
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
                prospectCreated: false,
                prospectMatched: false,
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
                        prospectCreated: false,
                        prospectMatched: false,
                        isRealEstate: relevanceDecision.isRealEstate,
                        relevanceSource: relevanceDecision.source,
                        relevanceConfidence: relevanceDecision.confidence,
                    };
                }
            }
        }

        let prospect = null as any;
        let prospectCreated = false;
        let prospectMatched = false;

        if (shouldAttachProspect) {
            if (task.targetProspectId) {
                prospect = await db.prospectLead.findUnique({ where: { id: task.targetProspectId } });
                if (prospect) prospectMatched = true;
            }

            if (!prospect && existingListing?.prospectLeadId) {
                prospect = await db.prospectLead.findUnique({ where: { id: existingListing.prospectLeadId } });
                if (prospect) prospectMatched = true;
            }

            if (!prospect && (listing.ownerPhone || listing.ownerEmail || listing.sellerExternalId)) {
                if (listing.sellerExternalId) {
                    prospect = await db.prospectLead.findFirst({
                        where: { locationId, platformUserId: listing.sellerExternalId }
                    });
                    if (prospect) prospectMatched = true;
                }

                if (!prospect && listing.ownerEmail) {
                    prospect = await db.prospectLead.findFirst({
                        where: { locationId, email: listing.ownerEmail }
                    });
                    if (prospect) prospectMatched = true;
                }

                if (!prospect && listing.ownerPhone) {
                    prospect = await db.prospectLead.findFirst({
                        where: { locationId, phone: { contains: listing.ownerPhone } }
                    });
                    if (prospect) prospectMatched = true;
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
                prospectCreated = true;
            } else if (prospect) {
                prospectMatched = true;
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
                prospectCreated,
                prospectMatched,
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
            prospectCreated,
            prospectMatched,
            isRealEstate: relevanceDecision.isRealEstate,
            relevanceSource: relevanceDecision.source,
            relevanceConfidence: relevanceDecision.confidence,
        };
    }
}
