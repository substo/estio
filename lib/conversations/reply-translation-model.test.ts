import test from "node:test";
import assert from "node:assert/strict";

import { resolveReplyTranslationModel } from "./reply-translation-model";

test("reply translation uses the composer-selected ChatGPT subscription model", () => {
    assert.equal(resolveReplyTranslationModel({
        requestedModel: "chatgpt_subscription:gpt-5.5",
        configuredModel: "gemini-flash-latest",
    }), "chatgpt_subscription:gpt-5.5");
});

test("reply translation falls back to the configured model for non-text selections", () => {
    assert.equal(resolveReplyTranslationModel({
        requestedModel: "chatgpt_subscription:gpt-image-2",
        configuredModel: "gemini-flash-latest",
    }), "gemini-flash-latest");
});

test("reply translation falls back to the configured model when no composer model is supplied", () => {
    assert.equal(resolveReplyTranslationModel({
        requestedModel: null,
        configuredModel: "gemini-flash-lite-latest",
    }), "gemini-flash-lite-latest");
});
