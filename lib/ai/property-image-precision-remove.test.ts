import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { resolveEditorDimensions } from "@/lib/ai/property-image-editor";
import {
    blendEditedImageWithMask,
    buildPrecisionRemovePrompt,
    preparePrecisionRemoveMaskAlpha,
} from "@/lib/ai/property-image-precision-remove";
import { isPrecisionRemoveInfrastructureReady } from "@/lib/ai/property-image-precision-remove-config";

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
    const previous: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(overrides)) {
        previous[key] = process.env[key];
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    try {
        fn();
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
}

async function createSolidPng(width: number, height: number, rgba: [number, number, number, number]) {
    return sharp({
        create: {
            width,
            height,
            channels: 4,
            background: {
                r: rgba[0],
                g: rgba[1],
                b: rgba[2],
                alpha: rgba[3] / 255,
            },
        },
    }).png().toBuffer();
}

async function createHalfMaskPng(width: number, height: number) {
    const data = Buffer.alloc(width * height * 4, 0);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width / 2; x += 1) {
            const offset = (y * width + x) * 4;
            data[offset] = 255;
            data[offset + 1] = 255;
            data[offset + 2] = 255;
            data[offset + 3] = 255;
        }
    }

    return sharp(data, {
        raw: {
            width,
            height,
            channels: 4,
        },
    }).png().toBuffer();
}

test("resolveEditorDimensions caps long edge at 2048", () => {
    const resolved = resolveEditorDimensions(4000, 2000);
    assert.equal(resolved.width, 2048);
    assert.equal(resolved.height, 1024);
    assert.ok(resolved.scale < 1);
});

test("buildPrecisionRemovePrompt omits guidance when blank", () => {
    assert.equal(buildPrecisionRemovePrompt("   "), "");
    assert.equal(buildPrecisionRemovePrompt("Fill with matching grass"), "Fill with matching grass");
});

test("preparePrecisionRemoveMaskAlpha rejects empty masks", async () => {
    const transparentMask = await createSolidPng(8, 8, [0, 0, 0, 0]);
    await assert.rejects(
        () => preparePrecisionRemoveMaskAlpha(transparentMask, 8, 8),
        /Draw a mask before removing content/
    );
});

test("preparePrecisionRemoveMaskAlpha computes mask coverage", async () => {
    const mask = await createHalfMaskPng(10, 10);
    const prepared = await preparePrecisionRemoveMaskAlpha(mask, 10, 10);
    assert.ok(prepared.maskCoverage >= 0.5, "coverage should include the selected half");
    assert.ok(prepared.maskCoverage <= 1, "coverage should remain normalized");
});

test("blendEditedImageWithMask preserves pixels outside the mask", async () => {
    const original = await createSolidPng(100, 100, [0, 0, 255, 255]);
    const edited = await createSolidPng(100, 100, [0, 255, 0, 255]);
    const mask = await createHalfMaskPng(100, 100);
    const preparedMask = await preparePrecisionRemoveMaskAlpha(mask, 100, 100);
    const blended = await blendEditedImageWithMask({
        originalImageBuffer: original,
        editedImageBuffer: edited,
        featheredMaskRawBuffer: preparedMask.featheredMaskRawBuffer,
        width: 100,
        height: 100,
    });

    const raw = await sharp(blended)
        .raw()
        .toBuffer({ resolveWithObject: true });

    const leftOffset = (50 * raw.info.width + 10) * raw.info.channels;
    const rightOffset = (50 * raw.info.width + 90) * raw.info.channels;

    assert.ok(raw.data[leftOffset + 1] > raw.data[leftOffset + 2], "left side should favor edited green pixels");
    assert.ok(raw.data[rightOffset + 2] > raw.data[rightOffset + 1], "right side should preserve original blue pixels");
});

test("isPrecisionRemoveInfrastructureReady uses shared Google Cloud env", () => {
    withEnv({
        GOOGLE_CLOUD_PROJECT_ID: "demo-project",
        GOOGLE_CLOUD_LOCATION: "us-central1",
        GOOGLE_APPLICATION_CREDENTIALS: "/tmp/fake-service-account.json",
    }, () => {
        assert.equal(isPrecisionRemoveInfrastructureReady(), true);
    });
});
