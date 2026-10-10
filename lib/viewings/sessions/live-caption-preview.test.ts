import assert from "node:assert/strict";
import test from "node:test";
import { applyLiveCaptionPreview, reconcileLiveCaptionPreview } from "./live-caption-preview";

test("caption previews append streaming fragments and accept cumulative text", () => {
    const first = applyLiveCaptionPreview({}, { channel: "output", targetLanguage: "pl", text: "Dzień", updatedAt: 1 });
    const second = applyLiveCaptionPreview(first, { channel: "output", targetLanguage: "pl", text: "dobry", updatedAt: 2 });
    const third = applyLiveCaptionPreview(second, { channel: "output", targetLanguage: "pl", text: "Dzień dobry!", updatedAt: 3 });
    assert.equal(third["output:pl"].text, "Dzień dobry!");
});

test("persisted translation replaces its preview while a newer partial remains visible", () => {
    const previews = applyLiveCaptionPreview({}, { channel: "output", targetLanguage: "pl", text: "Dzień dobry", updatedAt: 1 });
    const partial = reconcileLiveCaptionPreview(previews, { speaker: "system", origin: "relay_live_transcript", originalText: "Dzień", targetLanguage: "pl" });
    assert.equal(partial["output:pl"].text, "Dzień dobry");
    const complete = reconcileLiveCaptionPreview(partial, { speaker: "system", origin: "relay_live_transcript", originalText: "Dzień dobry", targetLanguage: "pl" });
    assert.deepEqual(complete, {});
});

test("one-way and two-way previews stay distinct by target language", () => {
    const polish = applyLiveCaptionPreview({}, { channel: "output", targetLanguage: "pl", text: "Cześć", updatedAt: 1 });
    const both = applyLiveCaptionPreview(polish, { channel: "output", targetLanguage: "en", text: "Hello", updatedAt: 2 });
    const afterPolish = reconcileLiveCaptionPreview(both, { speaker: "system", origin: "relay_live_transcript", originalText: "Cześć", targetLanguage: "pl" });
    assert.equal(afterPolish["output:en"].text, "Hello");
    assert.equal(afterPolish["output:pl"], undefined);
});
