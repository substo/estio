import test from "node:test";
import assert from "node:assert/strict";
import { parseGoogleGeminiPricingPage } from "@/lib/ai/google-pricing";

test("parseGoogleGeminiPricingPage extracts text and image output pricing from provider HTML", () => {
    const pricing = parseGoogleGeminiPricingPage({
        fetchedAt: new Date("2026-07-06T00:00:00.000Z"),
        html: `
            <h2>Gemini 3.1 Flash Image (Nano Banana 2)</h2>
            <p><code>gemini-3.1-flash-image</code></p>
            <h3>Standard</h3>
            <p>Free Tier Paid Tier, per 1M tokens in USD</p>
            <p>Input price Free of charge $0.50 (text / image / video / audio)</p>
            <p>Output price (including thinking tokens) Free of charge $3.00 (text)</p>
            <p>$60.00 (images)*</p>
            <p>* Output images up to 2K consume 1,290 tokens and are equivalent to $0.0774 per image.</p>
            <h3>Batch</h3>
            <p>Input price Not available $0.25</p>
        `,
    });

    assert.equal(pricing.length, 1);
    assert.equal(pricing[0].modelId, "gemini-3.1-flash-image");
    assert.equal(pricing[0].inputPer1MTokens, 0.5);
    assert.equal(pricing[0].outputPer1MTokens, 3);
    assert.equal(pricing[0].imageOutputPer1MTokens, 60);
    assert.deepEqual(pricing[0].outputImageTokens, [{
        resolution: "2K",
        tokens: 1290,
        equivalentUsd: 0.0774,
    }]);
});

test("parseGoogleGeminiPricingPage extracts text-only pricing from provider HTML", () => {
    const pricing = parseGoogleGeminiPricingPage({
        fetchedAt: new Date("2026-07-06T00:00:00.000Z"),
        html: `
            <h2>Gemini 3.1 Flash-Lite</h2>
            <p><code>gemini-3.1-flash-lite</code></p>
            <h3>Standard</h3>
            <p>Free Tier Paid Tier, per 1M tokens in USD</p>
            <p>Input price Free of charge $0.25 (text / image / video)</p>
            <p>$0.50 (audio)</p>
            <p>Output price (including thinking tokens) Free of charge $1.50</p>
        `,
    });

    assert.equal(pricing.length, 1);
    assert.equal(pricing[0].modelId, "gemini-3.1-flash-lite");
    assert.equal(pricing[0].inputPer1MTokens, 0.25);
    assert.equal(pricing[0].outputPer1MTokens, 1.5);
    assert.equal(pricing[0].imageOutputPer1MTokens, undefined);
});
