import assert from "node:assert/strict";
import test from "node:test";
import { selectAssistTranscriptRows } from "./assist-transcript-display";

const source = { id: "source", origin: "relay_live_transcript", speaker: "agent", originalText: "Hello" };
const translation = { id: "translation", origin: "relay_live_transcript", speaker: "system", originalText: "Γεια" };

test("original plus translation shows one combined row after translation arrives", () => {
    assert.deepEqual(
        selectAssistTranscriptRows([source, translation], { isTranslateMode: true, textDisplay: "both" }),
        [{ message: translation, sourceOriginalText: "Hello" }]
    );
});

test("original caption remains visible until its translation arrives", () => {
    assert.deepEqual(
        selectAssistTranscriptRows([source], { isTranslateMode: true, textDisplay: "both" }),
        [{ message: source, sourceOriginalText: null }]
    );
});

test("translation mode and non-translate modes keep their existing row choices", () => {
    assert.deepEqual(
        selectAssistTranscriptRows([source, translation], { isTranslateMode: true, textDisplay: "translation" }),
        [{ message: translation, sourceOriginalText: "Hello" }]
    );
    assert.deepEqual(
        selectAssistTranscriptRows([source, translation], { isTranslateMode: false, textDisplay: "both" }),
        [
            { message: source, sourceOriginalText: null },
            { message: translation, sourceOriginalText: null },
        ]
    );
});
