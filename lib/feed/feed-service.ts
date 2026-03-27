
import db from "@/lib/db";
import { GenericXmlParser } from "./parsers/generic-xml-parser";
import { FeedFormat } from "@prisma/client";
import { FeedParser } from "./parsers/base-parser";
import { FeedMappingConfig } from "./ai-mapper";
import { createHash } from "crypto";
import { uploadUrlToCloudflare, getImageDeliveryUrl } from "@/lib/cloudflareImages";

export class FeedService {
    private static buildFeedSyncMetadata(
        metadata: unknown,
        status: 'CREATED' | 'UPDATED' | 'UNCHANGED',
        timestamp: Date
    ) {
        const metadataObject =
            metadata && typeof metadata === 'object' && !Array.isArray(metadata)
                ? { ...(metadata as Record<string, any>) }
                : {};

        const existingFeedSync =
            metadataObject.feedSync &&
            typeof metadataObject.feedSync === 'object' &&
            !Array.isArray(metadataObject.feedSync)
                ? (metadataObject.feedSync as Record<string, any>)
                : {};

        const iso = timestamp.toISOString();

        metadataObject.feedSync = {
            ...existingFeedSync,
            status,
            lastSeenAt: iso,
            lastSyncedAt: iso,
            ...(status === 'CREATED' || status === 'UPDATED'
                ? { lastChangedAt: iso }
                : {}),
        };

        return metadataObject;
    }

    static async syncFeed(feedId: string) {
        const feed = await db.propertyFeed.findUnique({
            where: { id: feedId },
            include: { company: true }
        });

        if (!feed) throw new Error(`Feed ${feedId} not found`);

        if (!feed.isActive) {
            console.log(`Skipping inactive feed: ${feed.url}`);
            return { created: 0, updated: 0, skipped: 0, status: 'inactive' };
        }

        console.log(`Starting sync for feed: ${feed.url}`);

        // 1. Fetch
        const response = await fetch(feed.url);
        if (!response.ok) throw new Error(`Failed to fetch feed: ${response.statusText}`);
        const xmlContent = await response.text();

        // 2. Parse
        const mappingConfig = feed.mappingConfig as unknown as FeedMappingConfig | undefined;
        const parser = this.getParser(feed.format, mappingConfig);
        const items = await parser.parse(xmlContent);

        console.log(`Parsed ${items.length} items from feed.`);

        // 3. Sync
        let created = 0;
        let updated = 0;
        let skipped = 0;
        const syncTimestamp = new Date();

        for (const item of items) {
            const externalId = String(item.externalId || '').trim();
            const title = String(item.title || '').trim();

            // Guardrail: never create placeholder properties from malformed feed rows.
            if (!title) {
                console.warn(`[FeedService] Skipping feed item with empty title (feedId=${feed.id}, externalId=${externalId || 'n/a'})`);
                skipped++;
                continue;
            }
            if (!externalId || externalId.toLowerCase() === 'unknown') {
                const fingerprint = createHash('sha1').update(JSON.stringify(item)).digest('hex').slice(0, 10);
                console.warn(`[FeedService] Skipping feed item with invalid externalId (feedId=${feed.id}, title="${title}", fp=${fingerprint})`);
                skipped++;
                continue;
            }

            // Create a hash to check for changes (naive implementation)
            const currentHash = Buffer.from(JSON.stringify(item)).toString('base64');

            const existing = await db.property.findUnique({
                where: {
                    feedId_feedReferenceId: {
                        feedId: feed.id,
                        feedReferenceId: externalId
                    }
                }
            });

            if (existing) {
                if (existing.feedHash !== currentHash) {
                    // Update logic
                    await db.property.update({
                        where: { id: existing.id },
                        data: {
                            price: item.price,
                            feedHash: currentHash,
                            metadata: this.buildFeedSyncMetadata(existing.metadata, 'UPDATED', syncTimestamp),
                            // Might want to update other fields if they changed?
                        }
                    });
                    updated++;
                } else {
                    await db.property.update({
                        where: { id: existing.id },
                        data: {
                            metadata: this.buildFeedSyncMetadata(existing.metadata, 'UNCHANGED', syncTimestamp),
                        }
                    });
                    skipped++;
                }
            } else {
                // Create new
                const locationId = feed.company.locationId;

                // Generate a slug
                const slug = `${title}-${externalId}`
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/(^-|-$)/g, '');

                // Persist images to Cloudflare
                const mediaItems = [];
                for (let i = 0; i < (item.images || []).length; i++) {
                    const rawUrl = item.images[i];
                    try {
                        if (rawUrl.includes("imagedelivery.net")) {
                            mediaItems.push({ url: rawUrl, kind: 'IMAGE' as const, sortOrder: i });
                            continue;
                        }
                        const result = await uploadUrlToCloudflare(rawUrl);
                        const cdnUrl = getImageDeliveryUrl(result.imageId, "public");
                        mediaItems.push({
                            url: cdnUrl,
                            cloudflareImageId: result.imageId,
                            kind: 'IMAGE' as const,
                            sortOrder: i
                        });
                    } catch (error: any) {
                        console.warn(`[FeedService] Failed to upload image to CF for feed ${feed.id}: ${rawUrl} - ${error.message}`);
                        // Graceful fallback to raw hotlink if Cloudflare ingestion fails
                        mediaItems.push({
                            url: rawUrl,
                            kind: 'IMAGE' as const,
                            sortOrder: i
                        });
                    }
                }

                await db.property.create({
                    data: {
                        locationId,
                        title,
                        slug: slug + '-' + Date.now(),
                        description: item.description,
                        price: item.price,
                        currency: item.currency,
                        status: 'ACTIVE',
                        publicationStatus: 'PENDING',
                        source: 'FEED',
                        feedId: feed.id,
                        feedReferenceId: externalId,
                        feedHash: currentHash,
                        metadata: this.buildFeedSyncMetadata(undefined, 'CREATED', syncTimestamp),
                        media: {
                            create: mediaItems
                        },
                        // Link Company
                        companyRoles: {
                            create: {
                                companyId: feed.companyId,
                                role: 'SELLER'
                            }
                        }
                    }
                });
                created++;
            }
        }

        // Update Feed Status
        await db.propertyFeed.update({
            where: { id: feed.id },
            data: { lastSyncAt: new Date() }
        });

        return { created, updated, skipped };
    }

    private static getParser(format: FeedFormat, mappingConfig?: FeedMappingConfig): FeedParser {
        switch (format) {
            case 'GENERIC':
                return new GenericXmlParser(mappingConfig);
            // case 'ALTIA': return new AltiaParser();
            default:
                return new GenericXmlParser(mappingConfig);
        }
    }
}
