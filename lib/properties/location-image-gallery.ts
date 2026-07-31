export type CloudflareGalleryImage = {
    id: string;
    filename: string;
    uploaded: string;
    variants: string[];
    meta?: Record<string, unknown>;
};

export async function listBoundedLocationImages(input: {
    locationId: string;
    limit: number;
    pageSize?: number;
    maxScanPages?: number;
    fetchPage: (page: number, perPage: number) => Promise<CloudflareGalleryImage[]>;
}) {
    const pageSize = Math.max(1, Math.min(input.pageSize || 100, 100));
    const maxScanPages = Math.max(1, Math.min(input.maxScanPages || 20, 50));
    const limit = Math.max(1, Math.min(input.limit, 200));
    const images: CloudflareGalleryImage[] = [];
    let scanComplete = false;
    let scannedPages = 0;

    for (let page = 1; page <= maxScanPages; page += 1) {
        const pageImages = await input.fetchPage(page, pageSize);
        scannedPages = page;
        images.push(...pageImages.filter((image) =>
            String(image.meta?.locationId || "") === input.locationId));
        if (pageImages.length < pageSize) {
            scanComplete = true;
            break;
        }
    }

    return {
        images: images.slice(0, limit),
        success: true as const,
        paginationMode: "bounded-location-scan" as const,
        scanComplete,
        scannedPages,
    };
}
