import { RawListing } from '../listing-scraper';
import { PageFetcher } from '../page-fetcher';
import * as cheerio from 'cheerio';

const BAZARAKI_SELECTORS = {
    listingContainer: '.advert, .advert-grid',
    title: '.advert__content-title, .advert-grid__content-title',
    listingLink: 'a.swiper-slide[href], a.advert-grid__body-image-paginator-container[href]',
    price: '.advert__content-price, .advert-grid__content-price',
    location: '.advert__content-place, .advert-grid__content-place, .advert-grid__content-hint .advert-grid__content-place',
    nextPage: 'a.number-list-next, a.number-list-line',
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
    nextPageUrl?: string;
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
        // Get listing URL from swiper slide link or any <a> with a /adv/ path
        const linkEl = $(el).find(BAZARAKI_SELECTORS.listingLink).first();
        let href = linkEl.attr('href');

        // Fallback: try any <a> whose href contains /adv/ and an ID
        if (!href) {
            $(el).find('a[href]').each((_, a) => {
                const h = $(a).attr('href');
                if (h && (h.includes('/adv/') || h.match(/(\d+)/))) { href = h; return false; }
            });
        }
        if (!href) return;

        const absoluteUrl = href.startsWith('http') ? href : `https://www.bazaraki.com${href}`;
        // Extract numeric ID from URL like /adv/4424521_...
        const matchId = absoluteUrl.match(/\/adv\/(\d+)/) || absoluteUrl.match(/(\d+)/);
        const externalId = matchId ? matchId[1] : `bz-${Date.now()}`;

        // Title is plain text inside .advert__content-title (no longer an <a>)
        const title = $(el).find(BAZARAKI_SELECTORS.title).text().trim();
        const priceText = $(el).find(BAZARAKI_SELECTORS.price).text() || '0';
        const priceMatch = priceText.match(/(?:€|£|\$)?\s*([\d., ]+)/);
        let cleanPrice = 0;
        if (priceMatch && priceMatch[1]) {
            cleanPrice = parseInt(priceMatch[1].replace(/\D/g, '') || '0');
        } else {
            cleanPrice = parseInt(priceText.replace(/\D/g, '') || '0');
        }
        const location = $(el).find(BAZARAKI_SELECTORS.location).text().trim() || 'Cyprus';

        shallowListings.push({
            url: absoluteUrl,
            externalId,
            title: title || 'No Title',
            description: '',
            price: cleanPrice,
            currency: 'EUR',
            location,
            listingType: absoluteUrl.includes('-rent') || absoluteUrl.includes('to-rent') ? 'rent' : 'sale'
        });
    });

    // Extract next page URL for pagination
    let nextPageUrl: string | undefined = undefined;
    const nextEl = $(BAZARAKI_SELECTORS.nextPage).first();
    const nextHref = nextEl.attr('href');
    if (nextHref) {
        nextPageUrl = nextHref.startsWith('http') ? nextHref : `https://www.bazaraki.com${nextHref}`;
        console.log(`[BazarakiExtractor] Found next page link: ${nextPageUrl}`);
    } else {
        console.log(`[BazarakiExtractor] No next page link found.`);
    }

    console.log(`[BazarakiExtractor] Found ${shallowListings.length} shallow listings on index.`);

    if (shallowListings.length === 0) {
        console.warn(`[BazarakiExtractor] ⚠️ 0 listings found! Page title: ${$('title').text()}, Content length: ${content.length}`);
        console.warn(`[BazarakiExtractor] HTML Snippet: ${content.substring(0, 500)}`);
    }

    // If Strategy is Shallow, we are done! Return immediately
    if (opts.strategy === 'shallow_duplication') {
        console.log(`[BazarakiExtractor] Strategy is Shallow. Returning early.`);
        return { listings: shallowListings, interactionsUsed: 0, nextPageUrl };
    }

    // 2. Strategy is Deep Extraction
    // Determine how many we can afford to deep scrape right now
    const deepCandidates = shallowListings.slice(0, Math.min(10, opts.interactionsAvailable));
    if (deepCandidates.length === 0) {
        console.log(`[BazarakiExtractor] No interaction budget available for deep extractions. Returning shallow.`);
        return { listings: shallowListings, interactionsUsed: 0, nextPageUrl };
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
                    const phoneBtn = page.locator('.phone-author.js-phone-click, .js-show-popup-contact-business').first();
                    if (await phoneBtn.isVisible()) {
                        await phoneBtn.click({ force: true });
                        await page.waitForTimeout(1500); // Give JS time to replace inner context

                        // First check inline
                        const inlinePhone = await page.locator('.phone-author-subtext__main').first().textContent() || '';
                        if (inlinePhone && inlinePhone.trim().length > 5 && inlinePhone.trim() !== '+35') {
                            phone = inlinePhone;
                        }

                        // Also check dialog if it appears
                        const dialogPhone = await page.locator('.contacts-dialog__phone a[href^="tel:"]').first().textContent().catch(() => '') || '';
                        if (dialogPhone) phone = dialogPhone;
                    } else {
                        phone = await page.locator('.phone-author-subtext__main').first().textContent() || '';
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

    return { listings, interactionsUsed, nextPageUrl };
}

/**
 * Quick extractor for deep scrape descriptions
 */
export function extractBazarakiDescription(html: string): string {
    const $ = cheerio.load(html);
    const description = $('.announcement-description').text();
    return description ? description.trim() : '';
}
