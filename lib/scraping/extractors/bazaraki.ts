import { RawListing } from '../listing-scraper';
import { PageFetcher } from '../page-fetcher';
import * as cheerio from 'cheerio';

const BAZARAKI_SELECTORS = {
    // Cover search pages (.advert, .advert-grid) AND seller profile pages (.announcement-block, .classified, .list-simple__output)
    listingContainer: '.advert, .advert-grid, .announcement-block, .classified, .list-simple__output .announcement-container, .list-simple__output > li',
    title: '.advert__content-title, .advert-grid__content-title, .announcement-block__title a, .classified__title',
    listingLink: 'a.swiper-slide[href], a.advert-grid__body-image-paginator-container[href], .announcement-block__title a[href], a[href*="/adv/"]',
    price: '.advert__content-price, .advert-grid__content-price, .announcement-block__price, .classified__price',
    location: '.advert__content-place, .advert-grid__content-place, .advert-grid__content-hint .advert-grid__content-place, .announcement-block__place, .classified__location',
    nextPage: 'a.number-list-next, a.number-list-line',
};

export interface BazarakiExtractionOptions {
    strategy: 'shallow_duplication' | 'deep_extraction';
    sellerType: 'individual' | 'agency' | 'all';
    interactionsAvailable: number;
    delayBaseMs: number;
    delayJitterMs: number;
    knownPhone?: string;
}

export interface BazarakiExtractionResult {
    listings: RawListing[];
    interactionsUsed: number;
    nextPageUrl?: string;
}

export interface BazarakiDeepListingOptions {
    sellerType?: 'individual' | 'agency' | 'all';
    knownPhone?: string;
}

// Random Gaussian-like delay for human emulation
const humanDelay = async (baseMs: number, jitterMs: number) => {
    const offset = Math.floor(Math.random() * (jitterMs * 2 + 1)) - jitterMs;
    const finalDelay = Math.max(500, baseMs + offset);
    await new Promise((resolve) => setTimeout(resolve, finalDelay));
};

const toAbsoluteBazarakiUrl = (href: string): string => {
    if (href.startsWith('http')) return href;
    return `https://www.bazaraki.com${href.startsWith('/') ? '' : '/'}${href}`;
};

const parseFirstInt = (value?: string | null): number | undefined => {
    if (!value) return undefined;
    const match = value.match(/(\d+)/);
    if (!match) return undefined;
    const parsed = parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const parseBedroomsValue = (value?: string | null): number | undefined => {
    if (!value) return undefined;
    if (/studio/i.test(value)) return 0;
    return parseFirstInt(value);
};

const parseOtherListingsCount = (value?: string | null): number | undefined => {
    if (!value) return undefined;
    // Examples: "Other ads from this seller (21)" or "21 more ads"
    const match = value.match(/(\d{1,4})/);
    if (!match) return undefined;
    const parsed = parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const isLikelyAgencyName = (name?: string): boolean => {
    if (!name) return false;
    const normalized = name.toLowerCase();
    return normalized.includes('real estate') ||
        normalized.includes('properties') ||
        normalized.includes('agency');
};

const extractCardFeatures = ($: cheerio.CheerioAPI, el: any): Pick<RawListing, 'bedrooms' | 'bathrooms' | 'propertyArea' | 'rawAttributes'> => {
    const featureValues = $(el)
        .find('.advert-grid__content-features .advert-grid__content-feature')
        .map((_, featureEl) => $(featureEl).find('div').last().text().trim())
        .get()
        .filter((value) => Boolean(value && value.trim()));

    if (featureValues.length === 0) {
        return {};
    }

    const rawAttributes: Record<string, string> = {};
    const [bedroomsText, bathroomsText, petsText, sizeText] = featureValues;

    if (bedroomsText) rawAttributes['Bedrooms'] = bedroomsText;
    if (bathroomsText) rawAttributes['Bathrooms'] = bathroomsText;
    if (petsText) rawAttributes['Pets allowed'] = petsText;
    if (sizeText) rawAttributes['Property area'] = sizeText;

    return {
        bedrooms: parseBedroomsValue(bedroomsText),
        bathrooms: parseFirstInt(bathroomsText),
        propertyArea: parseFirstInt(sizeText),
        rawAttributes,
    };
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

        const absoluteUrl = toAbsoluteBazarakiUrl(href);
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
        const featureData = extractCardFeatures($, el);

        shallowListings.push({
            url: absoluteUrl,
            externalId,
            title: title || 'No Title',
            description: '',
            price: cleanPrice,
            currency: 'EUR',
            location,
            listingType: absoluteUrl.includes('-rent') || absoluteUrl.includes('to-rent') ? 'rent' : 'sale',
            bedrooms: featureData.bedrooms,
            bathrooms: featureData.bathrooms,
            propertyArea: featureData.propertyArea,
            rawAttributes: featureData.rawAttributes,
        });
    });

    // Extract next page URL for pagination
    let nextPageUrl: string | undefined = undefined;
    const nextEl = $(BAZARAKI_SELECTORS.nextPage).first();
    const nextHref = nextEl.attr('href');
    if (nextHref) {
        nextPageUrl = toAbsoluteBazarakiUrl(nextHref);
        console.log(`[BazarakiExtractor] Found next page link: ${nextPageUrl}`);
    } else {
        console.log(`[BazarakiExtractor] No next page link found.`);
    }

    console.log(`[BazarakiExtractor] Found ${shallowListings.length} shallow listings on index.`);

    if (shallowListings.length === 0) {
        console.warn(`[BazarakiExtractor] ⚠️ 0 listings found! Page title: ${$('title').text()}, Content length: ${content.length}`);
        console.warn(`[BazarakiExtractor] HTML Snippet (first 1000): ${content.substring(0, 1000)}`);

        // Dump container-level elements for debugging
        const allAnchors = $('a[href*="/adv/"]').length;
        console.warn(`[BazarakiExtractor] Total <a href="/adv/..."> links on page: ${allAnchors}`);
        if (allAnchors > 0) {
            // Fallback: extract listings from any <a> that links to /adv/
            console.warn(`[BazarakiExtractor] Attempting fallback extraction from raw /adv/ links...`);
            const seenIds = new Set<string>();
            $('a[href*="/adv/"]').each((_, el) => {
                const href = $(el).attr('href');
                if (!href || !href.match(/\/adv\/\d+/)) return;
                const absoluteUrl = toAbsoluteBazarakiUrl(href);
                const matchId = absoluteUrl.match(/\/adv\/(\d+)/);
                const externalId = matchId ? matchId[1] : '';
                if (!externalId || seenIds.has(externalId)) return;
                seenIds.add(externalId);

                const title = $(el).text().trim() || 'No Title';
                shallowListings.push({
                    url: absoluteUrl,
                    externalId,
                    title,
                    description: '',
                    price: 0,
                    currency: 'EUR',
                    location: 'Cyprus',
                    listingType: absoluteUrl.includes('-rent') || absoluteUrl.includes('to-rent') ? 'rent' : 'sale'
                });
            });
            console.warn(`[BazarakiExtractor] Fallback found ${shallowListings.length} listings from raw links.`);
        }
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
            const deepResult = await deepScrapeBazarakiListing(shallow, fetcher, {
                sellerType: opts.sellerType,
                knownPhone: opts.knownPhone,
            });

            listings.push(deepResult.listing);
            interactionsUsed += deepResult.interactionsUsed;

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

export async function deepScrapeBazarakiListing(
    shallow: RawListing,
    fetcher: PageFetcher,
    options?: BazarakiDeepListingOptions
): Promise<{ listing: RawListing; interactionsUsed: number; skippedBySellerType: boolean }> {
    const opts = options || {};
    const sellerType = opts.sellerType || 'all';

    const result = await fetcher.executeOnPage({ url: shallow.url, jsEnabled: true }, async (page) => {
        let deepData = { ...shallow };
        let skippedBySellerType = false;

        // Get basic metadata from DOM
        const description = await page.locator('.announcement-description, .js-description').first().textContent().catch(() => '');
        deepData.description = description?.trim() || '';

        // Keep detail location when available (profile-card location can be abbreviated)
        const locationText = await page.locator('.announcement__location span[itemprop="address"]').first().textContent().catch(() => '');
        if (locationText?.trim()) {
            deepData.location = locationText.trim();
        }

        // Owner Name extraction
        const ownerName = await page.locator('.author-card__name, .author-info .author-name, .author-info [itemprop="name"]').first().textContent().catch(() => 'Bazaraki Owner');
        deepData.ownerName = ownerName?.trim();
        const sellerExternalId = await page.locator('.author-info .author-name[data-user], .author-info a[data-user]').first().getAttribute('data-user').catch(() => undefined);
        if (sellerExternalId) deepData.sellerExternalId = sellerExternalId;

        const sellerRegisteredAt = await page.locator('.date-registration, .contacts-dialog__date').first().textContent().catch(() => undefined);
        if (sellerRegisteredAt?.trim()) deepData.sellerRegisteredAt = sellerRegisteredAt.trim();

        const otherListingsHref = await page.locator('a.other-announcement-author').first().getAttribute('href').catch(() => undefined);
        if (otherListingsHref) deepData.otherListingsUrl = toAbsoluteBazarakiUrl(otherListingsHref);

        const otherListingsText = await page.locator('a.other-announcement-author').first().textContent().catch(() => undefined);
        const otherListingsCount = parseOtherListingsCount(otherListingsText);
        if (otherListingsCount !== undefined) deepData.otherListingsCount = otherListingsCount;

        // Business profile block ("author_business__wrapper") — appears for agency/business accounts.
        const authorBusiness = await page.evaluate(() => {
            const wrapper = document.querySelector('.author_business__wrapper');
            if (!wrapper) return null;

            const text = (selector: string) => wrapper.querySelector(selector)?.textContent?.trim() || '';
            const websiteEl = wrapper.querySelector('a.website') as HTMLAnchorElement | null;

            return {
                name: text('.author_business__header h1'),
                verified: !!wrapper.querySelector('.author_business__header-verified'),
                postingSince: text('.author_business__header-since'),
                address: text('.author_business__contacts .address'),
                website: websiteEl?.href || websiteEl?.textContent?.trim() || '',
                description: text('.author_business__description'),
            };
        }).catch(() => null as any);

        if (authorBusiness?.name) {
            // Prefer explicit business profile title when present.
            deepData.ownerName = authorBusiness.name;
        }
        if (authorBusiness?.postingSince && !deepData.sellerRegisteredAt) {
            deepData.sellerRegisteredAt = authorBusiness.postingSince;
        }
        if (authorBusiness?.website) {
            const channels = new Set(deepData.contactChannels || []);
            channels.add('website');
            deepData.contactChannels = Array.from(channels);
        }

        // Parse structured key-value attributes
        const rawAttributes = await page.$$eval('ul.chars-column li', (items) => {
            const output: Record<string, string> = {};
            for (const li of items) {
                const key = li.querySelector('.key-chars')?.textContent?.replace(':', '').trim();
                const value = li.querySelector('.value-chars')?.textContent?.trim();
                if (key && value) output[key] = value;
            }
            return output;
        }).catch(() => ({} as Record<string, string>));

        if (rawAttributes && Object.keys(rawAttributes).length > 0) {
            deepData.rawAttributes = {
                ...(deepData.rawAttributes || {}),
                ...rawAttributes,
            };
        }

        if (authorBusiness) {
            deepData.rawAttributes = {
                ...(deepData.rawAttributes || {}),
                ...(authorBusiness.name ? { 'Seller business name': authorBusiness.name } : {}),
                ...(authorBusiness.verified !== undefined ? { 'Seller business verified': authorBusiness.verified ? 'Yes' : 'No' } : {}),
                ...(authorBusiness.postingSince ? { 'Seller business posting since': authorBusiness.postingSince } : {}),
                ...(authorBusiness.address ? { 'Seller business address': authorBusiness.address } : {}),
                ...(authorBusiness.website ? { 'Seller business website': authorBusiness.website } : {}),
                ...(authorBusiness.description ? { 'Seller business description': authorBusiness.description } : {}),
            };
        }

        const parsedBedrooms = parseBedroomsValue(rawAttributes?.['Bedrooms']);
        const parsedBathrooms = parseFirstInt(rawAttributes?.['Bathrooms']);
        const parsedPropertyArea = parseFirstInt(rawAttributes?.['Property area']);
        const parsedPlotArea = parseFirstInt(rawAttributes?.['Plot area']);
        const parsedConstructionYear = parseFirstInt(rawAttributes?.['Construction year']);

        if (parsedBedrooms !== undefined) deepData.bedrooms = parsedBedrooms;
        if (parsedBathrooms !== undefined) deepData.bathrooms = parsedBathrooms;
        if (parsedPropertyArea !== undefined) deepData.propertyArea = parsedPropertyArea;
        if (parsedPlotArea !== undefined) deepData.plotArea = parsedPlotArea;
        if (parsedConstructionYear !== undefined) deepData.constructionYear = parsedConstructionYear;

        // --- TARGET SELLER TYPE FILTERING ---
        const isAgency = isLikelyAgencyName(deepData.ownerName);

        if (sellerType === 'individual' && isAgency) {
            console.log(`[BazarakiExtractor] Skipping Deep Contact grab, identified as Agency: ${deepData.ownerName}`);
            skippedBySellerType = true;
            return { deepData, skippedBySellerType };
        }
        if (sellerType === 'agency' && !isAgency) {
            console.log(`[BazarakiExtractor] Skipping Deep Contact grab, identified as Individual: ${deepData.ownerName}`);
            skippedBySellerType = true;
            return { deepData, skippedBySellerType };
        }

        if (opts.knownPhone) {
            console.log('[BazarakiExtractor] Skipping interaction: Phone number already known');
            deepData.ownerPhone = opts.knownPhone.replace(/\s+/g, '');
        } else {
            // Try to click "Show phone number" button
            let phone = '';
            try {
                const phoneBtn = page.locator('.phone-author.js-phone-click, .js-show-popup-contact-business').first();
                if (await phoneBtn.isVisible()) {
                    await phoneBtn.click({ force: true });
                    await page.waitForTimeout(1500);

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
        }

        return { deepData, skippedBySellerType };
    });

    return {
        listing: result.deepData,
        interactionsUsed: opts.knownPhone || result.skippedBySellerType ? 0 : 1,
        skippedBySellerType: result.skippedBySellerType,
    };
}
