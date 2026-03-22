import db from '@/lib/db';
import { PageFetcher } from './page-fetcher';
import {
    ListingScraperService,
    type RawListing,
    type ScrapeTaskWithConnection,
} from './listing-scraper';
import { extractBazarakiIndex, deepScrapeBazarakiListing } from './extractors/bazaraki';
import {
    DEFAULT_PRIVATE_CONFIDENCE_THRESHOLD,
    type DeepScrapeConfigSnapshot,
    type DeepScrapeRunSummary,
    type DeepScrapeStageLog,
    type OmissionReason,
    type StageReasonCode,
    type DeepScrapeErrorCategory,
    createEmptyDeepScrapeRunSummary,
    categorizeScrapeError,
    errorCategoryToSummaryKey,
    omissionReasonToSummaryKey,
    resolveProspectDeepDecision,
} from './deep-scrape-types';

const DEFAULT_MAX_SEED_LISTINGS_PER_TASK = 50;

const humanDelay = async (baseMs: number, jitterMs: number) => {
    const offset = Math.floor(Math.random() * (jitterMs * 2 + 1)) - jitterMs;
    const finalDelay = Math.max(500, baseMs + offset);
    await new Promise((resolve) => setTimeout(resolve, finalDelay));
};

const normalizePhone = (value?: string | null): string | null => {
    if (!value) return null;
    const normalized = value.replace(/[^\d+]/g, '');
    return normalized.length >= 6 ? normalized : null;
};

interface DeepScrapeTriggerContext {
    source?: 'manual' | 'scheduled' | 'system';
    initiatedByUserId?: string;
    queueJobId?: string;
    queuedAt?: string;
}

interface DeepScrapeOrchestratorOptions {
    maxSeedListingsPerTask: number;
    privateConfidenceThreshold: number;
    requirePhoneForPortfolio: boolean;
}

interface ProcessDeepScrapeRequest {
    limit?: number;
    configSnapshot?: Partial<DeepScrapeConfigSnapshot>;
    triggerContext?: DeepScrapeTriggerContext;
}

interface CrawlSeedResult {
    seedListings: RawListing[];
    rootUrlsProcessed: number;
    pagesScraped: number;
    seedListingsFound: number;
    seedListingsDuplicate: number;
}

const mergeSellerContext = (seedListing: RawListing, portfolioListing: RawListing): RawListing => ({
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
});

function buildDefaultConfigSnapshot(
    limit: number,
    override?: Partial<DeepScrapeConfigSnapshot>,
): DeepScrapeConfigSnapshot {
    return {
        version: override?.version || 'manual_deep_orchestrator_v1',
        maxSeedListingsPerTask: override?.maxSeedListingsPerTask ?? limit,
        privateConfidenceThreshold: override?.privateConfidenceThreshold ?? DEFAULT_PRIVATE_CONFIDENCE_THRESHOLD,
        requirePhoneForPortfolio: override?.requirePhoneForPortfolio ?? true,
        scope: {
            platform: 'bazaraki',
            enabledTasksOnly: override?.scope?.enabledTasksOnly ?? true,
            targetUrlsRequired: override?.scope?.targetUrlsRequired ?? true,
        },
    };
}

function buildOrchestratorOptions(
    limit?: number,
    snapshot?: Partial<DeepScrapeConfigSnapshot>,
): DeepScrapeOrchestratorOptions {
    const safeLimit = Number.isFinite(limit)
        ? Math.max(1, Math.min(500, Math.floor(limit as number)))
        : DEFAULT_MAX_SEED_LISTINGS_PER_TASK;

    return {
        maxSeedListingsPerTask: snapshot?.maxSeedListingsPerTask ?? safeLimit,
        privateConfidenceThreshold: snapshot?.privateConfidenceThreshold ?? DEFAULT_PRIVATE_CONFIDENCE_THRESHOLD,
        requirePhoneForPortfolio: snapshot?.requirePhoneForPortfolio ?? true,
    };
}

function addOmission(summary: DeepScrapeRunSummary, reason: OmissionReason, amount = 1) {
    const key = omissionReasonToSummaryKey(reason);
    summary[key] += amount;
}

function addError(summary: DeepScrapeRunSummary, category: DeepScrapeErrorCategory, amount = 1) {
    const key = errorCategoryToSummaryKey(category);
    summary[key] += amount;
    summary.errorsTotal += amount;
}

function applyTaskCountersToRun(run: DeepScrapeRunSummary, task: DeepScrapeRunSummary) {
    run.rootUrlsProcessed += task.rootUrlsProcessed;
    run.indexPagesScraped += task.indexPagesScraped;
    run.seedListingsFound += task.seedListingsFound;
    run.seedListingsNew += task.seedListingsNew;
    run.seedListingsDuplicate += task.seedListingsDuplicate;
    run.prospectsCreated += task.prospectsCreated;
    run.prospectsMatched += task.prospectsMatched;
    run.contactsWithPhone += task.contactsWithPhone;
    run.contactsWithoutPhone += task.contactsWithoutPhone;
    run.sellerPortfoliosDiscovered += task.sellerPortfoliosDiscovered;
    run.portfolioListingsDeepScraped += task.portfolioListingsDeepScraped;
    run.omittedAgency += task.omittedAgency;
    run.omittedUncertain += task.omittedUncertain;
    run.omittedMissingPhone += task.omittedMissingPhone;
    run.omittedNonRealEstate += task.omittedNonRealEstate;
    run.omittedDuplicate += task.omittedDuplicate;
    run.omittedBudgetExhausted += task.omittedBudgetExhausted;
    run.errorsAuth += task.errorsAuth;
    run.errorsNetwork += task.errorsNetwork;
    run.errorsExtraction += task.errorsExtraction;
    run.errorsUnknown += task.errorsUnknown;
    run.errorsTotal += task.errorsTotal;
}

export class DeepScrapeOrchestratorService {
    static async processLocation(
        locationId: string,
        request?: ProcessDeepScrapeRequest,
    ) {
        const options = buildOrchestratorOptions(request?.limit, request?.configSnapshot);
        const configSnapshot = buildDefaultConfigSnapshot(options.maxSeedListingsPerTask, request?.configSnapshot);
        const trigger = request?.triggerContext;

        const run = await db.deepScrapeRun.create({
            data: {
                locationId,
                status: 'running',
                triggeredBy: trigger?.source || 'system',
                triggeredByUserId: trigger?.initiatedByUserId || null,
                queueJobId: trigger?.queueJobId || null,
                queuedAt: trigger?.queuedAt ? new Date(trigger.queuedAt) : null,
                startedAt: new Date(),
                configSnapshot: configSnapshot as any,
                metadata: {
                    trigger: {
                        source: trigger?.source || 'system',
                        initiatedByUserId: trigger?.initiatedByUserId || null,
                        queueJobId: trigger?.queueJobId || null,
                        queuedAt: trigger?.queuedAt || null,
                    },
                    flow: 'manual_deep_orchestrator',
                    options,
                } as any,
            },
        });

        const runSummary = createEmptyDeepScrapeRunSummary();

        try {
            const tasks = await db.scrapingTask.findMany({
                where: {
                    locationId,
                    enabled: true,
                    targetUrls: { isEmpty: false },
                    connection: {
                        enabled: true,
                        platform: 'bazaraki',
                    },
                },
                include: {
                    connection: true,
                },
                orderBy: { createdAt: 'desc' },
            });

            runSummary.tasksScanned = tasks.length;

            await this.logStage(run.id, locationId, {
                stage: 'run_started',
                status: 'info',
                message: `Deep orchestration started for ${tasks.length} eligible task(s).`,
                counters: {
                    tasksScanned: tasks.length,
                },
                metadata: {
                    configSnapshot,
                },
            });

            if (tasks.length === 0) {
                const completedAt = new Date();
                await db.deepScrapeRun.update({
                    where: { id: run.id },
                    data: {
                        status: 'completed',
                        completedAt,
                        ...runSummary,
                    },
                });

                await this.logStage(run.id, locationId, {
                    stage: 'run_completed',
                    status: 'success',
                    message: 'No eligible tasks found. Run completed.',
                    counters: {
                        tasksScanned: 0,
                    },
                });

                return {
                    runId: run.id,
                    status: 'completed',
                    ...runSummary,
                };
            }

            for (const task of tasks) {
                const taskSummary = createEmptyDeepScrapeRunSummary();
                runSummary.tasksStarted += 1;

                await this.logStage(run.id, locationId, {
                    taskId: task.id,
                    stage: 'task_started',
                    status: 'info',
                    message: `Task "${task.name}" started.`,
                    metadata: {
                        taskId: task.id,
                        taskName: task.name,
                        connectionId: task.connectionId,
                    },
                });

                const activeCredential = await ListingScraperService.checkoutCredential(task.connection.id);
                if (!activeCredential) {
                    runSummary.tasksSkipped += 1;
                    await this.logStage(run.id, locationId, {
                        taskId: task.id,
                        stage: 'task_skipped',
                        status: 'skipped',
                        reasonCode: 'task_config_ineligible',
                        message: `Task "${task.name}" skipped: no active credential available.`,
                    });
                    continue;
                }

                let initialInteractionsBudget = task.maxInteractionsPerRun ?? Number.MAX_SAFE_INTEGER;
                const dailyLimit = task.connection.maxDailyInteractions || 100;
                if (initialInteractionsBudget > dailyLimit) initialInteractionsBudget = dailyLimit;
                let interactionsRemaining = initialInteractionsBudget;

                const fetcher = new PageFetcher();
                const processedSellerKeys = new Set<string>();
                const seenContactsWithPhone = new Set<string>();
                const seenContactsWithoutPhone = new Set<string>();

                try {
                    const crawlResult = await this.crawlSeedListings(task as ScrapeTaskWithConnection, activeCredential, fetcher);

                    taskSummary.rootUrlsProcessed += crawlResult.rootUrlsProcessed;
                    taskSummary.indexPagesScraped += crawlResult.pagesScraped;
                    taskSummary.seedListingsFound += crawlResult.seedListingsFound;
                    taskSummary.seedListingsNew += crawlResult.seedListings.length;
                    taskSummary.seedListingsDuplicate += crawlResult.seedListingsDuplicate;

                    await this.logStage(run.id, locationId, {
                        taskId: task.id,
                        stage: 'stage_a_crawl_completed',
                        status: 'success',
                        message: `Stage A completed for task "${task.name}".`,
                        counters: {
                            rootUrlsProcessed: crawlResult.rootUrlsProcessed,
                            indexPagesScraped: crawlResult.pagesScraped,
                            seedListingsFound: crawlResult.seedListingsFound,
                            seedListingsNew: crawlResult.seedListings.length,
                            seedListingsDuplicate: crawlResult.seedListingsDuplicate,
                        },
                    });

                    let seedProcessed = 0;

                    for (const seed of crawlResult.seedListings) {
                        if (seedProcessed >= options.maxSeedListingsPerTask) {
                            break;
                        }
                        seedProcessed += 1;

                        const baseSellerKey = ListingScraperService.buildSellerProcessingKey(seed) || `seed:${seed.externalId}`;
                        if (processedSellerKeys.has(baseSellerKey)) {
                            addOmission(taskSummary, 'duplicate');
                            await this.logStage(run.id, locationId, {
                                taskId: task.id,
                                stage: 'stage_b_seed_skipped',
                                status: 'skipped',
                                reasonCode: 'duplicate_listing',
                                message: 'Seed listing skipped due to seller-level dedupe.',
                                metadata: { listingUrl: seed.url, externalId: seed.externalId },
                            });
                            continue;
                        }

                        if (interactionsRemaining <= 0) {
                            addOmission(taskSummary, 'budget_exhausted');
                            await this.logStage(run.id, locationId, {
                                taskId: task.id,
                                stage: 'stage_b_seed_skipped',
                                status: 'skipped',
                                reasonCode: 'interaction_budget_exhausted',
                                message: 'Seed listing skipped due to exhausted interaction budget.',
                                metadata: { listingUrl: seed.url, externalId: seed.externalId },
                            });
                            continue;
                        }

                        let seedListing = seed;
                        try {
                            const deepSeed = await deepScrapeBazarakiListing(seed, fetcher, {
                                sellerType: 'all',
                            });
                            seedListing = deepSeed.listing;
                            interactionsRemaining -= deepSeed.interactionsUsed;
                        } catch (error: any) {
                            const category = categorizeScrapeError(error);
                            addError(taskSummary, category);
                            await this.logStage(run.id, locationId, {
                                taskId: task.id,
                                stage: 'stage_b_seed_deep_error',
                                status: 'error',
                                reasonCode: 'task_error',
                                message: `Failed to deep-scrape seed listing: ${error?.message || 'Unknown error'}`,
                                metadata: { listingUrl: seed.url, externalId: seed.externalId, category },
                            });
                            continue;
                        }

                        const seedSave = await ListingScraperService.upsertListingAndProspect(
                            seedListing,
                            task as ScrapeTaskWithConnection,
                            task.locationId,
                        );

                        if (seedSave.prospectCreated) taskSummary.prospectsCreated += 1;
                        if (seedSave.prospectMatched) taskSummary.prospectsMatched += 1;

                        if (seedSave.skippedAsDuplicateContact) {
                            addOmission(taskSummary, 'duplicate');
                            await this.logStage(run.id, locationId, {
                                taskId: task.id,
                                stage: 'stage_g_upsert',
                                status: 'warning',
                                reasonCode: 'duplicate_contact',
                                message: 'Seed listing skipped due to duplicate contact.',
                                metadata: { listingUrl: seedListing.url, externalId: seedListing.externalId },
                            });
                            continue;
                        }

                        if (!seedSave.isRealEstate) {
                            addOmission(taskSummary, 'non_real_estate');
                            await this.logStage(run.id, locationId, {
                                taskId: task.id,
                                stage: 'stage_g_upsert',
                                status: 'skipped',
                                reasonCode: 'non_real_estate',
                                message: 'Seed listing omitted because it is not real-estate relevant.',
                                metadata: { listingUrl: seedListing.url, externalId: seedListing.externalId },
                            });
                            continue;
                        }

                        if (seedSave.listingAlreadyExisted) {
                            addOmission(taskSummary, 'duplicate');
                        }

                        const prospectLeadId = seedSave.prospectLeadId;
                        if (!prospectLeadId) {
                            addOmission(taskSummary, 'duplicate');
                            await this.logStage(run.id, locationId, {
                                taskId: task.id,
                                stage: 'stage_g_upsert',
                                status: 'warning',
                                reasonCode: 'duplicate_listing',
                                message: 'Seed listing had no linked prospect after upsert.',
                                metadata: { listingUrl: seedListing.url, externalId: seedListing.externalId },
                            });
                            continue;
                        }

                        const sellerKey = ListingScraperService.buildSellerProcessingKey(seedListing)
                            || `prospect:${prospectLeadId}`;
                        processedSellerKeys.add(sellerKey);

                        let knownPhone = normalizePhone(seedListing.ownerPhone || seedListing.whatsappPhone);
                        if (!knownPhone) {
                            const prospectPhone = await db.prospectLead.findUnique({
                                where: { id: prospectLeadId },
                                select: { phone: true },
                            });
                            knownPhone = normalizePhone(prospectPhone?.phone);
                        }

                        if (options.requirePhoneForPortfolio && !knownPhone) {
                            addOmission(taskSummary, 'missing_phone');
                            if (!seenContactsWithoutPhone.has(sellerKey)) {
                                seenContactsWithoutPhone.add(sellerKey);
                                taskSummary.contactsWithoutPhone += 1;
                            }

                            await this.logStage(run.id, locationId, {
                                taskId: task.id,
                                stage: 'stage_c_contact_gate',
                                status: 'skipped',
                                reasonCode: 'missing_phone',
                                message: 'Seller skipped because no phone was resolved on seed listing.',
                                metadata: { listingUrl: seedListing.url, externalId: seedListing.externalId, prospectLeadId },
                            });
                            continue;
                        }

                        if (knownPhone && !seenContactsWithPhone.has(sellerKey)) {
                            seenContactsWithPhone.add(sellerKey);
                            taskSummary.contactsWithPhone += 1;
                        }

                        const boundTask = {
                            ...(task as ScrapeTaskWithConnection),
                            targetProspectId: prospectLeadId,
                        } as ScrapeTaskWithConnection;

                        const eligiblePortfolioListings: RawListing[] = [];

                        if (seedListing.otherListingsUrl) {
                            taskSummary.sellerPortfoliosDiscovered += 1;

                            const portfolio = await ListingScraperService.collectBazarakiPortfolioListings({
                                profileUrl: seedListing.otherListingsUrl,
                                task: task as ScrapeTaskWithConnection,
                                options: { pageLimit: task.maxPagesPerRun },
                                fetcher,
                                activeCredential,
                            });

                            taskSummary.indexPagesScraped += portfolio.pagesScraped;

                            await this.logStage(run.id, locationId, {
                                taskId: task.id,
                                stage: 'stage_d_portfolio_collected',
                                status: 'success',
                                message: 'Seller portfolio collected.',
                                counters: {
                                    pagesScraped: portfolio.pagesScraped,
                                    listingsFound: portfolio.listings.length,
                                },
                                metadata: {
                                    prospectLeadId,
                                    profileUrl: seedListing.otherListingsUrl,
                                },
                            });

                            for (const listing of portfolio.listings) {
                                const listingWithSellerContext = mergeSellerContext(seedListing, listing);

                                const save = await ListingScraperService.upsertListingAndProspect(
                                    listingWithSellerContext,
                                    boundTask,
                                    task.locationId,
                                );

                                if (save.prospectCreated) taskSummary.prospectsCreated += 1;
                                if (save.prospectMatched) taskSummary.prospectsMatched += 1;

                                if (save.skippedAsDuplicateContact) {
                                    addOmission(taskSummary, 'duplicate');
                                    continue;
                                }

                                if (!save.isRealEstate) {
                                    addOmission(taskSummary, 'non_real_estate');
                                    continue;
                                }

                                if (save.listingAlreadyExisted) {
                                    addOmission(taskSummary, 'duplicate');
                                }

                                if (listingWithSellerContext.externalId !== seedListing.externalId) {
                                    eligiblePortfolioListings.push(listingWithSellerContext);
                                }
                            }
                        }

                        const classification = await ListingScraperService.ensureProspectClassification(
                            task.locationId,
                            prospectLeadId,
                            seedListing,
                        );

                        const decision = resolveProspectDeepDecision(
                            {
                                isAgency: classification.isAgency,
                                confidence: classification.confidence,
                                manualOverride: classification.manualOverride,
                            },
                            options.privateConfidenceThreshold,
                        );

                        await this.logStage(run.id, locationId, {
                            taskId: task.id,
                            stage: 'stage_e_classification',
                            status: 'info',
                            message: `Seller classified as ${decision}.`,
                            metadata: {
                                prospectLeadId,
                                decision,
                                confidence: classification.confidence,
                                isAgency: classification.isAgency,
                                manualOverride: classification.manualOverride,
                            },
                        });

                        if (decision === 'agency') {
                            if (eligiblePortfolioListings.length > 0) {
                                addOmission(taskSummary, 'agency', eligiblePortfolioListings.length);
                            }
                            await this.logStage(run.id, locationId, {
                                taskId: task.id,
                                stage: 'stage_f_portfolio_skip',
                                status: 'skipped',
                                reasonCode: 'agency_skipped',
                                message: 'Portfolio deep scrape skipped because seller is classified as agency.',
                                counters: {
                                    skippedListings: eligiblePortfolioListings.length,
                                },
                                metadata: { prospectLeadId },
                            });
                            continue;
                        }

                        if (decision === 'uncertain') {
                            if (eligiblePortfolioListings.length > 0) {
                                addOmission(taskSummary, 'uncertain', eligiblePortfolioListings.length);
                            }
                            await this.logStage(run.id, locationId, {
                                taskId: task.id,
                                stage: 'stage_f_portfolio_skip',
                                status: 'skipped',
                                reasonCode: 'uncertain_skipped',
                                message: 'Portfolio deep scrape skipped due to uncertain seller classification.',
                                counters: {
                                    skippedListings: eligiblePortfolioListings.length,
                                },
                                metadata: { prospectLeadId },
                            });
                            continue;
                        }

                        for (const listing of eligiblePortfolioListings) {
                            if (interactionsRemaining <= 0) {
                                addOmission(taskSummary, 'budget_exhausted');
                                await this.logStage(run.id, locationId, {
                                    taskId: task.id,
                                    stage: 'stage_f_portfolio_listing_skipped',
                                    status: 'skipped',
                                    reasonCode: 'interaction_budget_exhausted',
                                    message: 'Portfolio listing skipped due to interaction budget exhaustion.',
                                    metadata: { listingUrl: listing.url, externalId: listing.externalId, prospectLeadId },
                                });
                                continue;
                            }

                            try {
                                const deepPortfolioListing = await deepScrapeBazarakiListing(
                                    {
                                        ...listing,
                                        ownerPhone: knownPhone || listing.ownerPhone,
                                    },
                                    fetcher,
                                    {
                                        sellerType: 'individual',
                                        knownPhone: knownPhone || undefined,
                                    },
                                );

                                interactionsRemaining -= deepPortfolioListing.interactionsUsed;

                                const deepSave = await ListingScraperService.upsertListingAndProspect(
                                    deepPortfolioListing.listing,
                                    boundTask,
                                    task.locationId,
                                );

                                if (deepSave.prospectCreated) taskSummary.prospectsCreated += 1;
                                if (deepSave.prospectMatched) taskSummary.prospectsMatched += 1;

                                if (deepSave.skippedAsDuplicateContact || deepSave.listingAlreadyExisted) {
                                    addOmission(taskSummary, 'duplicate');
                                }

                                if (!deepSave.isRealEstate) {
                                    addOmission(taskSummary, 'non_real_estate');
                                } else {
                                    taskSummary.portfolioListingsDeepScraped += 1;
                                }
                            } catch (error: any) {
                                const category = categorizeScrapeError(error);
                                addError(taskSummary, category);
                                await this.logStage(run.id, locationId, {
                                    taskId: task.id,
                                    stage: 'stage_f_portfolio_listing_error',
                                    status: 'error',
                                    reasonCode: 'task_error',
                                    message: `Failed deep scraping portfolio listing: ${error?.message || 'Unknown error'}`,
                                    metadata: { listingUrl: listing.url, externalId: listing.externalId, prospectLeadId, category },
                                });
                            }
                        }
                    }

                    await db.scrapingCredential.update({
                        where: { id: activeCredential.id },
                        data: {
                            lastUsedAt: new Date(),
                            healthScore: 100,
                        },
                    });

                    runSummary.tasksCompleted += 1;

                    await this.logStage(run.id, locationId, {
                        taskId: task.id,
                        stage: 'task_completed',
                        status: taskSummary.errorsTotal > 0 ? 'warning' : 'success',
                        message: `Task "${task.name}" completed.`,
                        counters: {
                            rootUrlsProcessed: taskSummary.rootUrlsProcessed,
                            indexPagesScraped: taskSummary.indexPagesScraped,
                            seedListingsFound: taskSummary.seedListingsFound,
                            contactsWithPhone: taskSummary.contactsWithPhone,
                            contactsWithoutPhone: taskSummary.contactsWithoutPhone,
                            portfolioListingsDeepScraped: taskSummary.portfolioListingsDeepScraped,
                            errorsTotal: taskSummary.errorsTotal,
                        },
                    });
                } catch (error: any) {
                    runSummary.tasksSkipped += 1;
                    const category = categorizeScrapeError(error);
                    addError(taskSummary, category);

                    await this.logStage(run.id, locationId, {
                        taskId: task.id,
                        stage: 'task_failed',
                        status: 'error',
                        reasonCode: 'task_error',
                        message: `Task "${task.name}" failed: ${error?.message || 'Unknown error'}`,
                        metadata: {
                            category,
                        },
                    });
                } finally {
                    await fetcher.close();
                    applyTaskCountersToRun(runSummary, taskSummary);

                    await db.deepScrapeRun.update({
                        where: { id: run.id },
                        data: {
                            ...runSummary,
                        },
                    });
                }
            }

            const completedAt = new Date();
            const runStatus = runSummary.errorsTotal > 0 ? 'partial' : 'completed';

            await db.deepScrapeRun.update({
                where: { id: run.id },
                data: {
                    status: runStatus,
                    completedAt,
                    ...runSummary,
                },
            });

            await this.logStage(run.id, locationId, {
                stage: 'run_completed',
                status: runStatus === 'completed' ? 'success' : 'warning',
                message: `Deep orchestration ${runStatus}.`,
                counters: {
                    tasksScanned: runSummary.tasksScanned,
                    tasksStarted: runSummary.tasksStarted,
                    tasksCompleted: runSummary.tasksCompleted,
                    tasksSkipped: runSummary.tasksSkipped,
                    seedListingsFound: runSummary.seedListingsFound,
                    contactsWithPhone: runSummary.contactsWithPhone,
                    contactsWithoutPhone: runSummary.contactsWithoutPhone,
                    portfolioListingsDeepScraped: runSummary.portfolioListingsDeepScraped,
                    errorsTotal: runSummary.errorsTotal,
                },
            });

            return {
                runId: run.id,
                status: runStatus,
                ...runSummary,
            };
        } catch (error: any) {
            const completedAt = new Date();
            const category = categorizeScrapeError(error);
            addError(runSummary, category);

            await db.deepScrapeRun.update({
                where: { id: run.id },
                data: {
                    status: 'failed',
                    completedAt,
                    errorLog: error?.message || 'Unknown orchestration error',
                    ...runSummary,
                },
            });

            await this.logStage(run.id, locationId, {
                stage: 'run_failed',
                status: 'error',
                reasonCode: 'task_error',
                message: `Deep orchestration failed: ${error?.message || 'Unknown error'}`,
                metadata: { category },
            });

            throw error;
        }
    }

    private static async crawlSeedListings(
        task: ScrapeTaskWithConnection,
        activeCredential: { authUsername: string | null; authPassword: string | null; sessionState: unknown },
        fetcher: PageFetcher,
    ): Promise<CrawlSeedResult> {
        let rootUrlsProcessed = 0;
        let pagesScraped = 0;
        let seedListingsFound = 0;
        const seedByExternalId = new Map<string, RawListing>();

        for (const rootUrl of task.targetUrls || []) {
            rootUrlsProcessed += 1;
            let currentUrl: string | undefined = rootUrl;
            let pageCount = 0;
            const maxDepth = task.maxPagesPerRun ?? 10;

            while (currentUrl && pageCount < maxDepth) {
                pageCount += 1;

                const content = await fetcher.fetchContent({
                    url: currentUrl,
                    username: activeCredential.authUsername || undefined,
                    password: activeCredential.authPassword || undefined,
                    sessionState: activeCredential.sessionState || undefined,
                });

                pagesScraped += 1;

                const extractionResult = await extractBazarakiIndex(content, currentUrl, fetcher, {
                    strategy: 'shallow_duplication',
                    sellerType: 'all',
                    interactionsAvailable: 0,
                    delayBaseMs: task.delayBetweenPagesMs,
                    delayJitterMs: task.delayJitterMs,
                });

                seedListingsFound += extractionResult.listings.length;

                for (const listing of extractionResult.listings) {
                    if (!seedByExternalId.has(listing.externalId)) {
                        seedByExternalId.set(listing.externalId, listing);
                    }
                }

                if (!extractionResult.nextPageUrl) {
                    break;
                }

                await humanDelay(task.delayBetweenPagesMs, task.delayJitterMs);
                currentUrl = extractionResult.nextPageUrl;
            }
        }

        const uniqueSeeds = Array.from(seedByExternalId.values());

        return {
            seedListings: uniqueSeeds,
            rootUrlsProcessed,
            pagesScraped,
            seedListingsFound,
            seedListingsDuplicate: Math.max(0, seedListingsFound - uniqueSeeds.length),
        };
    }

    private static async logStage(
        runId: string,
        locationId: string,
        payload: DeepScrapeStageLog & { taskId?: string },
    ) {
        await db.deepScrapeRunStage.create({
            data: {
                runId,
                locationId,
                taskId: payload.taskId || null,
                stage: payload.stage,
                status: payload.status,
                reasonCode: payload.reasonCode as StageReasonCode | null,
                message: payload.message || null,
                counters: (payload.counters || null) as any,
                metadata: (payload.metadata || null) as any,
            },
        });
    }
}
