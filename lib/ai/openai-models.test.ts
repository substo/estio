import test from "node:test";
import assert from "node:assert/strict";

import {
    ensureOpenAiModelOption,
    isLikelyOpenAiTextGenerationModel,
    labelOpenAiModel,
    resolveOpenAiDefaultModelFromOptions,
    stripOpenAiModelPrefix,
} from "./openai-models";

test("isLikelyOpenAiTextGenerationModel keeps text models and excludes specialized models", () => {
    assert.equal(isLikelyOpenAiTextGenerationModel("gpt-4.1"), true);
    assert.equal(isLikelyOpenAiTextGenerationModel("gpt-4o-mini"), true);
    assert.equal(isLikelyOpenAiTextGenerationModel("chatgpt-4o-latest"), true);
    assert.equal(isLikelyOpenAiTextGenerationModel("o3"), true);
    assert.equal(isLikelyOpenAiTextGenerationModel("gpt-4o-transcribe"), false);
    assert.equal(isLikelyOpenAiTextGenerationModel("gpt-4o-audio-preview"), false);
    assert.equal(isLikelyOpenAiTextGenerationModel("gpt-4o-realtime-preview"), false);
    assert.equal(isLikelyOpenAiTextGenerationModel("text-embedding-3-large"), false);
    assert.equal(isLikelyOpenAiTextGenerationModel("sora-2"), false);
});

test("stripOpenAiModelPrefix preserves raw OpenAI ids", () => {
    assert.equal(stripOpenAiModelPrefix("openai:gpt-4o-mini"), "gpt-4o-mini");
    assert.equal(stripOpenAiModelPrefix("gpt-4o-mini"), "gpt-4o-mini");
});

test("labelOpenAiModel creates readable labels", () => {
    assert.equal(labelOpenAiModel("gpt-4o-mini"), "OpenAI GPT 4o Mini");
});

test("resolveOpenAiDefaultModelFromOptions prefers configured available model", () => {
    const models = [
        { value: "openai:gpt-4o-mini", label: "OpenAI GPT-4o Mini" },
        { value: "openai:gpt-test", label: "OpenAI GPT Test" },
    ];

    assert.equal(resolveOpenAiDefaultModelFromOptions(models, "gpt-test"), "openai:gpt-test");
    assert.equal(resolveOpenAiDefaultModelFromOptions(models, "openai:gpt-missing"), "openai:gpt-4o-mini");
});

test("ensureOpenAiModelOption preserves saved model not returned by provider list", () => {
    const models = [
        { value: "openai:gpt-4o-mini", label: "OpenAI GPT-4o Mini" },
    ];

    const withSaved = ensureOpenAiModelOption(models, "gpt-saved-preview");
    assert.equal(withSaved[0].value, "openai:gpt-saved-preview");
    assert.equal(withSaved[0].label, "OpenAI GPT Saved Preview");
    assert.equal(withSaved.length, 2);
    assert.equal(ensureOpenAiModelOption(models, "openai:gpt-4o-mini"), models);
});
