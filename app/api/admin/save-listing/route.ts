import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    const { userId } = await auth();
    if (!userId) return new NextResponse('Unauthorized', { status: 401 });

    const user = await db.user.findUnique({ where: { clerkId: userId } });
    if (!user) return new NextResponse('Unauthorized', { status: 401 });

    const { listingId, locationId: providedLocationId, platform, url, data } = await req.json();

    if (!data || !platform || !url) {
        return new NextResponse('Missing required fields (data, platform, url)', { status: 400 });
    }

    // Resolve locationId
    let locationId = providedLocationId || null;

    if (!locationId && listingId) {
        const existingListing = await db.scrapedListing.findUnique({
            where: { id: listingId },
            select: { locationId: true },
        });
        locationId = existingListing?.locationId || null;
    }

    if (!locationId) {
        const userWithLocs = await db.user.findUnique({
            where: { id: user.id },
            include: { locations: { take: 1 } },
        });
        locationId = userWithLocs?.locations?.[0]?.id || null;
    }

    if (!locationId) {
        return new NextResponse('Could not determine locationId', { status: 400 });
    }

    try {
        // Reuse the same upsert logic from scrape-listing route
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
                        phone: data.whatsappPhone || data.ownerPhone || null,
                        status: 'new',
                        isAgency: false,
                        platformUserId: data.sellerExternalId,
                        platformRegistered: data.sellerRegisteredAt,
                        profileUrl: data.otherListingsUrl || null,
                    },
                });
            } else {
                const updateData: any = {};
                if (data.ownerName && !existingProspect.name) updateData.name = data.ownerName;
                const bestPhone = data.whatsappPhone || data.ownerPhone;
                if (bestPhone && !existingProspect.phone) updateData.phone = bestPhone;
                if (data.sellerExternalId && !existingProspect.platformUserId) updateData.platformUserId = data.sellerExternalId;
                if (data.sellerRegisteredAt && !existingProspect.platformRegistered) updateData.platformRegistered = data.sellerRegisteredAt;
                if (data.otherListingsUrl && (!existingProspect.profileUrl || existingProspect.profileUrl !== data.otherListingsUrl)) updateData.profileUrl = data.otherListingsUrl;

                if (Object.keys(updateData).length > 0) {
                    await db.prospectLead.update({ where: { id: existingProspect.id }, data: updateData });
                }
            }

            prospectLeadId = existingProspect.id;
        }

        // 2. Upsert ScrapedListing
        const listingData = {
            title: data.title,
            description: data.description,
            price: data.price,
            currency: data.currency,
            propertyType: data.propertyType || undefined,
            listingType: data.listingType || undefined,
            locationText: data.location || undefined,
            images: data.images || [],
            thumbnails: data.thumbnails || [],
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
            isExpired: data.isExpired || false,
            prospectLeadId,
        };

        if (listingId) {
            await db.scrapedListing.update({
                where: { id: listingId },
                data: listingData,
            });
        } else {
            await db.scrapedListing.upsert({
                where: {
                    platform_externalId: { platform, externalId: data.externalId },
                },
                update: listingData,
                create: {
                    locationId,
                    platform,
                    externalId: data.externalId,
                    url,
                    status: 'NEW',
                    ...listingData,
                },
            });
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[Save Listing] Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
