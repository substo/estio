import { PrismaClient } from '@prisma/client';
import {
    buildListingRelevanceRawAttributes,
    classifyListingRelevance,
} from '../lib/scraping/listing-relevance-classifier';
import {
    resolveListingStatusForRelevance,
    type RawListing,
} from '../lib/scraping/listing-scraper';

type CliArgs = {
    locationId: string;
    runId?: string;
    days: number;
    limit?: number;
    apply: boolean;
    disableAI: boolean;
};

const prisma = new PrismaClient();

function printUsage() {
    console.log([
        'Usage:',
        '  npm run prospecting:reclassify -- --locationId <id> [--runId <deepRunId>] [--days <n>] [--limit <n>] [--disable-ai] --dry-run|--apply',
        '',
        'Examples:',
        '  npm run prospecting:reclassify -- --locationId cmingx6b10008rdycg7hwesyn --runId cmn27e7z80007a4c5hb95lutu --dry-run',
        '  npm run prospecting:reclassify -- --locationId cmingx6b10008rdycg7hwesyn --runId cmn27e7z80007a4c5hb95lutu --apply',
        '  npm run prospecting:reclassify -- --locationId cmingx6b10008rdycg7hwesyn --runId cmn27e7z80007a4c5hb95lutu --apply --disable-ai',
        '  npm run prospecting:reclassify -- --locationId cmingx6b10008rdycg7hwesyn --days 7 --dry-run',
    ].join('\n'));
}

function parseArgs(argv: string[]): CliArgs {
    const args = [...argv];
    let locationId = '';
    let runId: string | undefined;
    let days = 7;
    let limit: number | undefined;
    let dryRun = false;
    let apply = false;
    let disableAI = false;

    while (args.length > 0) {
        const token = args.shift();
        if (!token) continue;

        if (token === '--locationId') {
            locationId = String(args.shift() || '').trim();
            continue;
        }
        if (token === '--runId') {
            runId = String(args.shift() || '').trim() || undefined;
            continue;
        }
        if (token === '--days') {
            const parsed = parseInt(String(args.shift() || ''), 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                days = parsed;
            }
            continue;
        }
        if (token === '--limit') {
            const parsed = parseInt(String(args.shift() || ''), 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                limit = parsed;
            }
            continue;
        }
        if (token === '--dry-run') {
            dryRun = true;
            continue;
        }
        if (token === '--apply') {
            apply = true;
            continue;
        }
        if (token === '--disable-ai') {
            disableAI = true;
            continue;
        }
    }

    if (!locationId) {
        throw new Error('--locationId is required');
    }
    if (dryRun && apply) {
        throw new Error('Use either --dry-run or --apply, not both');
    }

    return {
        locationId,
        runId,
        days,
        limit,
        apply,
        disableAI,
    };
}

function toStringRecord(raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== 'object') return {};
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === 'string') {
            output[key] = value;
            continue;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            output[key] = String(value);
        }
    }
    return output;
}

function rawAttributesChanged(
    before: Record<string, string>,
    after: Record<string, string>,
): boolean {
    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of allKeys) {
        if ((before[key] || '') !== (after[key] || '')) {
            return true;
        }
    }
    return false;
}

function toRawListing(input: {
    externalId: string;
    title: string | null;
    description: string | null;
    price: number | null;
    currency: string | null;
    locationText: string | null;
    propertyType: string | null;
    listingType: string | null;
    sellerExternalId: string | null;
    sellerRegisteredAt: string | null;
    otherListingsUrl: string | null;
    otherListingsCount: number | null;
    contactChannels: string[];
    whatsappPhone: string | null;
    ownerName: string | null;
    ownerPhone: string | null;
    ownerEmail: string | null;
    url: string;
    images: string[];
    thumbnails: string[];
    bedrooms: number | null;
    bathrooms: number | null;
    propertyArea: number | null;
    plotArea: number | null;
    constructionYear: number | null;
    latitude: number | null;
    longitude: number | null;
    rawAttributes: Record<string, string>;
}): RawListing {
    return {
        externalId: input.externalId,
        title: input.title || 'No Title',
        description: input.description || '',
        price: input.price ?? undefined,
        currency: input.currency ?? undefined,
        location: input.locationText ?? undefined,
        propertyType: input.propertyType ?? undefined,
        listingType: input.listingType ?? undefined,
        sellerExternalId: input.sellerExternalId ?? undefined,
        sellerRegisteredAt: input.sellerRegisteredAt ?? undefined,
        otherListingsUrl: input.otherListingsUrl ?? undefined,
        otherListingsCount: input.otherListingsCount ?? undefined,
        contactChannels: input.contactChannels || [],
        whatsappPhone: input.whatsappPhone ?? undefined,
        ownerName: input.ownerName ?? undefined,
        ownerPhone: input.ownerPhone ?? undefined,
        ownerEmail: input.ownerEmail ?? undefined,
        url: input.url,
        images: input.images || [],
        thumbnails: input.thumbnails || [],
        bedrooms: input.bedrooms ?? undefined,
        bathrooms: input.bathrooms ?? undefined,
        propertyArea: input.propertyArea ?? undefined,
        plotArea: input.plotArea ?? undefined,
        constructionYear: input.constructionYear ?? undefined,
        latitude: input.latitude ?? undefined,
        longitude: input.longitude ?? undefined,
        rawAttributes: input.rawAttributes,
    };
}

async function main() {
    const cli = parseArgs(process.argv.slice(2));

    let fromDate: Date;
    let toDate: Date;
    if (cli.runId) {
        const run = await prisma.deepScrapeRun.findFirst({
            where: {
                id: cli.runId,
                locationId: cli.locationId,
            },
            select: {
                id: true,
                createdAt: true,
                completedAt: true,
            },
        });
        if (!run) {
            throw new Error(`Deep run not found for runId=${cli.runId}`);
        }
        fromDate = run.createdAt;
        toDate = run.completedAt || new Date(run.createdAt.getTime() + 6 * 60 * 60 * 1000);
    } else {
        toDate = new Date();
        fromDate = new Date(toDate.getTime() - cli.days * 24 * 60 * 60 * 1000);
    }

    const listings = await prisma.scrapedListing.findMany({
        where: {
            locationId: cli.locationId,
            createdAt: {
                gte: fromDate,
                lte: toDate,
            },
        },
        orderBy: { createdAt: 'asc' },
        take: cli.limit,
        select: {
            id: true,
            externalId: true,
            title: true,
            description: true,
            price: true,
            currency: true,
            locationText: true,
            propertyType: true,
            listingType: true,
            sellerExternalId: true,
            sellerRegisteredAt: true,
            otherListingsUrl: true,
            otherListingsCount: true,
            contactChannels: true,
            whatsappPhone: true,
            url: true,
            images: true,
            thumbnails: true,
            bedrooms: true,
            bathrooms: true,
            propertyArea: true,
            plotArea: true,
            constructionYear: true,
            latitude: true,
            longitude: true,
            rawAttributes: true,
            status: true,
            createdAt: true,
        },
    });

    const stats = {
        scanned: listings.length,
        changed: 0,
        statusChanged: 0,
        statusToSkipped: 0,
        statusToNew: 0,
        diagnostics: {} as Record<string, number>,
        source: {} as Record<string, number>,
    };
    const samples: Array<Record<string, unknown>> = [];

    for (const listing of listings) {
        const existingRaw = toStringRecord(listing.rawAttributes);
        const rawListing = toRawListing({
            ...listing,
            ownerName: null,
            ownerPhone: null,
            ownerEmail: null,
            rawAttributes: existingRaw,
        });

        const decision = await classifyListingRelevance(
            rawListing,
            existingRaw,
            {
                forceReclassify: true,
                disableAI: cli.disableAI,
            },
        );
        const nextStatus = resolveListingStatusForRelevance(listing.status, decision.isRealEstate);
        const nextRawAttributes = {
            ...existingRaw,
            ...buildListingRelevanceRawAttributes(decision),
        };

        const statusChanged = nextStatus !== listing.status;
        const rawChanged = rawAttributesChanged(existingRaw, nextRawAttributes);
        const changed = statusChanged || rawChanged;

        stats.source[decision.source] = (stats.source[decision.source] || 0) + 1;
        stats.diagnostics[decision.diagnosticCode] = (stats.diagnostics[decision.diagnosticCode] || 0) + 1;

        if (!changed) {
            continue;
        }

        stats.changed += 1;
        if (statusChanged) {
            stats.statusChanged += 1;
            if (nextStatus === 'SKIPPED') stats.statusToSkipped += 1;
            if (nextStatus === 'NEW') stats.statusToNew += 1;
        }

        if (samples.length < 25) {
            samples.push({
                id: listing.id,
                externalId: listing.externalId,
                title: listing.title,
                createdAt: listing.createdAt.toISOString(),
                beforeStatus: listing.status,
                afterStatus: nextStatus,
                source: decision.source,
                diagnosticCode: decision.diagnosticCode,
                confidence: decision.confidence,
                reason: decision.reason,
            });
        }

        if (cli.apply) {
            await prisma.scrapedListing.update({
                where: { id: listing.id },
                data: {
                    status: nextStatus,
                    rawAttributes: nextRawAttributes as any,
                },
            });
        }
    }

    const report = {
        mode: cli.apply ? 'apply' : 'dry-run',
        disableAI: cli.disableAI,
        locationId: cli.locationId,
        runId: cli.runId || null,
        range: {
            from: fromDate.toISOString(),
            to: toDate.toISOString(),
        },
        stats,
        samples,
    };

    console.log(JSON.stringify(report, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        printUsage();
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
