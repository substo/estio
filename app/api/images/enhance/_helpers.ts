import { MediaKind } from "@prisma/client";
import db from "@/lib/db";
import { getImageDeliveryUrl } from "@/lib/cloudflareImages";

function resolveTransientCloudflareSource(sourceUrl?: string): { sourceUrl: string; cloudflareImageId: string } | null {
    const raw = String(sourceUrl || "").trim();
    if (!raw) return null;

    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        return null;
    }

    if (parsed.hostname !== "imagedelivery.net") {
        return null;
    }

    const segments = parsed.pathname.split("/").map((part) => part.trim()).filter(Boolean);
    if (segments.length < 3) {
        return null;
    }

    const accountHash = segments[0];
    const imageId = segments[1];
    const configuredAccountHash = String(process.env.NEXT_PUBLIC_CLOUDFLARE_IMAGES_ACCOUNT_HASH || "").trim();

    if (!imageId) {
        return null;
    }

    // Only allow transient URLs from this app's configured Cloudflare Images account.
    if (configuredAccountHash && accountHash !== configuredAccountHash) {
        return null;
    }

    const canonicalUrl = getImageDeliveryUrl(imageId, "public");
    return {
        sourceUrl: canonicalUrl || raw,
        cloudflareImageId: imageId,
    };
}

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

    const property = await db.property.findFirst({
        where: {
            id: propertyId,
            locationId,
        },
        select: {
            id: true,
            media: {
                where: {
                    kind: MediaKind.IMAGE,
                    ...(cloudflareImageId || sourceUrl ? {
                        OR: [
                            cloudflareImageId ? { cloudflareImageId } : undefined,
                            sourceUrl ? { url: sourceUrl } : undefined,
                        ].filter(Boolean) as Array<{ cloudflareImageId?: string; url?: string }>,
                    } : undefined),
                },
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
        const transient = resolveTransientCloudflareSource(sourceUrl);
        if (transient) {
            return transient;
        }
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
