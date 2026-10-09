import assert from "node:assert/strict";
import test from "node:test";
import { mapGeminiTranslationMessage, mapOpenAiTranslationEvent } from "./live-translation-events";

test("OpenAI translation deltas retain exact text fragments and audio sample rate", () => {
    assert.deepEqual(mapOpenAiTranslationEvent({ type: "session.input_transcript.delta", delta: "Hello" }), { kind: "inputText", delta: "Hello" });
    assert.deepEqual(mapOpenAiTranslationEvent({ type: "session.output_transcript.delta", delta: " świecie" }), { kind: "outputText", delta: " świecie" });
    assert.deepEqual(mapOpenAiTranslationEvent({ type: "session.output_audio.delta", delta: "AA==", sample_rate: 24000 }), { kind: "audio", data: "AA==", mimeType: "audio/pcm;rate=24000" });
    assert.deepEqual(mapOpenAiTranslationEvent({ type: "session.updated" }), { kind: "ready" });
});

test("Google translation keeps source, target, and audio separate", () => {
    const mapped = mapGeminiTranslationMessage({ serverContent: {
        inputTranscription: { text: "Hello", finished: true },
        outputTranscription: { text: "Cześć", finished: true },
        modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "AA==" } }] },
    } });
    assert.equal(mapped.inputText, "Hello");
    assert.equal(mapped.outputText, "Cześć");
    assert.deepEqual(mapped.audioChunks, [{ mimeType: "audio/pcm;rate=24000", data: "AA==" }]);
});
