import assert from "node:assert/strict";
import test from "node:test";

import {
    getMessageBubbleTranslationToggleLabel,
    getOutboundTranslationDisplayMode,
    isManualSendPreviewTranslation,
} from "./message-bubble-body";

const manualPreviewTranslation = {
    targetLanguage: "el",
    sourceLanguage: "en",
    sourceText: "English source",
    translatedText: "Ελληνικό μήνυμα",
    status: "completed" as const,
    provider: "manual_send_preview",
    model: "manual_send_preview",
};

const normalTranslation = {
    targetLanguage: "en",
    sourceLanguage: "el",
    sourceText: "Ελληνικό μήνυμα",
    translatedText: "English translation",
    status: "completed" as const,
    provider: "google",
    model: "gemini-flash-latest",
};

test("outbound manual send preview toggles between sent and source", () => {
    assert.equal(isManualSendPreviewTranslation(manualPreviewTranslation), true);
    assert.equal(getOutboundTranslationDisplayMode(manualPreviewTranslation, "original"), "sent");
    assert.equal(getOutboundTranslationDisplayMode(manualPreviewTranslation, "translated"), "source");
    assert.equal(getMessageBubbleTranslationToggleLabel({
        isOutbound: true,
        activeTranslation: manualPreviewTranslation,
        translationViewMode: "original",
        threadTranslationMode: "original",
    }), "Show source");
});

test("outbound normal translation toggles between sent and translated meaning", () => {
    assert.equal(isManualSendPreviewTranslation(normalTranslation), false);
    assert.equal(getOutboundTranslationDisplayMode(normalTranslation, "original"), "sent");
    assert.equal(getOutboundTranslationDisplayMode(normalTranslation, "translated"), "translation");
    assert.equal(getMessageBubbleTranslationToggleLabel({
        isOutbound: true,
        activeTranslation: normalTranslation,
        translationViewMode: "original",
        threadTranslationMode: "original",
    }), "Show translation");
});

