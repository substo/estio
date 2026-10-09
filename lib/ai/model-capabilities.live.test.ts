import assert from "node:assert/strict";
import test from "node:test";
import { getModelCapabilities, modelSupportsTask } from "./model-capabilities";

test("dedicated live interpreters are not exposed as text or JSON models", () => {
    for (const value of ["gemini-3.5-live-translate-preview", "openai:gpt-realtime-translate"]) {
        const model = { value };
        assert.deepEqual(getModelCapabilities(model), ["audioInput", "streaming", "liveSpeechTranslation"]);
        assert.equal(modelSupportsTask(model, "viewing.translation"), false);
        assert.equal(modelSupportsTask(model, "viewing.liveSpeechTranslation"), true);
    }
});

test("general live and transcription models do not claim interpreter capability", () => {
    for (const value of ["gemini-3.8-live", "openai:gpt-realtime-whisper"]) {
        assert.equal(modelSupportsTask({ value }, "viewing.liveSpeechTranslation"), false);
    }
});
