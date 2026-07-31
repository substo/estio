export class PropertyMediaOwnershipError extends Error {
    constructor(message = "Property media access denied") {
        super(message);
        this.name = "PropertyMediaOwnershipError";
    }
}

export type PropertyMediaKind = "IMAGE" | "FLOORPLAN" | "VIDEO" | "MATTERPORT" | "DOCUMENT";

export type SubmittedPropertyMedia = {
    url: string;
    kind: PropertyMediaKind;
    sortOrder: number;
    cloudflareImageId?: string | null;
    metadata?: unknown;
};

type AttachedMedia = { url: string; cloudflareImageId?: string | null };

export type PropertyMediaOwnershipDependencies = {
    configuredAccountHash: string;
    findAttachedMedia: (input: {
        locationId: string;
        propertyId: string;
        cloudflareImageId?: string;
        sourceUrl?: string;
    }) => Promise<AttachedMedia | null>;
    getCloudflareMetadata: (imageId: string) => Promise<Record<string, unknown> | null>;
    getDeliveryUrl: (imageId: string) => string;
};

export function parseCloudflareDeliveryImageId(
    sourceUrl: string | null | undefined,
    configuredAccountHash: string,
): string | null {
    const raw = String(sourceUrl || "").trim();
    if (!raw) return null;

    try {
        const parsed = new URL(raw);
        if (parsed.hostname.toLowerCase().replace(/\.+$/, "") !== "imagedelivery.net") return null;
        const segments = parsed.pathname.split("/").map((part) => part.trim()).filter(Boolean);
        if (segments.length < 3 || !segments[1]) return null;
        if (configuredAccountHash && segments[0] !== configuredAccountHash) return null;
        return segments[1];
    } catch {
        return null;
    }
}

function requireHttpUrl(value: string) {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    } catch {
        throw new PropertyMediaOwnershipError("Invalid property media URL");
    }
}

export function createPropertyMediaOwnershipPolicy(dependencies: PropertyMediaOwnershipDependencies) {
    async function resolveOwnedImageSource(input: {
        locationId: string;
        propertyId?: string | null;
        cloudflareImageId?: string | null;
        sourceUrl?: string | null;
    }): Promise<{ sourceUrl: string; cloudflareImageId: string; ownership: "property" | "location-metadata" }> {
        const locationId = String(input.locationId || "").trim();
        const propertyId = String(input.propertyId || "").trim();
        const sourceUrl = String(input.sourceUrl || "").trim();
        const suppliedImageId = String(input.cloudflareImageId || "").trim();
        const urlImageId = parseCloudflareDeliveryImageId(sourceUrl, dependencies.configuredAccountHash);

        if (!locationId || (!sourceUrl && !suppliedImageId)) throw new PropertyMediaOwnershipError();
        if (suppliedImageId && urlImageId && suppliedImageId !== urlImageId) {
            throw new PropertyMediaOwnershipError("Cloudflare image URL and ID do not match");
        }

        const requestedImageId = suppliedImageId || urlImageId || undefined;
        const attached = propertyId
            ? await dependencies.findAttachedMedia({
                locationId,
                propertyId,
                cloudflareImageId: requestedImageId,
                sourceUrl: sourceUrl || undefined,
            })
            : null;

        if (attached) {
            const attachedUrlId = parseCloudflareDeliveryImageId(attached.url, dependencies.configuredAccountHash);
            const attachedId = String(attached.cloudflareImageId || attachedUrlId || "").trim();
            if (suppliedImageId && attachedId && suppliedImageId !== attachedId) {
                throw new PropertyMediaOwnershipError("Cloudflare image ID does not match attached media");
            }
            const resolvedUrl = attachedId ? dependencies.getDeliveryUrl(attachedId) : String(attached.url || "").trim();
            if (!resolvedUrl) throw new PropertyMediaOwnershipError();
            return {
                sourceUrl: resolvedUrl,
                cloudflareImageId: attachedId,
                ownership: "property",
            };
        }

        // Metadata-free legacy assets are intentionally not accepted here. They
        // remain usable only through an existing authorized property relation.
        if (!requestedImageId) throw new PropertyMediaOwnershipError();
        const metadata = await dependencies.getCloudflareMetadata(requestedImageId);
        if (String(metadata?.locationId || "") !== locationId) {
            throw new PropertyMediaOwnershipError();
        }

        return {
            sourceUrl: dependencies.getDeliveryUrl(requestedImageId),
            cloudflareImageId: requestedImageId,
            ownership: "location-metadata",
        };
    }

    async function validateSubmittedMedia(input: {
        locationId: string;
        propertyId?: string | null;
        mediaItems: SubmittedPropertyMedia[];
    }): Promise<SubmittedPropertyMedia[]> {
        const validated: SubmittedPropertyMedia[] = [];
        for (const item of input.mediaItems) {
            const url = String(item.url || "").trim();
            requireHttpUrl(url);

            if (item.kind === "VIDEO" || item.kind === "MATTERPORT" || item.kind === "DOCUMENT") {
                // External video/document URLs are deliberately supported. A
                // Cloudflare delivery URL still goes through image ownership.
                const cloudflareId = parseCloudflareDeliveryImageId(url, dependencies.configuredAccountHash);
                if (!cloudflareId && !item.cloudflareImageId) {
                    validated.push({ ...item, url });
                    continue;
                }
            }

            const owned = await resolveOwnedImageSource({
                locationId: input.locationId,
                propertyId: input.propertyId,
                cloudflareImageId: item.cloudflareImageId,
                sourceUrl: url,
            });
            validated.push({
                ...item,
                url: owned.sourceUrl,
                cloudflareImageId: owned.cloudflareImageId || undefined,
            });
        }
        return validated;
    }

    return { resolveOwnedImageSource, validateSubmittedMedia };
}
