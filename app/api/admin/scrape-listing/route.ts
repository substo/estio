import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import db from '@/lib/db';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const { userId } = await auth();
    if (!userId) return new NextResponse('Unauthorized', { status: 401 });

    const user = await db.user.findUnique({ where: { clerkId: userId } });
    if (!user) return new NextResponse('Unauthorized', { status: 401 });

    const { listingId, url, platform } = await req.json();

    if (!url || !platform) {
        return new NextResponse('Missing url or platform', { status: 400 });
    }

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            const sendEvent = (data: any) => {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
                } catch (e) {
                    // Stream may be closed
                }
            };

            console.log(`[Scrape Listing] Starting for ${url} (platform=${platform})`);
            sendEvent({ status: 'initializing', message: 'Launching headless browser...' });

            let fetcher: any = null;

            try {
                // 1. Find a healthy credential for this platform
                const connection = await db.scrapingConnection.findFirst({
                    where: { platform, enabled: true },
                });

                let sessionState: any = undefined;
                let activeCredentialId: string | undefined = undefined;

                if (connection) {
                    const credential = await db.scrapingCredential.findFirst({
                        where: { connectionId: connection.id, status: 'active' },
                        orderBy: { lastUsedAt: 'asc' },
                    });

                    if (credential?.sessionState) {
                        sessionState = credential.sessionState;
                        activeCredentialId = credential.id;
                        sendEvent({ status: 'credential_found', message: `Using credential: ${credential.authUsername || credential.id.slice(0, 8)}` });
                    } else {
                        sendEvent({ status: 'no_credential', message: 'No active credential found. Proceeding without session cookies.' });
                    }
                } else {
                    sendEvent({ status: 'no_connection', message: 'No connection pool found for this platform. Proceeding without auth.' });
                }

                // 2. Launch PageFetcher
                sendEvent({ status: 'navigating', message: `Navigating to ${url}...` });

                const { PageFetcher } = await import('@/lib/scraping/page-fetcher');
                fetcher = new PageFetcher();

                // 3. Platform-specific extraction
                if (platform === 'bazaraki') {
                    const result = await scrapeBazarakiListing(fetcher, url, sessionState, sendEvent);

                    if (result && result.sessionExpired && activeCredentialId) {
                        await db.scrapingCredential.update({
                            where: { id: activeCredentialId },
                            data: { status: 'needs_auth' }
                        });
                        sendEvent({ status: 'error', error: 'Credential session expired. Please re-authenticate via Settings.' });
                    }

                    // 4. Upsert the listing + prospect
                    if (result) {
                        sendEvent({ status: 'saving', message: 'Saving extracted data to database...' });

                        // Find the listing's locationId
                        let locationId: string | null = null;
                        if (listingId) {
                            const existingListing = await db.scrapedListing.findUnique({
                                where: { id: listingId },
                                select: { locationId: true },
                            });
                            locationId = existingListing?.locationId || null;
                        }

                        if (!locationId) {
                            // Fallback: get from user's first location
                            const userWithLocs = await db.user.findUnique({
                                where: { id: user.id },
                                include: { locations: { take: 1 } },
                            });
                            locationId = userWithLocs?.locations?.[0]?.id || null;
                        }

                        if (!locationId) {
                            sendEvent({ status: 'error', error: 'Could not determine locationId for this listing.' });
                            return;
                        }

                        await upsertListingData(listingId, locationId, platform, url, result, sendEvent);

                        sendEvent({
                            status: 'success',
                            message: 'Scrape completed successfully!',
                            data: result,
                        });
                    }
                } else {
                    sendEvent({ status: 'error', error: `Platform "${platform}" is not yet supported for single-listing scrape.` });
                }

            } catch (error: any) {
                console.error(`[Scrape Listing] Error:`, error);
                let debugHtml = '';
                try {
                    if (fetcher && (fetcher as any).page) {
                        const page = (fetcher as any).page;
                        debugHtml = await page.evaluate(() =>
                            document.body?.innerHTML?.substring(0, 3000) || 'empty'
                        );
                    }
                } catch (e) { /* page might be closed */ }

                sendEvent({
                    status: 'error',
                    error: error.message || 'Unknown error',
                    debugHtml,
                });
            } finally {
                if (fetcher) {
                    try { await fetcher.close(); } catch (e) { }
                }
                try { controller.close(); } catch (e) { }
            }
        }
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    });
}

// --- Bazaraki single-listing scraper ---

interface ScrapedData {
    title: string;
    description: string;
    price: number | null;
    currency: string;
    location: string;
    ownerName: string;
    ownerPhone: string;
    images: string[];
    thumbnails: string[];
    propertyType: string;
    externalId: string;

    // New Fields
    bedrooms?: number;
    bathrooms?: number;
    propertyArea?: number;
    plotArea?: number;
    constructionYear?: number;
    listingType?: string;
    latitude?: number;
    longitude?: number;
    sellerExternalId?: string;
    sellerRegisteredAt?: string;
    otherListingsUrl?: string;
    contactChannels?: string[];
    whatsappPhone?: string;
    rawAttributes?: Record<string, string>;
    sessionExpired?: boolean;
}

async function scrapeBazarakiListing(
    fetcher: any,
    url: string,
    sessionState: any,
    sendEvent: (data: any) => void
): Promise<ScrapedData | null> {

    const result = await fetcher.executeOnPage(
        { url, jsEnabled: true, sessionState, timeout: 30000 },
        async (page: any) => {
            const pageTitle = await page.title();
            const contentLength = (await page.content()).length;

            sendEvent({
                status: 'page_loaded',
                message: `Page loaded — Title: "${pageTitle}", Size: ${contentLength} chars`,
            });

            sendEvent({ status: 'extracting', message: 'Extracting listing data...' });

            // Extract external ID from URL
            const idMatch = url.match(/\/adv\/(\d+)/);
            const externalId = idMatch ? idMatch[1] : `bz-${Date.now()}`;

            // Title
            const titleSelectors = ['h1.title-announcement', '#ad-title', '.announcement-block__title', 'h1'];
            let title = '';
            for (const sel of titleSelectors) {
                title = await page.locator(sel).first().textContent().catch(() => '') || '';
                if (title.trim()) break;
            }
            title = title.trim() || 'No Title';
            sendEvent({ status: 'extracting', message: `Title: ${title}` });

            // Description
            const description = await page.locator('.js-description').textContent().catch(() => '') || '';
            sendEvent({ status: 'extracting', message: `Description: ${description.trim().substring(0, 100)}...` });

            // Price & Currency
            let cleanPrice: number | null = null;
            const metaPrice = await page.locator('meta[itemprop="price"]').getAttribute('content').catch(() => null);
            if (metaPrice) {
                cleanPrice = parseInt(metaPrice, 10) || null;
            }
            if (!cleanPrice) {
                const priceText = await page.locator('.announcement-price__cost').evaluate((el: HTMLElement) => {
                    const clone = el.cloneNode(true) as HTMLElement;
                    const perMeter = clone.querySelector('.announcement-price__per-meter');
                    if (perMeter) perMeter.remove();
                    return clone.textContent?.trim() || '0';
                }).catch(() => '0') || '0';
                cleanPrice = parseInt(priceText.replace(/\D/g, '') || '0') || null;
            }
            const currency = await page.locator('meta[itemprop="priceCurrency"]').getAttribute('content').catch(() => 'EUR') || 'EUR';
            sendEvent({ status: 'extracting', message: `Price: ${cleanPrice ? `${currency} ${cleanPrice.toLocaleString()}` : 'POA'}` });

            // Location
            const location = await page.locator('.announcement__location span[itemprop="address"]').textContent().catch(() => '') || '';
            sendEvent({ status: 'extracting', message: `Location: ${location.trim() || 'N/A'}` });

            // Owner Name & Info
            let ownerName = '';
            try {
                // Try specific selectors within the author info section
                ownerName = await page.locator('.author-info .author-name').first().textContent().catch(() => '') || '';
                if (!ownerName.trim()) {
                    ownerName = await page.locator('.author-info a[data-user]').first().textContent().catch(() => '') || '';
                }
                if (!ownerName.trim()) {
                    ownerName = await page.locator('.author-info [itemprop="name"]').first().textContent().catch(() => '') || '';
                }
            } catch (e) { /* ignore */ }
            const sellerExternalId = await page.locator('.author-info .author-name[data-user], .author-info a[data-user]').first().getAttribute('data-user').catch(() => undefined);
            const sellerRegisteredAt = await page.locator('.date-registration').textContent().catch(() => undefined);
            const otherListingsUrl = await page.locator('a.other-announcement-author').getAttribute('href').catch(() => undefined);

            sendEvent({ status: 'extracting', message: `Owner: ${ownerName.trim() || 'Unknown'} (ID: ${sellerExternalId || 'N/A'})` });

            // Property type from breadcrumbs or metadata
            const propertyType = await page.locator('.breadcrumbs__link').last().textContent().catch(() => '') || '';
            const listingType = url.includes('-rent') || url.includes('to-rent') ? 'rent' : 'sale';

            // Images (Bazaraki lazy-loads with data-src for full images, and src for thumbnails)
            let images: string[] = [];
            let thumbnails: string[] = [];
            try {
                // First try to extract from the specific multi-image swiper where full hi-res exist
                const extracted = await page.locator('.announcement__images-item.js-image-show-full, .gallery img, .announcement-media img, .swiper-slide img, .swiper-wrapper img, .announcement-gallery img, .photos-slider img, .ad-card-image img').evaluateAll(
                    (els: HTMLImageElement[]) => els.map(el => {
                        const full = el.getAttribute('data-full') || el.getAttribute('data-src') || el.getAttribute('data-lazy') || el.getAttribute('src') || '';
                        const thumb = el.getAttribute('src') || full;
                        return { full, thumb };
                    }).filter((item) => item.full && item.full.startsWith('http'))
                );

                // Keep only unique ones by full url and limit to 10
                const uniqueItems: { full: string, thumb: string }[] = [];
                const seenFulls = new Set();
                for (const item of extracted) {
                    if (!seenFulls.has(item.full)) {
                        seenFulls.add(item.full);
                        uniqueItems.push(item);
                    }
                }

                const topItems = uniqueItems.slice(0, 10);
                images = topItems.map(item => item.full);
                thumbnails = topItems.map(item => item.thumb);

                // Fallback for thumbnails if they weren't in the main slider
                if (thumbnails.length === 0) {
                    const thumbExtracted = await page.locator('.announcement__thumbnails-item.js-select-image, .announcement__thumbnails-wrapper img').evaluateAll(
                        (els: HTMLImageElement[]) => els.map(el => el.getAttribute('src') || '').filter(s => s && s.startsWith('http'))
                    ) as string[];
                    thumbnails = [...new Set(thumbExtracted)].slice(0, 10);
                }
            } catch (e) { /* no images */ }
            sendEvent({ status: 'extracting', message: `Images found: ${images.length}, Thumbnails: ${thumbnails.length}` });

            // ===== PHONE NUMBER EXTRACTION =====
            let ownerPhone = '';
            let sessionExpired = false;
            try {
                // STEP 1: Dismiss cookie consent / CMP overlay
                sendEvent({ status: 'extracting', message: '📋 Dismissing cookie consent overlay...' });
                await page.evaluate(() => {
                    try {
                        if (typeof (window as any).__cmp === 'function') {
                            (window as any).__cmp('setConsent', { isConsentTool: true, vendors: { purposes: {}, legitimateInterests: {} } });
                        }
                    } catch (e) { /* ignore */ }
                    const cmpWrapper = document.getElementById('cmpwrapper');
                    if (cmpWrapper) cmpWrapper.remove();
                    // Also remove any generic overlay/modal blockers
                    document.querySelectorAll('.cmpwrapper, [class*="cookie-banner"], [class*="consent-banner"]').forEach(el => (el as HTMLElement).remove());
                }).catch(() => {});
                await page.waitForTimeout(300);

                // STEP 2: Analyze session state and phone button
                const phoneDiag = await page.evaluate(() => {
                    const phoneBtnEl = document.querySelector('.phone-author.js-phone-click') as HTMLElement | null;
                    const phoneSubtext = document.querySelector('.phone-author-subtext__main');
                    const isRedirectToLogin = phoneBtnEl ? phoneBtnEl.classList.contains('js-redirect-to-login') : false;
                    const isShowPopup = phoneBtnEl ? phoneBtnEl.classList.contains('js-show-popup-contact-business') : false;
                    const dataUrl = phoneBtnEl?.getAttribute('data-url') || '';
                    const dataAdvert = phoneBtnEl?.getAttribute('data-advert') || '';
                    
                    return {
                        exists: !!phoneBtnEl,
                        isLoggedIn: isShowPopup && !isRedirectToLogin,
                        isRedirectToLogin,
                        phoneSubtext: phoneSubtext?.textContent?.trim() || '',
                        dataUrl,      // e.g. "/phone_check/6186406_office-for-rent/"
                        dataAdvert,   // e.g. "6186406"
                        btnClasses: phoneBtnEl?.className || '',
                    };
                }).catch(() => ({ exists: false, isLoggedIn: false, isRedirectToLogin: false, phoneSubtext: '', dataUrl: '', dataAdvert: '', btnClasses: '' }));

                sendEvent({ status: 'phone_debug', message: `Session: ${phoneDiag.isLoggedIn ? '✅ LOGGED IN' : '⚠️ NOT LOGGED IN (js-redirect-to-login)'}, subtext="${phoneDiag.phoneSubtext}", dataUrl="${phoneDiag.dataUrl}"` });

                if (!phoneDiag.exists) {
                    sendEvent({ status: 'extracting', message: '❌ Phone button not found on page' });
                } else if (phoneDiag.isRedirectToLogin && !phoneDiag.isLoggedIn) {
                    sessionExpired = true;
                    // === SESSION EXPIRED PATH ===
                    sendEvent({ status: 'extracting', message: '⚠️ Session expired — trying AJAX phone_check endpoint...' });

                    // Method 1: Try the /phone_check/ AJAX endpoint directly
                    if (phoneDiag.dataUrl) {
                        try {
                            const phoneCheckResult = await page.evaluate(async (checkUrl: string) => {
                                try {
                                     const resp = await fetch(checkUrl, {
                                         method: 'POST',
                                         headers: {
                                             'X-Requested-With': 'XMLHttpRequest',
                                             'Accept': 'application/json, text/html, */*',
                                         },
                                         credentials: 'include',
                                     });
                                    const text = await resp.text();
                                    return { status: resp.status, body: text.substring(0, 2000) };
                                } catch (e: any) {
                                    return { status: 0, body: e.message };
                                }
                            }, phoneDiag.dataUrl);

                            sendEvent({ status: 'phone_debug', message: `phone_check response: status=${phoneCheckResult.status}, body=${phoneCheckResult.body.substring(0, 300)}` });

                            // Try to parse phone from the HTML/JSON response
                            const phoneMatch = phoneCheckResult.body.match(/(\+?\d[\d\s\-]{7,})/);
                            if (phoneMatch) {
                                ownerPhone = phoneMatch[1].replace(/[\s\-]/g, '');
                                sendEvent({ status: 'extracting', message: `📞 Phone (from AJAX): ${ownerPhone}` });
                            }
                        } catch (e: any) {
                            sendEvent({ status: 'extracting', message: `AJAX phone_check failed: ${e.message?.substring(0, 100)}` });
                        }
                    }

                    // Method 2: Block navigation and try clicking anyway
                    if (!ownerPhone) {
                        sendEvent({ status: 'extracting', message: 'Trying JS click with navigation blocked...' });

                        const jsClickResult = await page.evaluate(() => {
                            // Block any navigation attempts
                            const origAssign = window.location.assign;
                            const origReplace = window.location.replace;
                            let interceptedUrl = '';

                            // Override navigation methods
                            window.addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; });
                            
                            // Remove the js-redirect-to-login class so the click handler doesn't redirect
                            const btn = document.querySelector('.phone-author.js-phone-click') as HTMLElement;
                            if (btn) {
                                btn.classList.remove('js-redirect-to-login');
                                btn.classList.add('js-show-popup-contact-business');
                                
                                // Also remove data-redirect to prevent jQuery handler from navigating
                                btn.removeAttribute('data-redirect');
                                
                                btn.click();
                                btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                            }
                            
                            return { clicked: !!btn };
                        }).catch(() => ({ clicked: false }));

                        if (jsClickResult.clicked) {
                            await page.waitForTimeout(2000);

                            // Check if phone was revealed
                            const postJsClick = await page.evaluate(() => {
                                const phoneSubtext = document.querySelector('.phone-author-subtext__main');
                                const phoneBtnEl = document.querySelector('.phone-author.js-phone-click');
                                const toggled = phoneBtnEl?.classList.contains('phone-author--toggled') || false;
                                const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]')).map(a => (a.textContent?.trim() || a.getAttribute('href') || '').replace('tel:', ''));
                                const dialogExists = !!document.querySelector('.contacts-dialog, .ui-dialog');
                                return {
                                    phoneSubtext: phoneSubtext?.textContent?.trim() || '',
                                    toggled,
                                    telLinks,
                                    dialogExists,
                                    currentUrl: window.location.href,
                                };
                            }).catch(() => ({ phoneSubtext: '', toggled: false, telLinks: [] as string[], dialogExists: false, currentUrl: '' }));

                            sendEvent({ status: 'phone_debug', message: `POST-JS-CLICK: subtext="${postJsClick.phoneSubtext}", toggled=${postJsClick.toggled}, telLinks=[${postJsClick.telLinks.join(',')}], dialog=${postJsClick.dialogExists}, url=${postJsClick.currentUrl}` });

                            if (postJsClick.phoneSubtext && postJsClick.phoneSubtext.length > 5 && postJsClick.phoneSubtext !== '+35') {
                                ownerPhone = postJsClick.phoneSubtext.replace(/\s+/g, '');
                                sendEvent({ status: 'extracting', message: `📞 Phone (JS click revealed): ${ownerPhone}` });
                            } else if (postJsClick.telLinks.length > 0) {
                                const tel = postJsClick.telLinks[0].replace(/\s+/g, '');
                                if (tel.length > 5) {
                                    ownerPhone = tel;
                                    sendEvent({ status: 'extracting', message: `📞 Phone (tel link): ${ownerPhone}` });
                                }
                            }
                        }
                    }

                    if (!ownerPhone) {
                        sendEvent({ status: 'extracting', message: '⚠️ Session expired and phone could not be retrieved. Credential may need re-authentication.' });
                    }

                } else {
                    // === LOGGED IN PATH (normal flow) ===
                    sendEvent({ status: 'extracting', message: '✅ Session active — clicking phone button...' });

                    // Block navigation as safety net
                    await page.evaluate(() => {
                        window.addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = ''; });
                    });

                    const phoneBtn = page.locator('.phone-author.js-phone-click, .js-show-popup-contact-business').first();
                    const btnVisible = await phoneBtn.isVisible({ timeout: 3000 }).catch(() => false);

                    if (btnVisible) {
                        // Try force click
                        try {
                            await phoneBtn.click({ force: true, timeout: 5000 });
                            sendEvent({ status: 'extracting', message: 'Click succeeded' });
                        } catch {
                            // JS fallback
                            await page.evaluate(() => {
                                const btn = document.querySelector('.phone-author.js-phone-click') as HTMLElement;
                                if (btn) { btn.click(); btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }
                            }).catch(() => {});
                            sendEvent({ status: 'extracting', message: 'Used JS click fallback' });
                        }

                        await page.waitForTimeout(2000);

                        // Extract phone from revealed state
                        const revealed = await page.evaluate(() => {
                            const phoneSubtext = document.querySelector('.phone-author-subtext__main');
                            const dialogPhone = document.querySelector('.contacts-dialog__phone a[href^="tel:"]');
                            const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]')).map(a => (a.textContent?.trim() || '').replace('tel:', ''));
                            const dialogExists = !!document.querySelector('.contacts-dialog, .ui-dialog');
                            return {
                                phoneSubtext: phoneSubtext?.textContent?.trim() || '',
                                dialogPhone: dialogPhone?.textContent?.trim() || '',
                                telLinks,
                                dialogExists,
                            };
                        }).catch(() => ({ phoneSubtext: '', dialogPhone: '', telLinks: [] as string[], dialogExists: false }));

                        sendEvent({ status: 'phone_debug', message: `REVEALED: subtext="${revealed.phoneSubtext}", dialogPhone="${revealed.dialogPhone}", dialog=${revealed.dialogExists}, telLinks=[${revealed.telLinks.join(',')}]` });

                        // Priority: dialog phone > inline subtext > any tel link
                        if (revealed.dialogPhone && revealed.dialogPhone.length > 5) {
                            ownerPhone = revealed.dialogPhone.replace(/\s+/g, '');
                        } else if (revealed.phoneSubtext && revealed.phoneSubtext.length > 5 && revealed.phoneSubtext !== '+35') {
                            ownerPhone = revealed.phoneSubtext.replace(/\s+/g, '');
                        } else if (revealed.telLinks.length > 0) {
                            const tel = revealed.telLinks[0].replace(/\s+/g, '');
                            if (tel.length > 5) ownerPhone = tel;
                        }

                        if (ownerPhone) {
                            sendEvent({ status: 'extracting', message: `📞 Phone: ${ownerPhone}` });
                        }

                        // Extract owner name from dialog if available
                        if (revealed.dialogExists) {
                            const dialogOwnerName = await page.locator('.contacts-dialog__name').first().evaluate((el: HTMLElement) => {
                                const clone = el.cloneNode(true) as HTMLElement;
                                clone.querySelectorAll('*').forEach(c => c.remove());
                                return clone.textContent?.trim() || '';
                            }).catch(() => '');
                            if (dialogOwnerName && dialogOwnerName.length > 1) {
                                ownerName = dialogOwnerName;
                                sendEvent({ status: 'extracting', message: `Owner (from dialog): ${ownerName}` });
                            }
                        }
                    }
                }

                // Final summary
                sendEvent({ status: 'extracting', message: ownerPhone ? `✅ Final phone: ${ownerPhone}` : '❌ No phone number extracted' });
            } catch (e: any) {
                sendEvent({ status: 'extracting', message: `Phone extraction error: ${e.message}` });
            }

            // Generic Characteristics Extractor
            const rawAttributes: Record<string, string> = {};
            try {
                const charItems = await page.locator('ul.chars-column li').all();
                for (const item of charItems) {
                    const key = await item.locator('.key-chars').textContent().catch(() => '');
                    const value = await item.locator('.value-chars').textContent().catch(() => '');
                    if (key && value) {
                        rawAttributes[key.replace(':', '').trim()] = value.trim();
                    }
                }
                sendEvent({ status: 'extracting', message: `Extracted ${Object.keys(rawAttributes).length} raw attributes` });
            } catch (e) { /* ignore */ }

            const bedrooms = parseInt(rawAttributes['Bedrooms']) || undefined;
            const bathrooms = parseInt(rawAttributes['Bathrooms']) || undefined;
            const propertyArea = parseInt(rawAttributes['Property area']?.replace(/\D/g, '')) || undefined;
            const plotArea = parseInt(rawAttributes['Plot area']?.replace(/\D/g, '')) || undefined;
            const constructionYear = parseInt(rawAttributes['Construction year']?.replace(/\D/g, '')) || undefined;

            // Geo
            const latitudeStr = await page.locator('.js-static-map').getAttribute('data-default-lat').catch(() => undefined);
            const longitudeStr = await page.locator('.js-static-map').getAttribute('data-default-lng').catch(() => undefined);
            const latitude = latitudeStr ? parseFloat(latitudeStr) : undefined;
            const longitude = longitudeStr ? parseFloat(longitudeStr) : undefined;

            // WhatsApp / Contact Channels
            let whatsappPhone = undefined;
            try {
                const waHref = await page.locator('a._whatsapp[href]').first().getAttribute('href').catch(() => undefined);
                if (waHref) {
                    const match = waHref.match(/phone=([^&]+)/);
                    if (match && match[1]) {
                        whatsappPhone = decodeURIComponent(match[1]);
                        sendEvent({ status: 'extracting', message: `Found WhatsApp Phone in URL: ${whatsappPhone}` });
                    }
                }
            } catch (e) { /* ignore */ }

            let contactChannels: string[] = [];
            try {
                if (whatsappPhone) contactChannels.push('whatsapp');
                const hasChat = await page.locator('.js-card-messenger').isVisible().catch(() => false);
                if (hasChat) contactChannels.push('chat');
                const hasEmail = await page.locator('._email').isVisible().catch(() => false);
                if (hasEmail) contactChannels.push('email');
            } catch (e) { /* ignore */ }

            return {
                title,
                description: description.trim(),
                price: cleanPrice,
                currency: currency,
                location: location.trim(),
                ownerName: ownerName.trim(),
                ownerPhone,
                images,
                thumbnails,
                propertyType: propertyType.trim(),
                externalId,
                bedrooms,
                bathrooms,
                propertyArea,
                plotArea,
                constructionYear,
                listingType,
                latitude,
                longitude,
                sellerExternalId,
                sellerRegisteredAt,
                otherListingsUrl,
                contactChannels,
                whatsappPhone,
                rawAttributes,
                sessionExpired
            };
        }
    );

    return result;
}

// --- Database upsert ---

async function upsertListingData(
    listingId: string | null,
    locationId: string,
    platform: string,
    url: string,
    data: ScrapedData,
    sendEvent: (d: any) => void,
) {
    // 0. Locate existing listing if any
    let existingScrapedListing = null;
    if (listingId) {
        existingScrapedListing = await db.scrapedListing.findUnique({ where: { id: listingId } });
    } else if (data.externalId) {
        existingScrapedListing = await db.scrapedListing.findUnique({
             where: { platform_externalId: { platform, externalId: data.externalId } }
        });
    }

    // 1. Upsert ProspectLead
    let prospectLeadId: string | null = existingScrapedListing?.prospectLeadId || null;

    if (data.ownerPhone || data.ownerName || data.sellerExternalId) {
        let existingProspect = null;

        if (prospectLeadId) {
            existingProspect = await db.prospectLead.findUnique({ where: { id: prospectLeadId } });
        }

        if (!existingProspect) {
            const orConditions: any[] = [];
            if (data.ownerPhone) orConditions.push({ phone: { contains: data.ownerPhone } });
            if (data.whatsappPhone) orConditions.push({ phone: { contains: data.whatsappPhone } });
            if (data.sellerExternalId) orConditions.push({ platformUserId: data.sellerExternalId });

            existingProspect = orConditions.length > 0
                ? await db.prospectLead.findFirst({ where: { locationId, OR: orConditions } })
                : null;
        }

        if (!existingProspect) {
            existingProspect = await db.prospectLead.create({
                data: {
                    locationId,
                    source: 'scraper_bot',
                    name: data.ownerName || null,
                    phone: data.whatsappPhone || data.ownerPhone || null, // Prefer whatsapp phone if found
                    status: 'new',
                    isAgency: false,
                    platformUserId: data.sellerExternalId,
                    platformRegistered: data.sellerRegisteredAt,
                },
            });
            sendEvent({ status: 'saving', message: `Created new prospect: ${data.ownerName || 'Unknown'}` });
        } else {
            // Update existing prospect with new data if richer
            const updateData: any = {};
            if (data.ownerName && !existingProspect.name) updateData.name = data.ownerName;

            const bestPhone = data.whatsappPhone || data.ownerPhone;
            if (bestPhone && !existingProspect.phone) updateData.phone = bestPhone;

            if (data.sellerExternalId && !existingProspect.platformUserId) updateData.platformUserId = data.sellerExternalId;
            if (data.sellerRegisteredAt && !existingProspect.platformRegistered) updateData.platformRegistered = data.sellerRegisteredAt;

            if (Object.keys(updateData).length > 0) {
                await db.prospectLead.update({ where: { id: existingProspect.id }, data: updateData });
            }
            sendEvent({ status: 'saving', message: `Linked to existing prospect: ${existingProspect.name || existingProspect.id.slice(0, 8)}` });
        }

        prospectLeadId = existingProspect.id;
    }

    // 2. Upsert ScrapedListing
    if (listingId) {
        // Update existing listing
        await db.scrapedListing.update({
            where: { id: listingId },
            data: {
                title: data.title,
                description: data.description,
                price: data.price,
                currency: data.currency,
                propertyType: data.propertyType || undefined,
                listingType: data.listingType || undefined,
                locationText: data.location || undefined,
                images: data.images,
                thumbnails: data.thumbnails,
                bedrooms: data.bedrooms,
                bathrooms: data.bathrooms,
                propertyArea: data.propertyArea,
                plotArea: data.plotArea,
                constructionYear: data.constructionYear,
                latitude: data.latitude,
                longitude: data.longitude,
                sellerExternalId: data.sellerExternalId,
                sellerRegisteredAt: data.sellerRegisteredAt,
                otherListingsUrl: data.otherListingsUrl,
                contactChannels: data.contactChannels,
                whatsappPhone: data.whatsappPhone,
                rawAttributes: data.rawAttributes,
                prospectLeadId,
            },
        });
        sendEvent({ status: 'saving', message: 'Updated existing listing record.' });
    } else {
        // Create new listing
        await db.scrapedListing.upsert({
            where: {
                platform_externalId: { platform, externalId: data.externalId },
            },
            update: {
                title: data.title,
                description: data.description,
                price: data.price,
                currency: data.currency,
                propertyType: data.propertyType || undefined,
                listingType: data.listingType || undefined,
                locationText: data.location || undefined,
                images: data.images,
                thumbnails: data.thumbnails,
                bedrooms: data.bedrooms,
                bathrooms: data.bathrooms,
                propertyArea: data.propertyArea,
                plotArea: data.plotArea,
                constructionYear: data.constructionYear,
                latitude: data.latitude,
                longitude: data.longitude,
                sellerExternalId: data.sellerExternalId,
                sellerRegisteredAt: data.sellerRegisteredAt,
                otherListingsUrl: data.otherListingsUrl,
                contactChannels: data.contactChannels,
                whatsappPhone: data.whatsappPhone,
                rawAttributes: data.rawAttributes,
                prospectLeadId,
            },
            create: {
                locationId,
                platform,
                externalId: data.externalId,
                url,
                title: data.title,
                description: data.description,
                price: data.price,
                currency: data.currency,
                propertyType: data.propertyType || undefined,
                listingType: data.listingType || undefined,
                locationText: data.location || undefined,
                images: data.images,
                thumbnails: data.thumbnails,
                bedrooms: data.bedrooms,
                bathrooms: data.bathrooms,
                propertyArea: data.propertyArea,
                plotArea: data.plotArea,
                constructionYear: data.constructionYear,
                latitude: data.latitude,
                longitude: data.longitude,
                sellerExternalId: data.sellerExternalId,
                sellerRegisteredAt: data.sellerRegisteredAt,
                otherListingsUrl: data.otherListingsUrl,
                contactChannels: data.contactChannels,
                whatsappPhone: data.whatsappPhone,
                rawAttributes: data.rawAttributes,
                status: 'NEW',
                prospectLeadId,
            },
        });
        sendEvent({ status: 'saving', message: 'Upserted listing record.' });
    }
}
