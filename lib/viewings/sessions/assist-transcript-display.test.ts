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

test("translate mode shows output while transcribe mode keeps only captured speech", () => {
    assert.deepEqual(
        selectAssistTranscriptRows([source, translation], { isTranslateMode: true, textDisplay: "translation" }),
        [{ message: translation, sourceOriginalText: "Hello" }]
    );
    assert.deepEqual(
        selectAssistTranscriptRows([source, translation], { isTranslateMode: false, isTranscribeMode: true, textDisplay: "both" }),
        [{ message: source, sourceOriginalText: null }]
    );
});

test("transcribe mode keeps the original field of a message with an embedded translation", () => {
    const message = { id: "speech", origin: "browser_stt", speaker: "agent", originalText: "Hello", translatedText: "Γεια" };
    assert.deepEqual(
        selectAssistTranscriptRows([message], { isTranslateMode: false, isTranscribeMode: true, textDisplay: "both" }),
        [{ message, sourceOriginalText: null }]
    );
});

test("Ask AI keeps its answer while omitting relay-only translation rows", () => {
    const answer = { id: "answer", origin: "manual_text", speaker: "system", originalText: "Here is the answer" };
    assert.deepEqual(
        selectAssistTranscriptRows([source, translation, answer], { isTranslateMode: false, textDisplay: "both" }),
        [
            { message: source, sourceOriginalText: null },
            { message: answer, sourceOriginalText: null },
        ]
    );
});
