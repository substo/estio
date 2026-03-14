import { RawListing } from '../listing-scraper';
import { PageFetcher } from '../page-fetcher';
import * as cheerio from 'cheerio';

const BAZARAKI_SELECTORS = {
    listingContainer: '.announcement-block__title a[href]',
    title: '.announcement-block__title',
    price: '.announcement-block__price',
    location: '.announcement-block__city',
};

/**
 * Stage 1: Fast Parsing of the index page to grab basic details and absolute URLs
 */
export async function extractBazarakiIndex(content: string, baseUrl: string, fetcher: PageFetcher): Promise<RawListing[]> {
    const $ = cheerio.load(content);
    const listings: RawListing[] = [];

    // 1. Gather URLs from the index page
    const listingLinks: string[] = [];
    $(BAZARAKI_SELECTORS.listingContainer).each((_, el) => {
        const href = $(el).attr('href');
        if (href) {
            // Bazaraki hrefs are relative
            const absoluteUrl = href.startsWith('http') ? href : `https://www.bazaraki.com${href}`;
            listingLinks.push(absoluteUrl);
        }
    });

    console.log(`[BazarakiExtractor] Found ${listingLinks.length} listing links on index.`);

    // 2. Deep Dive (Rate Limited) to get phones
    // To prevent massive scraping blocks, we only process a few in this spec
    const limitLinks = listingLinks.slice(0, 5); 

    for (const link of limitLinks) {
        try {
            console.log(`[BazarakiExtractor] Fetching details for: ${link}`);
            const detailListing = await fetcher.executeOnPage({ url: link, jsEnabled: true }, async (page) => {
                
                // Get basic metadata from DOM
                const title = await page.locator('h1.announcement-title').textContent().catch(() => 'Unknown Title');
                const priceText = await page.locator('.announcement-price__cost').textContent().catch(() => '0');
                const description = await page.locator('.announcement-description').textContent().catch(() => '');
                const location = await page.locator('.announcement__location').textContent().catch(() => 'Cyprus');
                
                // Try to click "Show phone number" button
                let phone = '';
                try {
                    const phoneBtn = page.locator('.js-phone-number-button');
                    if (await phoneBtn.isVisible()) {
                        await phoneBtn.click();
                        await page.waitForTimeout(1000); // Give JS time to replace inner context
                        const phoneEl = page.locator('.js-phone-number-value');
                        phone = await phoneEl.textContent() || '';
                    } else {
                        // Sometimes the phone is just directly listed
                        phone = await page.locator('.js-phone-number-value').textContent() || '';
                    }
                } catch (e) {
                    console.log(`[BazarakiExtractor] Failed to reveal phone for ${link}`);
                }

                // Owner Name extraction (usually right rail sidebar)
                const ownerName = await page.locator('.author-card__name').textContent().catch(() => 'Bazaraki Owner');

                // Clean price
                const cleanPrice = parseInt(priceText?.replace(/\D/g, '') || '0');
                
                // Listing ID from URL
                const matchId = link.match(/\/(\d+)\/$/);
                const externalId = matchId ? matchId[1] : `bz-${Date.now()}`;

                return {
                    url: link,
                    externalId,
                    title: title?.trim() || 'No Title',
                    description: description?.trim() || '',
                    price: cleanPrice,
                    currency: 'EUR',
                    location: location?.trim(),
                    ownerName: ownerName?.trim(),
                    ownerPhone: phone.trim().replace(/\s+/g, ''),
                    listingType: link.includes('-rent/') ? 'rent' : 'sale',
                } as RawListing;
            });
            
            listings.push(detailListing);

        } catch (detailError) {
             console.error(`[BazarakiExtractor] Skipping listing ${link} due to error`);
        }
        
        // Wait between detail impressions to mimic human
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
    }

    return listings;
}
