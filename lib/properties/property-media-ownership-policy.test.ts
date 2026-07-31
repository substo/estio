import assert from "node:assert/strict";
import test from "node:test";

import {
    createPropertyMediaOwnershipPolicy,
    PropertyMediaOwnershipError,
} from "./property-media-ownership-policy";

const accountHash = "account-hash";
const imageUrl = (id: string) => `https://imagedelivery.net/${accountHash}/${id}/public`;

function createHarness(options: {
    attached?: { url: string; cloudflareImageId?: string | null } | null;
    metadata?: Record<string, unknown> | null;
} = {}) {
    const calls = { attachedLookup: 0, metadataLookup: 0, imageFetch: 0, aiCall: 0, mediaDelete: 0 };
    const policy = createPropertyMediaOwnershipPolicy({
        configuredAccountHash: accountHash,
        findAttachedMedia: async () => {
            calls.attachedLookup += 1;
            return options.attached || null;
        },
        getCloudflareMetadata: async () => {
            calls.metadataLookup += 1;
            return options.metadata === undefined ? { locationId: "location-a" } : options.metadata;
        },
        getDeliveryUrl: imageUrl,
    });

    async function runAi(input: { sourceUrl: string; cloudflareImageId?: string }) {
        const owned = await policy.resolveOwnedImageSource({
            locationId: "location-a",
            propertyId: "property-a",
            ...input,
        });
        calls.imageFetch += 1;
        calls.aiCall += 1;
        return owned;
    }

    async function save(mediaItems: Array<{
        url: string;
        kind: "IMAGE" | "VIDEO" | "DOCUMENT";
        sortOrder: number;
        cloudflareImageId?: string;
    }>) {
        const result = await policy.validateSubmittedMedia({
            locationId: "location-a",
            propertyId: "property-a",
            mediaItems,
        });
        calls.mediaDelete += 1;
        return result;
    }

    return { calls, policy, runAi, save };
}

test("a foreign-location transient Cloudflare image is rejected before fetch or AI", async () => {
    const harness = createHarness({ metadata: { locationId: "location-b" } });
    await assert.rejects(
        harness.runAi({ sourceUrl: imageUrl("foreign-image") }),
        PropertyMediaOwnershipError,
    );
    assert.equal(harness.calls.imageFetch, 0);
    assert.equal(harness.calls.aiCall, 0);
});

test("a same-location transient Cloudflare upload is accepted", async () => {
    const harness = createHarness({ metadata: { locationId: "location-a", purpose: "property_media" } });
    const result = await harness.runAi({ sourceUrl: imageUrl("local-image") });
    assert.equal(result.cloudflareImageId, "local-image");
    assert.equal(result.ownership, "location-metadata");
    assert.equal(harness.calls.aiCall, 1);
});

test("an attached metadata-free legacy image remains usable", async () => {
    const harness = createHarness({
        attached: { url: imageUrl("legacy-image"), cloudflareImageId: "legacy-image" },
        metadata: null,
    });
    const result = await harness.runAi({ sourceUrl: imageUrl("legacy-image") });
    assert.equal(result.ownership, "property");
    assert.equal(harness.calls.metadataLookup, 0);
});

test("an unattached metadata-free legacy image is rejected", async () => {
    const harness = createHarness({ metadata: null });
    await assert.rejects(
        harness.runAi({ sourceUrl: imageUrl("legacy-image") }),
        PropertyMediaOwnershipError,
    );
    assert.equal(harness.calls.imageFetch, 0);
});

test("a forged URL and Cloudflare ID pair is rejected before save deletes old media", async () => {
    const harness = createHarness();
    await assert.rejects(
        harness.save([{
            url: imageUrl("url-image"),
            cloudflareImageId: "forged-image",
            kind: "IMAGE",
            sortOrder: 0,
        }]),
        PropertyMediaOwnershipError,
    );
    assert.equal(harness.calls.metadataLookup, 0);
    assert.equal(harness.calls.mediaDelete, 0);
});

test("create rejects another location's Cloudflare asset before mutation", async () => {
    const harness = createHarness({ metadata: { locationId: "location-b" } });
    await assert.rejects(
        harness.save([{ url: imageUrl("foreign-image"), kind: "IMAGE", sortOrder: 0 }]),
        PropertyMediaOwnershipError,
    );
    assert.equal(harness.calls.mediaDelete, 0);
});

test("external video and document URLs remain explicitly allowed", async () => {
    const harness = createHarness();
    const result = await harness.save([
        { url: "https://video.example/video.mp4", kind: "VIDEO", sortOrder: 0 },
        { url: "https://docs.example/brochure.pdf", kind: "DOCUMENT", sortOrder: 1 },
    ]);
    assert.equal(result.length, 2);
    assert.equal(harness.calls.metadataLookup, 0);
    assert.equal(harness.calls.mediaDelete, 1);
});
