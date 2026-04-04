import { MediaKind } from "@prisma/client";
import db from "@/lib/db";
import { getImageDeliveryUrl } from "@/lib/cloudflareImages";

export async function resolveOwnedPropertyImageSource(input: {
    locationId: string;
    propertyId: string;
    cloudflareImageId?: string;
    sourceUrl?: string;
}): Promise<{
    sourceUrl: string;
    cloudflareImageId: string | null;
}> {
    const locationId = String(input.locationId || "").trim();
    const propertyId = String(input.propertyId || "").trim();
    const cloudflareImageId = String(input.cloudflareImageId || "").trim() || undefined;
    const sourceUrl = String(input.sourceUrl || "").trim() || undefined;

    if (!locationId || !propertyId) {
        throw new Error("Location ID and property ID are required.");
    }

    const mediaWhere: {
        kind: MediaKind;
        cloudflareImageId?: string;
        url?: string;
    } = {
        kind: MediaKind.IMAGE,
    };
    if (cloudflareImageId) {
        mediaWhere.cloudflareImageId = cloudflareImageId;
    } else if (sourceUrl) {
        mediaWhere.url = sourceUrl;
    }

    const property = await db.property.findFirst({
        where: {
            id: propertyId,
            locationId,
        },
        select: {
            id: true,
            media: {
                where: mediaWhere,
                select: {
                    cloudflareImageId: true,
                    url: true,
                },
                take: 1,
            },
        },
    });

    if (!property) {
        throw new Error("Property not found for this location.");
    }

    const media = property.media[0];
    if (!media) {
        throw new Error("Image not found on this property.");
    }

    const resolvedCloudflareId = String(media.cloudflareImageId || "").trim();
    const resolvedUrl = resolvedCloudflareId
        ? getImageDeliveryUrl(resolvedCloudflareId, "public")
        : String(media.url || "").trim();

    if (!resolvedUrl) {
        throw new Error("Unable to resolve source image URL.");
    }

    return {
        sourceUrl: resolvedUrl,
        cloudflareImageId: resolvedCloudflareId || null,
    };
}
