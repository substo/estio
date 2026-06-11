import assert from "node:assert/strict";
import test from "node:test";

import {
    isUsableMessageTranslationText,
    parseTranslationModelOutput,
} from "./translation-output";

test("parseTranslationModelOutput unwraps valid translation JSON", () => {
    const parsed = parseTranslationModelOutput(JSON.stringify({
        translatedText: "Hello\nWorld",
        detectedSourceLanguage: "zh",
        confidence: 0.91,
    }));

    assert.equal(parsed.translatedText, "Hello\nWorld");
    assert.equal(parsed.detectedSourceLanguage, "zh");
    assert.equal(parsed.confidence, 0.91);
});

test("parseTranslationModelOutput extracts translatedText from truncated JSON envelope", () => {
    const parsed = parseTranslationModelOutput('{\n  "translatedText": "Thank you for the detailed explanation.\\nProperty type: Luxury villa');

    assert.equal(parsed.translatedText, "Thank you for the detailed explanation.\nProperty type: Luxury villa");
    assert.equal(parsed.detectedSourceLanguage, null);
    assert.equal(parsed.confidence, null);
});

test("isUsableMessageTranslationText rejects JSON envelope cache values", () => {
    assert.equal(isUsableMessageTranslationText('{"translatedText":"Hello"}'), false);
    assert.equal(isUsableMessageTranslationText("Hello"), true);
    assert.equal(isUsableMessageTranslationText(""), false);
});
