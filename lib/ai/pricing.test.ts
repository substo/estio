import test from "node:test";
import assert from "node:assert/strict";

import {
    buildUnavailableProviderCostEstimate,
    calculateRunCostFromUsage,
} from "./pricing";

test("calculateRunCostFromUsage estimates known Gemini pricing", () => {
    const estimate = calculateRunCostFromUsage("gemini-2.5-flash-lite", {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
        totalTokens: 2_000_000,
    });

    assert.equal(estimate.amount, 0.5);
    assert.equal(estimate.method, "prompt_completion_only");
    assert.equal(estimate.breakdown.inputRatePerMillion, 0.1);
    assert.equal(estimate.breakdown.outputRatePerMillion, 0.4);
});

test("buildUnavailableProviderCostEstimate records usage without pretending price is known", () => {
    const estimate = buildUnavailableProviderCostEstimate("openai", {
        promptTokens: 123,
        completionTokens: 45,
        totalTokens: 168,
        thoughtsTokens: 7,
        toolUsePromptTokens: 11,
    });

    assert.equal(estimate.amount, 0);
    assert.equal(estimate.provider, "openai");
    assert.equal(estimate.method, "provider_pricing_unavailable");
    assert.equal(estimate.confidence, "low");
    assert.match(estimate.note || "", /not available from an official dynamic API/);
    assert.equal(estimate.breakdown.billableInputTokens, 134);
    assert.equal(estimate.breakdown.billableOutputTokens, 52);
    assert.equal(estimate.breakdown.inputRatePerMillion, 0);
    assert.equal(estimate.breakdown.outputRatePerMillion, 0);
});
