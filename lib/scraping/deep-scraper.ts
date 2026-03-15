import db from '@/lib/db';
import { PageFetcher } from './page-fetcher';
import { callLLMWithMetadata } from '@/lib/ai/llm';

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

                    // Ask Gemini if this is an Agency
                    const prompt = `
Analyze the following property listing and contact information to determine if it belongs to a Real Estate Agency/Developer or a Private individual seller/landlord.
Return a JSON object with a single boolean property "isAgency". True if it appears to be an agency, false if private person.

Title: ${listing.title || 'Unknown'}
Location: ${listing.locationText || 'Unknown'}
Description: ${fullDescription}
                    `;
                    
                    const aiResult = await callLLMWithMetadata('gemini-1.5-flash', prompt, '', { 
                        jsonMode: true, 
                        temperature: 0.1 
                    });

                    let isAgency = false;
                    if (aiResult.text) {
                        try {
                           const parsed = JSON.parse(aiResult.text);
                           isAgency = parsed.isAgency === true || parsed.isAgency === 'true';
                        } catch (e) {
                           console.warn(`[DeepScraper] Failed to parse AI JSON for ${listing.id}`);
                        }
                    }

                    if (isAgency) agenciesFound++;

                    // Log the global Enterprise Usage correctly under this location
                    await db.agentExecution.create({
                        data: {
                            locationId: locationId,
                            sourceType: 'scraper',
                            sourceId: listing.id,
                            
                            taskTitle: "Analyze Deep Listing IsAgency",
                            taskStatus: "done",
                            status: "success",
                            skillName: "listing_classifier",
                            intent: "classification",
                            model: 'gemini-1.5-flash',
                            
                            promptTokens: aiResult.usage?.promptTokens || 0,
                            completionTokens: aiResult.usage?.completionTokens || 0,
                            totalTokens: aiResult.usage?.totalTokens || 0,
                            cost: 0 // Ideally a runCost calculator here if needed
                        }
                    });

                    // Update the ScrapedListing to REVIEWING (or ACCEPTED/REJECTED based on business logic)
                    await db.scrapedListing.update({
                        where: { id: listing.id },
                        data: { status: 'REVIEWED' } // moving out of NEW
                    });

                    // If we have an attached person, update their agency status
                    if (listing.prospectLeadId) {
                        // Only update if we positively identified an agency, we don't want to revert a known agency to false
                        if (isAgency) {
                            await db.prospectLead.update({
                                where: { id: listing.prospectLeadId },
                                data: { isAgency: true }
                            });
                        }
                    }

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
