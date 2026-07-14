import test from "node:test";
import assert from "node:assert/strict";
import {
    calculateMissingProviderModelStatus,
    classifyProviderModelCapabilities,
} from "@/lib/ai/provider-model-catalog";

test("classifyProviderModelCapabilities recognizes Gemini image generation models", () => {
    const capabilities = classifyProviderModelCapabilities({
        provider: "google_gemini",
        modelId: "gemini-3.1-flash-lite-image",
        label: "Gemini 3.1 Flash-Lite Image",
    });

    assert.equal(capabilities.includes("imageGeneration"), true);
    assert.equal(capabilities.includes("imageEdit"), true);
});

test("classifyProviderModelCapabilities keeps ChatGPT subscription image guesses disabled by default", () => {
    const capabilities = classifyProviderModelCapabilities({
        provider: "chatgpt_subscription",
        modelId: "chatgpt_subscription:gpt-image-2",
        label: "ChatGPT Subscription GPT Image 2",
    });

    assert.deepEqual(capabilities, []);
});

test("classifyProviderModelCapabilities rejects ChatGPT subscription image models even with legacy experimental flag", () => {
    const original = process.env.CHATGPT_SUBSCRIPTION_IMAGE_GENERATION;
    process.env.CHATGPT_SUBSCRIPTION_IMAGE_GENERATION = "codex_imagegen_experimental";
    try {
        const capabilities = classifyProviderModelCapabilities({
            provider: "chatgpt_subscription",
            modelId: "chatgpt_subscription:gpt-image-2",
            label: "ChatGPT Subscription GPT Image 2",
        });

        assert.deepEqual(capabilities, []);
    } finally {
        if (original === undefined) delete process.env.CHATGPT_SUBSCRIPTION_IMAGE_GENERATION;
        else process.env.CHATGPT_SUBSCRIPTION_IMAGE_GENERATION = original;
    }
});

test("classifyProviderModelCapabilities separates OpenAI text and image models", () => {
    assert.deepEqual(
        classifyProviderModelCapabilities({
            provider: "openai_api",
            modelId: "openai:gpt-5.5-mini",
        }),
        ["text", "json", "vision", "streaming"]
    );

    assert.deepEqual(
        classifyProviderModelCapabilities({
            provider: "openai_api",
            modelId: "openai:gpt-image-2",
        }),
        ["imageGeneration", "imageEdit"]
    );
});

test("calculateMissingProviderModelStatus marks missing models stale before unavailable threshold", () => {
    const checkedAt = new Date("2026-07-05T12:00:00.000Z");
    const lastSeenAt = new Date("2026-07-01T12:00:00.000Z");

    assert.equal(calculateMissingProviderModelStatus({ checkedAt, lastSeenAt }), "stale");
});

test("calculateMissingProviderModelStatus marks missing models unavailable after threshold", () => {
    const checkedAt = new Date("2026-07-05T12:00:00.000Z");
    const lastSeenAt = new Date("2026-06-20T12:00:00.000Z");

    assert.equal(calculateMissingProviderModelStatus({ checkedAt, lastSeenAt }), "unavailable");
});
