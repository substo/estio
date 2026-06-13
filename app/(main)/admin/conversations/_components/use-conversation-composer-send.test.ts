import assert from "node:assert/strict";
import test from "node:test";

import { resolveComposerPreviewSendPayload } from "./use-conversation-composer-send";

test("active translation preview is the customer-facing send body", () => {
    const payload = resolveComposerPreviewSendPayload({
        sourceText: "Can we book a viewing tomorrow?",
        translationPreviewText: "Μπορούμε να κλείσουμε προβολή αύριο;",
        translationPreviewLanguage: "el",
        translationPreviewDetectedSource: "en",
        selectedReplyLanguage: "auto",
        autoReplyLanguageValue: "auto",
    });

    assert.equal(payload.textToSend, "Μπορούμε να κλείσουμε προβολή αύριο;");
    assert.deepEqual(payload.translationMeta, {
        translationSourceText: "Can we book a viewing tomorrow?",
        translationTargetLanguage: "el",
        translationDetectedSourceLanguage: "en",
    });
});

test("matching preview does not create redundant translation metadata", () => {
    const payload = resolveComposerPreviewSendPayload({
        sourceText: "Already English",
        translationPreviewText: "Already English",
        translationPreviewLanguage: "en",
        translationPreviewDetectedSource: "en",
        selectedReplyLanguage: "en",
        autoReplyLanguageValue: "auto",
    });

    assert.equal(payload.textToSend, "Already English");
    assert.equal(payload.translationMeta, undefined);
});

