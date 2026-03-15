import { RawListing } from '../listing-scraper';
import { PageFetcher } from '../page-fetcher';
import * as cheerio from 'cheerio';

const BAZARAKI_SELECTORS = {
    listingContainer: '.announcement-block',
    title: '.announcement-block__title a[href]',
    price: '.announcement-block__price',
    location: '.announcement-block__city',
};

export interface BazarakiExtractionOptions {
    strategy: 'shallow_duplication' | 'deep_extraction';
    sellerType: 'individual' | 'agency' | 'all';
    interactionsAvailable: number;
    delayBaseMs: number;
    delayJitterMs: number;
}

export interface BazarakiExtractionResult {
    listings: RawListing[];
    interactionsUsed: number;
}

// Random Gaussian-like delay for human emulation
const humanDelay = async (baseMs: number, jitterMs: number) => {
    const offset = Math.floor(Math.random() * (jitterMs * 2 + 1)) - jitterMs;
    const finalDelay = Math.max(500, baseMs + offset);
    await new Promise((resolve) => setTimeout(resolve, finalDelay));
};

/**
 * Parses Bazaraki index pages and optionally drills down into listings based on strategy
 */
export async function extractBazarakiIndex(content: string, baseUrl: string, fetcher: PageFetcher, options?: BazarakiExtractionOptions): Promise<BazarakiExtractionResult> {
    const $ = cheerio.load(content);
    const listings: RawListing[] = [];
    let interactionsUsed = 0;
    
    const opts = options || {
        strategy: 'shallow_duplication',
        sellerType: 'all',
        interactionsAvailable: 0,
        delayBaseMs: 2000,
        delayJitterMs: 1000
    };

    // 1. Gather Shallow info from the index page for all methods
    const shallowListings: RawListing[] = [];
    $(BAZARAKI_SELECTORS.listingContainer).each((_, el) => {
        const titleEl = $(el).find(BAZARAKI_SELECTORS.title);
        const href = titleEl.attr('href');
        if (!href) return;
        
        const absoluteUrl = href.startsWith('http') ? href : `https://www.bazaraki.com${href}`;
        const matchId = absoluteUrl.match(/\/(\d+)\/$/);
        const externalId = matchId ? matchId[1] : `bz-${Date.now()}`;
        
        const title = titleEl.text().trim();
        const priceText = $(el).find(BAZARAKI_SELECTORS.price).text() || '0';
        const cleanPrice = parseInt(priceText.replace(/\D/g, '') || '0');
        const location = $(el).find(BAZARAKI_SELECTORS.location).text().trim() || 'Cyprus';
        
        shallowListings.push({
            url: absoluteUrl,
            externalId,
            title: title || 'No Title',
            description: '',
            price: cleanPrice,
            currency: 'EUR',
            location,
            listingType: absoluteUrl.includes('-rent/') ? 'rent' : 'sale'
        });
    });

    console.log(`[BazarakiExtractor] Found ${shallowListings.length} shallow listings on index.`);

    // If Strategy is Shallow, we are done! Return immediately
    if (opts.strategy === 'shallow_duplication') {
        console.log(`[BazarakiExtractor] Strategy is Shallow. Returning early.`);
        return { listings: shallowListings, interactionsUsed: 0 };
    }

    // 2. Strategy is Deep Extraction
    // Determine how many we can afford to deep scrape right now
    const deepCandidates = shallowListings.slice(0, Math.min(10, opts.interactionsAvailable));
    if (deepCandidates.length === 0) {
        console.log(`[BazarakiExtractor] No interaction budget available for deep extractions. Returning shallow.`);
        return { listings: shallowListings, interactionsUsed: 0 };
    }

    // Process deep extractions
    for (const shallow of deepCandidates) {
        if (interactionsUsed >= opts.interactionsAvailable) break;

        try {
            console.log(`[BazarakiExtractor] Fetching details for: ${shallow.url}`);
            const detailListing = await fetcher.executeOnPage({ url: shallow.url, jsEnabled: true }, async (page) => {
                let deepData = { ...shallow };
                
                // Get basic metadata from DOM
                const description = await page.locator('.announcement-description').textContent().catch(() => '');
                deepData.description = description?.trim() || '';
                
                // Owner Name extraction
                const ownerName = await page.locator('.author-card__name').textContent().catch(() => 'Bazaraki Owner');
                deepData.ownerName = ownerName?.trim();
                
                // --- TARGET SELLER TYPE FILTERING ---
                const isAgency = deepData.ownerName?.toLowerCase().includes('real estate') || 
                                 deepData.ownerName?.toLowerCase().includes('properties') || 
                                 deepData.ownerName?.toLowerCase().includes('agency');
                
                if (opts.sellerType === 'individual' && isAgency) {
                     console.log(`[BazarakiExtractor] Skipping Deep Contact grab, identified as Agency: ${deepData.ownerName}`);
                     return deepData; // Skip the phone grab
                }
                if (opts.sellerType === 'agency' && !isAgency) {
                     console.log(`[BazarakiExtractor] Skipping Deep Contact grab, identified as Individual: ${deepData.ownerName}`);
                     return deepData;
                }

                // Try to click "Show phone number" button - THIS CONSUMES AN INTERACTION BUDGET
                let phone = '';
                try {
                    const phoneBtn = page.locator('.js-phone-number-button');
                    if (await phoneBtn.isVisible()) {
                        await phoneBtn.click();
                        await page.waitForTimeout(1000); // Give JS time to replace inner context
                        
                        const phoneEl = page.locator('.js-phone-number-value');
                        phone = await phoneEl.textContent() || '';
                    } else {
                        phone = await page.locator('.js-phone-number-value').textContent() || '';
                    }
                    if (phone) deepData.ownerPhone = phone.trim().replace(/\s+/g, '');
                } catch (e) {
                    console.log(`[BazarakiExtractor] Failed to reveal phone for ${shallow.url}`);
                }

                return deepData;
            });
            
            listings.push(detailListing);
            interactionsUsed++; // Count this page load / interaction against the quota

        } catch (detailError) {
             console.error(`[BazarakiExtractor] Skipping listing ${shallow.url} due to error`);
        }
        
        await humanDelay(opts.delayBaseMs, opts.delayJitterMs);
    }
    
    // Merge any skipped/unaffordable shallow lists into the final output
    const deepProcessedIds = new Set(listings.map(l => l.externalId));
    for (const shallow of shallowListings) {
        if (!deepProcessedIds.has(shallow.externalId)) {
            listings.push(shallow);
        }
    }

    return { listings, interactionsUsed };
}
