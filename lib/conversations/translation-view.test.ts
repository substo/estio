import test from "node:test";
import assert from "node:assert/strict";

import {
    buildMessageTranslationState,
    getResolvedConversationTranslationLanguage,
    isLikelyForeignLanguageMessage,
    selectActiveTranslation,
    shouldDefaultThreadToTranslated,
} from "./translation-view";

test("getResolvedConversationTranslationLanguage prefers conversation override", () => {
    assert.equal(
        getResolvedConversationTranslationLanguage({
            replyLanguageOverride: "es",
            locationDefaultReplyLanguage: "en",
        }),
        "es"
    );
});

test("selectActiveTranslation prefers an exact target-language match", () => {
    const result = selectActiveTranslation([
        {
            targetLanguage: "en",
            sourceLanguage: "el",
            sourceText: "γειά",
            translatedText: "hello",
            status: "completed",
        },
        {
            targetLanguage: "fr",
            sourceLanguage: "el",
            sourceText: "γειά",
            translatedText: "bonjour",
            status: "completed",
        },
    ], "fr");

    assert.equal(result?.translatedText, "bonjour");
});

test("buildMessageTranslationState defaults inbound foreign messages to translated view", () => {
    const state = buildMessageTranslationState({
        direction: "inbound",
        detectedLanguage: "el",
        detectedLanguageConfidence: 0.93,
    }, [{
        targetLanguage: "en",
        sourceLanguage: "el",
        sourceText: "γειά σου",
        translatedText: "hello",
        status: "completed",
    }], "en");

    assert.equal(state.viewDefault, "translated");
    assert.equal(state.active?.translatedText, "hello");
});

test("isLikelyForeignLanguageMessage ignores inbound text already matching target language", () => {
    assert.equal(
        isLikelyForeignLanguageMessage({
            direction: "inbound",
            body: "Hello there",
            detectedLanguage: "en",
        }, "en"),
        false
    );
});

test("shouldDefaultThreadToTranslated prefers translated view when foreign inbound messages already have overlays", () => {
    assert.equal(
        shouldDefaultThreadToTranslated([
            {
                direction: "inbound",
                body: "hola",
                detectedLanguage: "es",
                translation: {
                    active: {
                        targetLanguage: "en",
                        sourceLanguage: "es",
                        sourceText: "hola",
                        translatedText: "hello",
                        status: "completed",
                    },
                    available: [],
                    viewDefault: "translated",
                },
                translations: [],
            },
            {
                direction: "inbound",
                body: "gracias",
                detectedLanguage: "es",
                translation: {
                    active: {
                        targetLanguage: "en",
                        sourceLanguage: "es",
                        sourceText: "gracias",
                        translatedText: "thanks",
                        status: "completed",
                    },
                    available: [],
                    viewDefault: "translated",
                },
                translations: [],
            },
        ], "en"),
        true
    );
});
