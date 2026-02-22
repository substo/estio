import db from '@/lib/db';
import { Prisma, PropertyStatus, PublicationStatus } from '@prisma/client';

export type FeedInboxScope = 'needs-review' | 'all-feed';
export type FeedInboxMissingFilter =
    | 'all'
    | 'any_critical'
    | 'no_price'
    | 'no_description'
    | 'no_location'
    | 'no_images';

export interface FeedInboxListParams {
    limit?: number;
    skip?: number;
    q?: string;
    feedId?: string;
    status?: string;
    publicationStatus?: string;
    scope?: FeedInboxScope;
    missing?: FeedInboxMissingFilter;
}

export interface FeedInboxFeedOption {
    id: string;
    url: string;
    companyName: string;
    isActive: boolean;
    lastSyncAt: string | null;
}

export interface FeedInboxPropertyRow {
    id: string;
    title: string;
    slug: string;
    reference: string | null;
    status: string;
    publicationStatus: string;
    goal: string;
    price: number | null;
    currency: string | null;
    bedrooms: number | null;
    bathrooms: number | null;
    propertyLocation: string | null;
    propertyArea: string | null;
    source: string;
    feedId: string | null;
    feedReferenceId: string | null;
    feedUrl: string | null;
    feedCompanyName: string | null;
    feedSyncStatus: string | null;
    feedLastSeenAt: string | null;
    feedLastSyncedAt: string | null;
    feedLastChangedAt: string | null;
    imageCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface FeedInboxListResult {
    items: FeedInboxPropertyRow[];
    total: number;
}

function mapStatus(status?: string): PropertyStatus | undefined {
    if (!status || status === 'all') return undefined;

    const statusMap: Record<string, PropertyStatus> = {
        Active: 'ACTIVE',
        Reserved: 'RESERVED',
        Sold: 'SOLD',
        Rented: 'RENTED',
        Withdrawn: 'WITHDRAWN',
    };

    return statusMap[status];
}

function mapPublicationStatus(status?: string): PublicationStatus | undefined {
    if (!status || status === 'all') return undefined;

    const pubMap: Record<string, PublicationStatus> = {
        Published: 'PUBLISHED',
        Pending: 'PENDING',
        Draft: 'DRAFT',
        Unlisted: 'UNLISTED',
    };

    return pubMap[status];
}

function applyMissingFilter(and: Prisma.PropertyWhereInput[], missing: FeedInboxMissingFilter | undefined) {
    switch (missing) {
        case 'any_critical':
            and.push({
                OR: [
                    { price: null },
                    { price: 0 },
                    { description: null },
                    { description: '' },
                    { propertyLocation: null },
                    { propertyLocation: '' },
                    { media: { none: {} } },
                ],
            });
            break;
        case 'no_price':
            and.push({
                OR: [{ price: null }, { price: 0 }],
            });
            break;
        case 'no_description':
            and.push({
                OR: [{ description: null }, { description: '' }],
            });
            break;
        case 'no_location':
            and.push({
                OR: [{ propertyLocation: null }, { propertyLocation: '' }],
            });
            break;
        case 'no_images':
            and.push({ media: { none: {} } });
            break;
        case 'all':
        default:
            break;
    }
}

function getFeedSyncMeta(metadata: Prisma.JsonValue | null | undefined) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return null;
    }

    const metaObj = metadata as Record<string, unknown>;
    const feedSync = metaObj.feedSync;

    if (!feedSync || typeof feedSync !== 'object' || Array.isArray(feedSync)) {
        return null;
    }

    const syncObj = feedSync as Record<string, unknown>;

    return {
        status: typeof syncObj.status === 'string' ? syncObj.status : null,
        lastSeenAt: typeof syncObj.lastSeenAt === 'string' ? syncObj.lastSeenAt : null,
        lastSyncedAt: typeof syncObj.lastSyncedAt === 'string' ? syncObj.lastSyncedAt : null,
        lastChangedAt: typeof syncObj.lastChangedAt === 'string' ? syncObj.lastChangedAt : null,
    };
}

export async function listFeedInboxProperties(
    locationId: string,
    params: FeedInboxListParams = {}
): Promise<FeedInboxListResult> {
    const and: Prisma.PropertyWhereInput[] = [
        { locationId },
        { source: 'FEED' },
    ];

    const scope = params.scope || 'needs-review';

    if (scope === 'needs-review') {
        and.push({ publicationStatus: 'PENDING' });
    } else {
        const pub = mapPublicationStatus(params.publicationStatus);
        if (pub) and.push({ publicationStatus: pub });
    }

    const status = mapStatus(params.status);
    if (status) and.push({ status });

    if (params.feedId && params.feedId !== 'all') {
        and.push({ feedId: params.feedId });
    }

    if (params.q) {
        and.push({
            OR: [
                { title: { contains: params.q, mode: 'insensitive' } },
                { slug: { contains: params.q, mode: 'insensitive' } },
                { reference: { contains: params.q, mode: 'insensitive' } },
                { feedReferenceId: { contains: params.q, mode: 'insensitive' } },
            ],
        });
    }

    applyMissingFilter(and, params.missing);

    const where: Prisma.PropertyWhereInput = { AND: and };

    const [rows, total] = await Promise.all([
        db.property.findMany({
            where,
            take: params.limit || 25,
            skip: params.skip || 0,
            orderBy: { updatedAt: 'desc' },
            select: {
                id: true,
                title: true,
                slug: true,
                reference: true,
                status: true,
                publicationStatus: true,
                goal: true,
                price: true,
                currency: true,
                bedrooms: true,
                bathrooms: true,
                propertyLocation: true,
                propertyArea: true,
                source: true,
                feedId: true,
                feedReferenceId: true,
                metadata: true,
                createdAt: true,
                updatedAt: true,
                feed: {
                    select: {
                        id: true,
                        url: true,
                        company: {
                            select: {
                                name: true,
                            },
                        },
                    },
                },
                _count: {
                    select: {
                        media: true,
                    },
                },
            },
        }),
        db.property.count({ where }),
    ]);

    return {
        items: rows.map((row) => {
            const sync = getFeedSyncMeta(row.metadata);

            return {
                id: row.id,
                title: row.title,
                slug: row.slug,
                reference: row.reference,
                status: row.status,
                publicationStatus: row.publicationStatus,
                goal: row.goal,
                price: row.price,
                currency: row.currency,
                bedrooms: row.bedrooms,
                bathrooms: row.bathrooms,
                propertyLocation: row.propertyLocation,
                propertyArea: row.propertyArea,
                source: row.source,
                feedId: row.feedId,
                feedReferenceId: row.feedReferenceId,
                feedUrl: row.feed?.url || null,
                feedCompanyName: row.feed?.company?.name || null,
                feedSyncStatus: sync?.status || null,
                feedLastSeenAt: sync?.lastSeenAt || null,
                feedLastSyncedAt: sync?.lastSyncedAt || null,
                feedLastChangedAt: sync?.lastChangedAt || null,
                imageCount: row._count.media,
                createdAt: row.createdAt.toISOString(),
                updatedAt: row.updatedAt.toISOString(),
            };
        }),
        total,
    };
}

export async function listFeedInboxFeedOptions(locationId: string): Promise<FeedInboxFeedOption[]> {
    const feeds = await db.propertyFeed.findMany({
        where: {
            company: {
                is: {
                    locationId,
                },
            },
        },
        orderBy: [
            { isActive: 'desc' },
            { updatedAt: 'desc' },
        ],
        select: {
            id: true,
            url: true,
            isActive: true,
            lastSyncAt: true,
            company: {
                select: {
                    name: true,
                },
            },
        },
    });

    return feeds.map((feed) => ({
        id: feed.id,
        url: feed.url,
        companyName: feed.company.name,
        isActive: feed.isActive,
        lastSyncAt: feed.lastSyncAt ? feed.lastSyncAt.toISOString() : null,
    }));
}
