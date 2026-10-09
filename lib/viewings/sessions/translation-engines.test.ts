import assert from "node:assert/strict";
import test from "node:test";
import { GOOGLE_TRANSLATE_MODEL, OPENAI_TRANSLATE_MODEL, selectTranslationModel, type TranslationEngine } from "./translation-engines";

const google: TranslationEngine = { provider: "google_gemini_live", model: GOOGLE_TRANSLATE_MODEL, configured: true, listed: true, checkedAt: "2026-10-09T00:00:00.000Z", error: null };
const openai: TranslationEngine = { provider: "openai_realtime_translation", model: OPENAI_TRANSLATE_MODEL, configured: true, listed: true, checkedAt: "2026-10-09T00:00:00.000Z", error: null };

test("automatic translation chooses a location-listed supported engine", () => {
    assert.deepEqual(selectTranslationModel({ requestedModel: "automatic", engines: [{ ...google, listed: false }, openai] }), { model: OPENAI_TRANSLATE_MODEL, provider: "openai_realtime_translation" });
});

test("an explicit saved engine survives reconnection and is not silently replaced", () => {
    assert.deepEqual(selectTranslationModel({ savedModel: OPENAI_TRANSLATE_MODEL, engines: [google, openai] }), { model: OPENAI_TRANSLATE_MODEL, provider: "openai_realtime_translation" });
    assert.equal(selectTranslationModel({ savedModel: OPENAI_TRANSLATE_MODEL, engines: [google, { ...openai, listed: false }] }), null);
});

test("disconnected and unknown models cannot be routed", () => {
    assert.equal(selectTranslationModel({ requestedModel: OPENAI_TRANSLATE_MODEL, engines: [google, { ...openai, configured: false }] }), null);
    assert.equal(selectTranslationModel({ requestedModel: "gpt-realtime-whisper", engines: [google, openai] }), null);
});
