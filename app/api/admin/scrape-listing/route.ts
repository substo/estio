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

                if (connection) {
                    const credential = await db.scrapingCredential.findFirst({
                        where: { connectionId: connection.id, status: 'active' },
                        orderBy: { lastUsedAt: 'asc' },
                    });

                    if (credential?.sessionState) {
                        sessionState = credential.sessionState;
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
            const priceText = await page.locator('.announcement-price__cost').textContent().catch(() => '0') || '0';
            const cleanPrice = parseInt(priceText.replace(/\D/g, '') || '0') || null;
            const currency = await page.locator('meta[itemprop="priceCurrency"]').getAttribute('content').catch(() => 'EUR') || 'EUR';
            sendEvent({ status: 'extracting', message: `Price: ${cleanPrice ? `${currency} ${cleanPrice.toLocaleString()}` : 'POA'}` });

            // Location
            const location = await page.locator('.announcement__location span[itemprop="address"]').textContent().catch(() => '') || '';
            sendEvent({ status: 'extracting', message: `Location: ${location.trim() || 'N/A'}` });

            // Owner Name & Info
            const ownerName = await page.locator('.author-info .author-name, [itemprop="name"]').first().textContent().catch(() => '') || '';
            const sellerExternalId = await page.locator('.author-name[data-user]').getAttribute('data-user').catch(() => undefined);
            const sellerRegisteredAt = await page.locator('.date-registration').textContent().catch(() => undefined);
            const otherListingsUrl = await page.locator('a.other-announcement-author').getAttribute('href').catch(() => undefined);
            
            sendEvent({ status: 'extracting', message: `Owner: ${ownerName.trim() || 'Unknown'} (ID: ${sellerExternalId || 'N/A'})` });

            // Property type from breadcrumbs or metadata
            const propertyType = await page.locator('.breadcrumbs__link').last().textContent().catch(() => '') || '';
            const listingType = url.includes('-rent') || url.includes('to-rent') ? 'rent' : 'sale';

            // Images
            let images: string[] = [];
            try {
                images = await page.locator('.gallery img, .announcement-media img, .swiper-slide img').evaluateAll(
                    (els: HTMLImageElement[]) => els.map(el => el.src).filter(Boolean).slice(0, 5)
                );
            } catch (e) { /* no images */ }
            sendEvent({ status: 'extracting', message: `Images found: ${images.length}` });

            // Phone number — attempt "Show Phone" click
            let ownerPhone = '';
            try {
                const phoneBtn = page.locator('.js-phone-number-button, .phone-btn, [data-phone-button]').first();
                const btnVisible = await phoneBtn.isVisible({ timeout: 3000 }).catch(() => false);

                if (btnVisible) {
                    sendEvent({ status: 'extracting', message: 'Clicking "Show Phone" button...' });
                    await phoneBtn.click();
                    await page.waitForTimeout(1500);

                    ownerPhone = await page.locator('.js-phone-number-value, .phone-number-value').first().textContent().catch(() => '') || '';
                    ownerPhone = ownerPhone.trim().replace(/\s+/g, '');
                    sendEvent({ status: 'extracting', message: `Phone: ${ownerPhone || 'Not revealed'}` });
                } else {
                    // Phone might already be visible
                    ownerPhone = await page.locator('.js-phone-number-value, .phone-number-value').first().textContent().catch(() => '') || '';
                    ownerPhone = ownerPhone.trim().replace(/\s+/g, '');
                    if (ownerPhone) {
                        sendEvent({ status: 'extracting', message: `Phone (visible): ${ownerPhone}` });
                    } else {
                        sendEvent({ status: 'extracting', message: 'Phone: Button not found, no phone visible' });
                    }
                }
            } catch (e: any) {
                sendEvent({ status: 'extracting', message: `Phone extraction failed: ${e.message}` });
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
            } catch(e) { /* ignore */ }

            return {
                title,
                description: description.trim(),
                price: cleanPrice,
                currency: currency,
                location: location.trim(),
                ownerName: ownerName.trim(),
                ownerPhone,
                images,
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
                rawAttributes
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
    // 1. Upsert ProspectLead
    let prospectLeadId: string | null = null;

    if (data.ownerPhone || data.ownerName) {
        const orConditions: any[] = [];
        if (data.ownerPhone) orConditions.push({ phone: { contains: data.ownerPhone } });

        let existingProspect = orConditions.length > 0
            ? await db.prospectLead.findFirst({ where: { locationId, OR: orConditions } })
            : null;

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
