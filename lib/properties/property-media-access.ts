import "server-only";

import db from "@/lib/db";
import { getCloudflareImageMetadata, getImageDeliveryUrl } from "@/lib/cloudflareImages";
import { createPropertyMediaOwnershipPolicy } from "@/lib/properties/property-media-ownership-policy";

const propertyMediaOwnership = createPropertyMediaOwnershipPolicy({
    configuredAccountHash: String(process.env.NEXT_PUBLIC_CLOUDFLARE_IMAGES_ACCOUNT_HASH || "").trim(),
    findAttachedMedia: async ({ locationId, propertyId, cloudflareImageId, sourceUrl }) => {
        const media = await db.propertyMedia.findFirst({
            where: {
                propertyId,
                property: { locationId },
                OR: [
                    cloudflareImageId ? { cloudflareImageId } : undefined,
                    sourceUrl ? { url: sourceUrl } : undefined,
                ].filter(Boolean) as Array<{ cloudflareImageId?: string; url?: string }>,
            },
            select: { url: true, cloudflareImageId: true },
        });
        return media;
    },
    getCloudflareMetadata: getCloudflareImageMetadata,
    getDeliveryUrl: (imageId) => getImageDeliveryUrl(imageId, "public"),
});

export const resolveOwnedPropertyImageSource = propertyMediaOwnership.resolveOwnedImageSource;
export const validateSubmittedPropertyMedia = propertyMediaOwnership.validateSubmittedMedia;
export { PropertyMediaOwnershipError } from "@/lib/properties/property-media-ownership-policy";
