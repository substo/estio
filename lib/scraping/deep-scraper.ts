import db from '@/lib/db';
import { PageFetcher } from './page-fetcher';

export class DeepScraperService {
    /**
     * Finds NEW scraped listings and performs a deep scrape to extract full descriptions and determine if it's an agency.
     */
    static async processPendingListings(locationId: string, limit: number = 20) {
        console.log(`[DeepScraper] Starting deep scrape for location ${locationId}, limit: ${limit}`);

        const pendingListings = await db.scrapedListing.findMany({
            where: {
                locationId,
                status: 'NEW',
            },
            take: limit,
            include: {
                prospectLead: true
            }
        });

        if (pendingListings.length === 0) {
            console.log(`[DeepScraper] No pending listings found for location ${locationId}.`);
            return { processed: 0, agenciesFound: 0, errors: 0 };
        }

        const fetcher = new PageFetcher();
        let processed = 0;
        let agenciesFound = 0;
        let errors = 0;

        try {
            for (const listing of pendingListings) {
                try {
                    console.log(`[DeepScraper] Fetching deep URL: ${listing.url}`);
                    const html = await fetcher.fetchContent({ url: listing.url });
                    
                    // Simple Cheerio-like extraction for the description relying on generic properties 
                    // or platform specific if we want to build it out. Since we use Bazaraki mostly:
                    let fullDescription = '';
                    
                    if (listing.platform === 'bazaraki') {
                         const { extractBazarakiDescription } = await import('./extractors/bazaraki');
                         fullDescription = extractBazarakiDescription(html) || listing.title || '';
                    } else {
                         // Fallback heuristic: strip tags and compress
                         fullDescription = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 5000); // Send up to 5k chars to LLM
                    }

                    // Ask AI if this is an Agency using the reusable classifier
                    let isAgency = false;
                    if (listing.prospectLeadId) {
                        try {
                            const {
                                classifyAndUpdateProspect,
                                buildClassificationInputForProspect,
                                shouldRunProspectClassification,
                            } = await import('@/lib/ai/prospect-classifier');
                            const decision = await shouldRunProspectClassification(listing.prospectLeadId);
                            if (decision.shouldClassify) {
                                const classificationInput = await buildClassificationInputForProspect(
                                    listing.prospectLeadId,
                                    {
                                        name: listing.prospectLead?.name,
                                        description: fullDescription,
                                        platformRegistered: listing.prospectLead?.platformRegistered,
                                        profileUrl: listing.prospectLead?.profileUrl,
                                    }
                                );

                                if (!classificationInput) {
                                    throw new Error('No prospect classification input available.');
                                }

                                const classification = await classifyAndUpdateProspect(
                                    listing.prospectLeadId,
                                    locationId,
                                    classificationInput
                                );
                                isAgency = classification.isAgency;
                            }
                        } catch (classErr: any) {
                            console.warn(`[DeepScraper] Classification failed for ${listing.id}: ${classErr.message}`);
                        }
                    }

                    if (isAgency) agenciesFound++;

                    // Keep status compatible with triage/import flows.
                    await db.scrapedListing.update({
                        where: { id: listing.id },
                        data: { status: 'REVIEWING' }
                    });

                    processed++;
                    
                    // Human delay between deep scrapes
                    await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));

                } catch (err: any) {
                    console.error(`[DeepScraper] Error processing listing ${listing.id}:`, err);
                    errors++;
                }
            }
        } finally {
            await fetcher.close();
        }

        return { processed, agenciesFound, errors };
    }
}
