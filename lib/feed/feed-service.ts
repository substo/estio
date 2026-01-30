
import db from "@/lib/db";
import { GenericXmlParser } from "./parsers/generic-xml-parser";
import { FeedFormat, PropertyFeed } from "@prisma/client";
import { FeedItem, FeedParser } from "./parsers/base-parser";
import { FeedMappingConfig } from "./ai-mapper";
import { JsonValue } from "@prisma/client/runtime/library";

export class FeedService {

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

        for (const item of items) {
            // Create a hash to check for changes (naive implementation)
            const currentHash = Buffer.from(JSON.stringify(item)).toString('base64');

            const existing = await db.property.findUnique({
                where: {
                    feedId_feedReferenceId: {
                        feedId: feed.id,
                        feedReferenceId: item.externalId
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
                            // Might want to update other fields if they changed?
                        }
                    });
                    updated++;
                } else {
                    skipped++;
                }
            } else {
                // Create new
                const locationId = feed.company.locationId;

                // Generate a slug
                const slug = `${item.title}-${item.externalId}`
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/(^-|-$)/g, '');

                await db.property.create({
                    data: {
                        locationId,
                        title: item.title,
                        slug: slug + '-' + Date.now(),
                        description: item.description,
                        price: item.price,
                        currency: item.currency,
                        status: 'ACTIVE',
                        publicationStatus: 'PENDING',
                        source: 'FEED',
                        feedId: feed.id,
                        feedReferenceId: item.externalId,
                        feedHash: currentHash,
                        // Map images
                        media: {
                            create: item.images.map((url, index) => ({
                                url,
                                kind: 'IMAGE',
                                sortOrder: index
                            }))
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
