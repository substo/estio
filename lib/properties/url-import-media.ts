import type { SubmittedPropertyMedia } from "@/lib/properties/property-media-ownership-policy";
import { normalizeHostname } from "@/lib/security/public-network";

export const URL_IMPORT_MAX_IMAGES = 50;

export type UrlImportImageInput = string | {
    url: string;
    cloudflareImageId?: string | null;
};

type OwnedImage = { sourceUrl: string; cloudflareImageId: string };

export type UrlImportMediaDependencies = {
    resolveOwnedImage: (input: {
        locationId: string;
        cloudflareImageId?: string | null;
        sourceUrl?: string | null;
    }) => Promise<OwnedImage>;
    downloadExternalImage: (url: string) => Promise<
        | { kind: "cloudflare"; url: string }
        | { kind: "image"; blob: Blob }
    >;
    uploadExternalImage: (
        blob: Blob,
        metadata: Record<string, unknown>,
    ) => Promise<{ imageId: string }>;
    getDeliveryUrl: (imageId: string) => string;
    deleteUploadedImage?: (imageId: string) => Promise<void>;
    logCleanupFailure?: (imageId: string, error: unknown) => void;
};

type ValidateSubmittedMedia = (input: {
    locationId: string;
    propertyId?: string | null;
    mediaItems: SubmittedPropertyMedia[];
}) => Promise<SubmittedPropertyMedia[]>;

function normalizeImageInput(input: UrlImportImageInput) {
    return typeof input === "string"
        ? { url: input, cloudflareImageId: null }
        : { url: input.url, cloudflareImageId: input.cloudflareImageId || null };
}

function isCloudflareInput(url: string, cloudflareImageId?: string | null) {
    if (cloudflareImageId) return true;
    try {
        return normalizeHostname(new URL(url).hostname) === "imagedelivery.net";
    } catch {
        return false;
    }
}

export function normalizeUrlImportMaxImages(value: unknown): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return URL_IMPORT_MAX_IMAGES;
    return Math.min(URL_IMPORT_MAX_IMAGES, Math.max(0, Math.floor(numeric)));
}

function candidateKey(input: UrlImportImageInput): string {
    const candidate = normalizeImageInput(input);
    const imageId = String(candidate.cloudflareImageId || "").trim();
    if (imageId) return `cloudflare:${imageId}`;
    const rawUrl = String(candidate.url || "").trim();
    try {
        return `url:${new URL(rawUrl).toString()}`;
    } catch {
        return `invalid:${rawUrl}`;
    }
}

async function cleanupUploadedImages(
    imageIds: string[],
    dependencies: Pick<UrlImportMediaDependencies, "deleteUploadedImage" | "logCleanupFailure">,
) {
    if (!dependencies.deleteUploadedImage) return;
    await Promise.all(Array.from(new Set(imageIds)).map(async (imageId) => {
        try {
            await dependencies.deleteUploadedImage!(imageId);
        } catch (error) {
            dependencies.logCleanupFailure?.(imageId, error);
        }
    }));
}

export function createUrlImportMediaIngestion(dependencies: UrlImportMediaDependencies) {
    return async function ingestUrlImportMedia(input: {
        locationId: string;
        dbUserId: string;
        images: UrlImportImageInput[];
        maxImages: number;
    }) {
        const mediaItems: SubmittedPropertyMedia[] = [];
        const warnings: string[] = [];
        const newlyUploadedImageIds: string[] = [];
        const seen = new Set<string>();
        const images = input.images
            .filter((candidate) => {
                const key = candidateKey(candidate);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .slice(0, normalizeUrlImportMaxImages(input.maxImages));

        for (let index = 0; index < images.length; index += 1) {
            const candidate = normalizeImageInput(images[index]);
            const url = String(candidate.url || "").trim();

            try {
                if (isCloudflareInput(url, candidate.cloudflareImageId)) {
                    // New imports have no property relation, so only authoritative
                    // active-location Cloudflare metadata can authorize this image.
                    const owned = await dependencies.resolveOwnedImage({
                        locationId: input.locationId,
                        sourceUrl: url,
                        cloudflareImageId: candidate.cloudflareImageId,
                    });
                    mediaItems.push({
                        url: owned.sourceUrl,
                        cloudflareImageId: owned.cloudflareImageId,
                        kind: "IMAGE",
                        sortOrder: mediaItems.length,
                    });
                    continue;
                }

                const download = await dependencies.downloadExternalImage(url);
                if (download.kind === "cloudflare") {
                    const owned = await dependencies.resolveOwnedImage({
                        locationId: input.locationId,
                        sourceUrl: download.url,
                    });
                    mediaItems.push({
                        url: owned.sourceUrl,
                        cloudflareImageId: owned.cloudflareImageId,
                        kind: "IMAGE",
                        sortOrder: mediaItems.length,
                    });
                    continue;
                }
                const upload = await dependencies.uploadExternalImage(download.blob, {
                    locationId: input.locationId,
                    uploadedBy: input.dbUserId,
                    purpose: "property_media",
                    workflow: "property_url_import",
                });
                newlyUploadedImageIds.push(upload.imageId);
                mediaItems.push({
                    url: dependencies.getDeliveryUrl(upload.imageId),
                    cloudflareImageId: upload.imageId,
                    kind: "IMAGE",
                    sortOrder: mediaItems.length,
                });
            } catch {
                warnings.push("An image could not be authorized or imported.");
            }
        }

        return { mediaItems, warnings, newlyUploadedImageIds };
    };
}

export async function createPropertyAfterImportMediaValidation<T>(input: {
    locationId: string;
    mediaItems: SubmittedPropertyMedia[];
    validateSubmittedMedia: ValidateSubmittedMedia;
    createProperty: (validatedMedia: SubmittedPropertyMedia[]) => Promise<T>;
    newlyUploadedImageIds?: string[];
    deleteUploadedImage?: (imageId: string) => Promise<void>;
    logCleanupFailure?: (imageId: string, error: unknown) => void;
}) {
    try {
        const validatedMedia = await input.validateSubmittedMedia({
            locationId: input.locationId,
            propertyId: null,
            mediaItems: input.mediaItems,
        });
        return await input.createProperty(validatedMedia);
    } catch (error) {
        await cleanupUploadedImages(input.newlyUploadedImageIds || [], input);
        throw error;
    }
}
