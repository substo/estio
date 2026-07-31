import assert from "node:assert/strict";
import test from "node:test";

import {
    createPropertyAfterImportMediaValidation,
    createUrlImportMediaIngestion,
    normalizeUrlImportMaxImages,
    URL_IMPORT_MAX_IMAGES,
} from "./url-import-media";
import {
    createPropertyMediaOwnershipPolicy,
    PropertyMediaOwnershipError,
    type SubmittedPropertyMedia,
} from "./property-media-ownership-policy";

const accountHash = "account-hash";
const deliveryUrl = (id: string) => `https://imagedelivery.net/${accountHash}/${id}/public`;

function createHarness(options: {
    metadataById?: Record<string, Record<string, unknown> | null>;
    downloadStatus?: number;
    downloadThrows?: boolean;
    uploadThrows?: boolean;
    redirectedCloudflareUrl?: string;
} = {}) {
    const calls = { download: 0, upload: 0, propertyCreate: 0, mediaCreate: 0 };
    const uploadMetadata: Record<string, unknown>[] = [];
    const deletedIds: string[] = [];
    const ownership = createPropertyMediaOwnershipPolicy({
        configuredAccountHash: accountHash,
        findAttachedMedia: async () => null,
        getCloudflareMetadata: async (imageId) => options.metadataById?.[imageId] ?? null,
        getDeliveryUrl: deliveryUrl,
    });
    const ingest = createUrlImportMediaIngestion({
        resolveOwnedImage: ownership.resolveOwnedImageSource,
        downloadExternalImage: async () => {
            calls.download += 1;
            if (options.downloadThrows) throw new Error("download failed");
            if (options.redirectedCloudflareUrl) {
                return { kind: "cloudflare" as const, url: options.redirectedCloudflareUrl };
            }
            const status = options.downloadStatus ?? 200;
            if (status < 200 || status >= 300) throw new Error("download failed");
            return { kind: "image" as const, blob: new Blob(["image"]) };
        },
        uploadExternalImage: async (_blob, metadata) => {
            calls.upload += 1;
            uploadMetadata.push(metadata);
            if (options.uploadThrows) throw new Error("upload failed");
            return { imageId: "uploaded-image" };
        },
        getDeliveryUrl: deliveryUrl,
        deleteUploadedImage: async (imageId) => { deletedIds.push(imageId); },
    });

    return { calls, deletedIds, ingest, ownership, uploadMetadata };
}

test("a scraped foreign-location Cloudflare image is rejected and never attached", async () => {
    const harness = createHarness({ metadataById: { foreign: { locationId: "location-b" } } });
    const result = await harness.ingest({
        locationId: "location-a", dbUserId: "db-user-a", images: [deliveryUrl("foreign")], maxImages: 10,
    });
    assert.deepEqual(result.mediaItems, []);
    assert.equal(result.warnings.length, 1);
    assert.deepEqual(harness.calls, { download: 0, upload: 0, propertyCreate: 0, mediaCreate: 0 });
});

test("an unattached metadata-free Cloudflare image is rejected", async () => {
    const harness = createHarness({ metadataById: { legacy: null } });
    const result = await harness.ingest({
        locationId: "location-a", dbUserId: "db-user-a", images: [deliveryUrl("legacy")], maxImages: 10,
    });
    assert.deepEqual(result.mediaItems, []);
});

test("an active-location Cloudflare image is accepted as a canonical reference", async () => {
    const harness = createHarness({ metadataById: { local: { locationId: "location-a" } } });
    const result = await harness.ingest({
        locationId: "location-a", dbUserId: "db-user-a", images: [deliveryUrl("local")], maxImages: 10,
    });
    assert.deepEqual(result.mediaItems.map(({ url, cloudflareImageId }) => ({ url, cloudflareImageId })), [{
        url: deliveryUrl("local"), cloudflareImageId: "local",
    }]);
});

test("a forged Cloudflare delivery URL and image ID combination is rejected", async () => {
    const harness = createHarness({
        metadataById: {
            "url-image": { locationId: "location-a" },
            "forged-image": { locationId: "location-a" },
        },
    });
    const result = await harness.ingest({
        locationId: "location-a",
        dbUserId: "db-user-a",
        images: [{ url: deliveryUrl("url-image"), cloudflareImageId: "forged-image" }],
        maxImages: 10,
    });
    assert.deepEqual(result.mediaItems, []);
    assert.equal(result.warnings.length, 1);
});

test("a terminal-dot Cloudflare hostname is classified and authorized without downloading", async () => {
    const harness = createHarness({ metadataById: { local: { locationId: "location-a" } } });
    const result = await harness.ingest({
        locationId: "location-a",
        dbUserId: "db-user-a",
        images: [`https://imagedelivery.net./${accountHash}/local/public`],
        maxImages: 10,
    });
    assert.equal(result.mediaItems[0]?.url, deliveryUrl("local"));
    assert.equal(harness.calls.download, 0);
});

for (const malformedUrl of [
    "https://imagedelivery.net/wrong-account/image/public",
    "https://imagedelivery.net/account-hash",
]) {
    test(`malformed or wrong-account Cloudflare URL is rejected without downloading: ${malformedUrl}`, async () => {
        const harness = createHarness();
        const result = await harness.ingest({
            locationId: "location-a",
            dbUserId: "db-user-a",
            images: [malformedUrl],
            maxImages: 10,
        });
        assert.deepEqual(result.mediaItems, []);
        assert.equal(harness.calls.download, 0);
        assert.equal(result.warnings.length, 1);
    });
}

test("a redirect to a foreign Cloudflare image is authorized rather than re-uploaded", async () => {
    const harness = createHarness({
        metadataById: { foreign: { locationId: "location-b" } },
        redirectedCloudflareUrl: deliveryUrl("foreign"),
    });
    const result = await harness.ingest({
        locationId: "location-a",
        dbUserId: "db-user-a",
        images: ["https://public.example/redirect"],
        maxImages: 10,
    });
    assert.deepEqual(result.mediaItems, []);
    assert.equal(harness.calls.upload, 0);
});

test("a non-success external download is skipped without preserving its hotlink", async () => {
    const harness = createHarness({ downloadStatus: 403 });
    const originalUrl = "https://external.example/blocked.jpg";
    const result = await harness.ingest({
        locationId: "location-a", dbUserId: "db-user-a", images: [originalUrl], maxImages: 10,
    });
    assert.deepEqual(result.mediaItems, []);
    assert.equal(JSON.stringify(result).includes(originalUrl), false);
    assert.equal(harness.calls.upload, 0);
});

for (const failure of ["download", "upload"] as const) {
    test(`an external ${failure} exception never attaches the original URL`, async () => {
        const harness = createHarness({
            downloadThrows: failure === "download",
            uploadThrows: failure === "upload",
        });
        const originalUrl = "https://external.example/error.jpg";
        const result = await harness.ingest({
            locationId: "location-a", dbUserId: "db-user-a", images: [originalUrl], maxImages: 10,
        });
        assert.deepEqual(result.mediaItems, []);
        assert.equal(JSON.stringify(result).includes(originalUrl), false);
    });
}

test("a successfully ingested external image is tagged and attached canonically", async () => {
    const harness = createHarness({ metadataById: { "uploaded-image": { locationId: "location-a" } } });
    const result = await harness.ingest({
        locationId: "location-a",
        dbUserId: "db-user-a",
        images: ["https://external.example/image.jpg"],
        maxImages: 10,
    });
    assert.deepEqual(harness.uploadMetadata, [{
        locationId: "location-a",
        uploadedBy: "db-user-a",
        purpose: "property_media",
        workflow: "property_url_import",
    }]);
    assert.equal(result.mediaItems[0]?.url, deliveryUrl("uploaded-image"));
});

test("maxImages is normalized, candidates are deduplicated, and ordering stays compact", async () => {
    assert.equal(normalizeUrlImportMaxImages(Number.NaN), URL_IMPORT_MAX_IMAGES);
    assert.equal(normalizeUrlImportMaxImages(-2), 0);
    assert.equal(normalizeUrlImportMaxImages(2.9), 2);
    assert.equal(normalizeUrlImportMaxImages(50_000), URL_IMPORT_MAX_IMAGES);

    const harness = createHarness({
        metadataById: {
            local: { locationId: "location-a" },
            "uploaded-image": { locationId: "location-a" },
        },
    });
    const result = await harness.ingest({
        locationId: "location-a",
        dbUserId: "db-user-a",
        images: [deliveryUrl("local"), deliveryUrl("local"), "https://external.example/image.jpg"],
        maxImages: 10,
    });
    assert.deepEqual(result.mediaItems.map((item) => item.sortOrder), [0, 1]);
    assert.equal(harness.calls.upload, 1);
});

test("mixed batches retain only valid local and successfully uploaded images with generic warnings", async () => {
    const ownership = createPropertyMediaOwnershipPolicy({
        configuredAccountHash: accountHash,
        findAttachedMedia: async () => null,
        getCloudflareMetadata: async (id) => ({
            local: { locationId: "location-a" },
            foreign: { locationId: "location-b" },
            uploaded: { locationId: "location-a" },
        } as Record<string, Record<string, string>>)[id] || null,
        getDeliveryUrl: deliveryUrl,
    });
    let externalCall = 0;
    const ingest = createUrlImportMediaIngestion({
        resolveOwnedImage: ownership.resolveOwnedImageSource,
        downloadExternalImage: async () => {
            externalCall += 1;
            if (externalCall === 1) throw new Error("failed");
            return { kind: "image", blob: new Blob(["image"]) };
        },
        uploadExternalImage: async () => ({ imageId: "uploaded" }),
        getDeliveryUrl: deliveryUrl,
    });
    const secretUrl = "https://external.example/private-token.jpg";
    const result = await ingest({
        locationId: "location-a",
        dbUserId: "db-user-a",
        images: [deliveryUrl("local"), deliveryUrl("foreign"), secretUrl, "https://external.example/valid.jpg"],
        maxImages: 10,
    });
    assert.deepEqual(result.mediaItems.map((item) => item.cloudflareImageId), ["local", "uploaded"]);
    assert.deepEqual(result.mediaItems.map((item) => item.sortOrder), [0, 1]);
    assert.equal(result.warnings.length, 2);
    assert.equal(JSON.stringify(result).includes(secretUrl), false);
});

test("no property or media mutation occurs until the complete image set validates", async () => {
    let propertyCreate = 0;
    let mediaCreate = 0;
    const mediaItems: SubmittedPropertyMedia[] = [
        { url: deliveryUrl("valid"), cloudflareImageId: "valid", kind: "IMAGE", sortOrder: 0 },
        { url: deliveryUrl("foreign"), cloudflareImageId: "foreign", kind: "IMAGE", sortOrder: 1 },
    ];

    await assert.rejects(createPropertyAfterImportMediaValidation({
        locationId: "location-a",
        mediaItems,
        validateSubmittedMedia: async () => { throw new PropertyMediaOwnershipError(); },
        createProperty: async () => {
            propertyCreate += 1;
            mediaCreate += mediaItems.length;
            return { id: "property" };
        },
    }), PropertyMediaOwnershipError);
    assert.equal(propertyCreate, 0);
    assert.equal(mediaCreate, 0);
});

test("final validation or property creation failure cleans up only newly uploaded assets", async () => {
    const deleted: string[] = [];
    await assert.rejects(createPropertyAfterImportMediaValidation({
        locationId: "location-a",
        mediaItems: [{ url: deliveryUrl("existing"), cloudflareImageId: "existing", kind: "IMAGE", sortOrder: 0 }],
        newlyUploadedImageIds: ["new-a", "new-b"],
        deleteUploadedImage: async (id) => { deleted.push(id); },
        validateSubmittedMedia: async (input) => input.mediaItems,
        createProperty: async () => { throw new Error("database failed"); },
    }), /database failed/);
    assert.deepEqual(deleted.sort(), ["new-a", "new-b"]);
    assert.equal(deleted.includes("existing"), false);
});

test("final invariant failure cleans uploads, preserves zero mutations, and cleanup errors do not replace it", async () => {
    let propertyMutations = 0;
    const cleanupFailures: string[] = [];
    const invariantError = new PropertyMediaOwnershipError("invariant failed");
    await assert.rejects(createPropertyAfterImportMediaValidation({
        locationId: "location-a",
        mediaItems: [{ url: deliveryUrl("new-a"), cloudflareImageId: "new-a", kind: "IMAGE", sortOrder: 0 }],
        newlyUploadedImageIds: ["new-a"],
        deleteUploadedImage: async () => { throw new Error("cleanup failed"); },
        logCleanupFailure: (id) => { cleanupFailures.push(id); },
        validateSubmittedMedia: async () => { throw invariantError; },
        createProperty: async () => {
            propertyMutations += 1;
            return { id: "must-not-exist" };
        },
    }), (error: unknown) => error === invariantError);
    assert.equal(propertyMutations, 0);
    assert.deepEqual(cleanupFailures, ["new-a"]);
});

test("active location media is the only array reaching nested property-media creation", async () => {
    const harness = createHarness({
        metadataById: {
            local: { locationId: "location-a" },
            foreign: { locationId: "location-b" },
        },
    });
    const ingestion = await harness.ingest({
        locationId: "location-a",
        dbUserId: "db-user-a",
        images: [deliveryUrl("foreign"), deliveryUrl("local")],
        maxImages: 10,
    });
    let nestedMedia: SubmittedPropertyMedia[] = [];
    await createPropertyAfterImportMediaValidation({
        locationId: "location-a",
        mediaItems: ingestion.mediaItems,
        validateSubmittedMedia: harness.ownership.validateSubmittedMedia,
        createProperty: async (validatedMedia) => {
            nestedMedia = validatedMedia;
            return { id: "property-a" };
        },
    });
    assert.deepEqual(nestedMedia.map((item) => item.cloudflareImageId), ["local"]);
});
