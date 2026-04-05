import assert from "node:assert/strict";
import test from "node:test";
import {
    applyAiGeneratedImage,
    canRevertAiGeneratedImage,
    getPropertyImageAiMetadata,
    getPropertyMediaIdentity,
    getVisiblePropertyImageMedia,
    hasAiOriginalAvailable,
    removePropertyImageByIdentity,
    reorderVisiblePropertyImagesByIdentity,
    revertAiGeneratedReplacement,
    type PropertyImageLike,
} from "@/lib/properties/property-media-ai";

function makeImage(id: string, sortOrder: number, overrides: Partial<PropertyImageLike> = {}): PropertyImageLike {
    return {
        url: `https://example.com/${id}.jpg`,
        cloudflareImageId: id,
        kind: "IMAGE",
        sortOrder,
        ...overrides,
    };
}

test("applyAiGeneratedImage replace_original keeps slot, hides source, and preserves revert path", () => {
    const source = makeImage("orig-a", 0);
    const other = makeImage("orig-b", 1);

    const applied = applyAiGeneratedImage({
        images: [source, other],
        sourceImageIdentity: getPropertyMediaIdentity(source),
        generatedImage: {
            url: "https://example.com/ai-a.jpg",
            cloudflareImageId: "ai-a",
        },
        applyMode: "replace_original",
    });

    assert.deepEqual(
        getVisiblePropertyImageMedia(applied).map((item) => item.cloudflareImageId),
        ["ai-a", "orig-b"]
    );
    assert.equal(getPropertyImageAiMetadata(applied[0])?.isAiGenerated, true);
    assert.equal(getPropertyImageAiMetadata(applied[1])?.hiddenFromGallery, true);
    assert.equal(canRevertAiGeneratedImage(applied[0], applied), true);
});

test("applyAiGeneratedImage add_before_original inserts adjacent variant while keeping original visible", () => {
    const source = makeImage("orig-a", 0);
    const other = makeImage("orig-b", 1);

    const applied = applyAiGeneratedImage({
        images: [source, other],
        sourceImageIdentity: getPropertyMediaIdentity(other),
        generatedImage: {
            url: "https://example.com/ai-b.jpg",
            cloudflareImageId: "ai-b",
        },
        applyMode: "add_before_original",
    });

    assert.deepEqual(
        getVisiblePropertyImageMedia(applied).map((item) => item.cloudflareImageId),
        ["orig-a", "ai-b", "orig-b"]
    );
    const aiVariant = applied.find((item) => item.cloudflareImageId === "ai-b");
    assert.ok(aiVariant);
    assert.equal(hasAiOriginalAvailable(aiVariant!, applied), true);
});

test("applyAiGeneratedImage add_as_primary prepends ai variant", () => {
    const source = makeImage("orig-a", 0);
    const other = makeImage("orig-b", 1);

    const applied = applyAiGeneratedImage({
        images: [source, other],
        sourceImageIdentity: getPropertyMediaIdentity(other),
        generatedImage: {
            url: "https://example.com/ai-primary.jpg",
            cloudflareImageId: "ai-primary",
        },
        applyMode: "add_as_primary",
    });

    assert.deepEqual(
        getVisiblePropertyImageMedia(applied).map((item) => item.cloudflareImageId),
        ["ai-primary", "orig-a", "orig-b"]
    );
});

test("revertAiGeneratedReplacement restores original visibility and removes ai replacement", () => {
    const source = makeImage("orig-a", 0);
    const other = makeImage("orig-b", 1);
    const applied = applyAiGeneratedImage({
        images: [source, other],
        sourceImageIdentity: getPropertyMediaIdentity(source),
        generatedImage: {
            url: "https://example.com/ai-a.jpg",
            cloudflareImageId: "ai-a",
        },
        applyMode: "replace_original",
    });

    const reverted = revertAiGeneratedReplacement(applied, "ai-a");
    assert.deepEqual(
        getVisiblePropertyImageMedia(reverted).map((item) => item.cloudflareImageId),
        ["orig-a", "orig-b"]
    );
    assert.equal(reverted.some((item) => item.cloudflareImageId === "ai-a"), false);
});

test("removePropertyImageByIdentity reverts replacement images instead of orphaning hidden originals", () => {
    const source = makeImage("orig-a", 0);
    const applied = applyAiGeneratedImage({
        images: [source],
        sourceImageIdentity: getPropertyMediaIdentity(source),
        generatedImage: {
            url: "https://example.com/ai-a.jpg",
            cloudflareImageId: "ai-a",
        },
        applyMode: "replace_original",
    });

    const removed = removePropertyImageByIdentity(applied, "ai-a");
    assert.deepEqual(
        getVisiblePropertyImageMedia(removed).map((item) => item.cloudflareImageId),
        ["orig-a"]
    );
});

test("ai metadata survives json round-trip and still hides replaced originals", () => {
    const source = makeImage("orig-a", 0);
    const applied = applyAiGeneratedImage({
        images: [source],
        sourceImageIdentity: getPropertyMediaIdentity(source),
        generatedImage: {
            url: "https://example.com/ai-a.jpg",
            cloudflareImageId: "ai-a",
        },
        applyMode: "replace_original",
    });

    const reloaded = JSON.parse(JSON.stringify(applied)) as PropertyImageLike[];
    assert.deepEqual(
        getVisiblePropertyImageMedia(reloaded).map((item) => item.cloudflareImageId),
        ["ai-a"]
    );
});

test("reorderVisiblePropertyImagesByIdentity updates visible order for add_before/add_as_primary images", () => {
    const images = [
        makeImage("img-a", 0),
        makeImage("img-b", 1),
        makeImage("img-c", 2),
    ];

    const reordered = reorderVisiblePropertyImagesByIdentity({
        images,
        activeIdentity: "img-c",
        overIdentity: "img-a",
    });

    assert.deepEqual(
        getVisiblePropertyImageMedia(reordered).map((item) => item.cloudflareImageId),
        ["img-c", "img-a", "img-b"]
    );
    assert.deepEqual(
        reordered.map((item) => item.sortOrder),
        [0, 1, 2]
    );
});

test("reorderVisiblePropertyImagesByIdentity keeps hidden original attached to replacement", () => {
    const source = makeImage("orig-a", 0);
    const other = makeImage("orig-b", 1);
    const applied = applyAiGeneratedImage({
        images: [source, other],
        sourceImageIdentity: "orig-a",
        generatedImage: {
            url: "https://example.com/ai-a.jpg",
            cloudflareImageId: "ai-a",
        },
        applyMode: "replace_original",
    });

    const reordered = reorderVisiblePropertyImagesByIdentity({
        images: applied,
        activeIdentity: "orig-b",
        overIdentity: "ai-a",
    });

    assert.deepEqual(
        getVisiblePropertyImageMedia(reordered).map((item) => item.cloudflareImageId),
        ["orig-b", "ai-a"]
    );

    const aiIndex = reordered.findIndex((item) => item.cloudflareImageId === "ai-a");
    const hiddenOriginalIndex = reordered.findIndex((item) => item.cloudflareImageId === "orig-a");
    assert.equal(hiddenOriginalIndex, aiIndex + 1);
    assert.equal(getPropertyImageAiMetadata(reordered[hiddenOriginalIndex])?.hiddenFromGallery, true);
});
