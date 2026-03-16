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
    location: string;
    ownerName: string;
    ownerPhone: string;
    images: string[];
    propertyType: string;
    externalId: string;
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
            const titleSelectors = ['.announcement-block__title', 'h1', '.content-title'];
            let title = '';
            for (const sel of titleSelectors) {
                title = await page.locator(sel).first().textContent().catch(() => '') || '';
                if (title.trim()) break;
            }
            title = title.trim() || 'No Title';
            sendEvent({ status: 'extracting', message: `Title: ${title}` });

            // Description
            const description = await page.locator('.announcement-description').textContent().catch(() => '') || '';
            sendEvent({ status: 'extracting', message: `Description: ${description.trim().substring(0, 100)}...` });

            // Price
            const priceText = await page.locator('.announcement-price__cost').textContent().catch(() => '0') || '0';
            const cleanPrice = parseInt(priceText.replace(/\D/g, '') || '0') || null;
            sendEvent({ status: 'extracting', message: `Price: ${cleanPrice ? `€${cleanPrice.toLocaleString()}` : 'POA'}` });

            // Location
            const location = await page.locator('.announcement-location').textContent().catch(() => '') || '';
            sendEvent({ status: 'extracting', message: `Location: ${location.trim() || 'N/A'}` });

            // Owner Name
            const ownerName = await page.locator('.author-card__name').textContent().catch(() => '') || '';
            sendEvent({ status: 'extracting', message: `Owner: ${ownerName.trim() || 'Unknown'}` });

            // Property type from breadcrumbs or metadata
            const propertyType = await page.locator('.breadcrumbs__link').last().textContent().catch(() => '') || '';

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

            return {
                title,
                description: description.trim(),
                price: cleanPrice,
                location: location.trim(),
                ownerName: ownerName.trim(),
                ownerPhone,
                images,
                propertyType: propertyType.trim(),
                externalId,
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
                    phone: data.ownerPhone || null,
                    status: 'new',
                    isAgency: false,
                },
            });
            sendEvent({ status: 'saving', message: `Created new prospect: ${data.ownerName || 'Unknown'}` });
        } else {
            // Update existing prospect with new data if richer
            const updateData: any = {};
            if (data.ownerName && !existingProspect.name) updateData.name = data.ownerName;
            if (data.ownerPhone && !existingProspect.phone) updateData.phone = data.ownerPhone;
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
                price: data.price,
                propertyType: data.propertyType || undefined,
                locationText: data.location || undefined,
                images: data.images,
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
                price: data.price,
                propertyType: data.propertyType || undefined,
                locationText: data.location || undefined,
                images: data.images,
                prospectLeadId,
            },
            create: {
                locationId,
                platform,
                externalId: data.externalId,
                url,
                title: data.title,
                price: data.price,
                propertyType: data.propertyType || undefined,
                locationText: data.location || undefined,
                images: data.images,
                status: 'NEW',
                prospectLeadId,
            },
        });
        sendEvent({ status: 'saving', message: 'Upserted listing record.' });
    }
}
