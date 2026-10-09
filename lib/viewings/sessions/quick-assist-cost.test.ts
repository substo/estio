import test from "node:test";
import assert from "node:assert/strict";
import { estimateQuickAssistCost, googleUsageCounts, formatQuickAssistCost } from "./quick-assist-cost";
import { quickAssistModelOptions, selectQuickAssistModel } from "./quick-assist-models";

test("Google audio pricing includes thinking output and modality counts", () => {
    const counts = googleUsageCounts({ promptTokenCount: 1200, candidatesTokenCount: 200, thoughtsTokenCount: 100, totalTokenCount: 1500, promptTokensDetails: [{ modality: "AUDIO", tokenCount: 1000 }, { modality: "TEXT", tokenCount: 200 }] }, true);
    const cost = estimateQuickAssistCost({ model: "gemini-2.5-flash", ...counts });
    assert.equal(counts.outputTokens, 300);
    assert.equal(cost.amount, (200 * .3 + 1000 + 300 * 2.5) / 1e6);
});
test("live translation charges input and output audio once", () => {
    const cost = estimateQuickAssistCost({ model: "gemini-3.5-live-translate-preview", inputTokens: 1500, outputTokens: 1500, inputAudioTokens: 1500, outputAudioTokens: 1500 });
    assert.equal(cost.amount, 1500 * (3.5 + 21) / 1e6);
});
test("OpenAI translation and original captions are separate duration charges", () => {
    const base = { inputTokens: 0, outputTokens: 0, inputAudioSeconds: 60 };
    assert.equal(estimateQuickAssistCost({ ...base, model: "gpt-realtime-translate" }).amount, .034);
    assert.equal(estimateQuickAssistCost({ ...base, model: "gpt-realtime-whisper" }).amount, .017);
});
test("cached text uses its discounted rate", () => {
    assert.equal(estimateQuickAssistCost({ model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 100, cachedInputTokens: 500 }).amount, (500 * .15 + 500 * .075 + 100 * .6) / 1e6);
});
test("missing usage and unknown models are unavailable, subscription is distinct", () => {
    const base = { inputTokens: 10, outputTokens: 20 };
    assert.equal(estimateQuickAssistCost({ ...base, model: "unknown" }).status, "unavailable");
    assert.equal(estimateQuickAssistCost({ ...base, model: "gpt-4o-mini", usageAvailable: false }).status, "unavailable");
    assert.equal(estimateQuickAssistCost({ ...base, model: "chatgpt_subscription:gpt-5.4" }).status, "subscription");
    assert.notEqual(formatQuickAssistCost(.00015), "$0.00");
});
test("explicit model selection never falls back to a different provider", () => {
    const models = quickAssistModelOptions({ google: true, openai: true, codex: true });
    assert.equal(selectQuickAssistModel(models.assistant, "chatgpt_subscription:gpt-5.4").provider, "ChatGPT/Codex");
    assert.equal(selectQuickAssistModel(models.transcribe, "gpt-4o-mini-transcribe").provider, "OpenAI API");
    assert.equal(models.transcribe.some(o => o.provider === "ChatGPT/Codex"), false);
    assert.throws(() => selectQuickAssistModel(quickAssistModelOptions({ google: true, openai: false, codex: false }).assistant, "openai:gpt-4o-mini"));
});
test("live response token field and cached audio receive the correct rates", () => {
    const counts = googleUsageCounts({ promptTokenCount: 1000, responseTokenCount: 100, totalTokenCount: 1100, cachedContentTokenCount: 500, promptTokensDetails: [{ modality: "AUDIO", tokenCount: 1000 }], cacheTokensDetails: [{ modality: "AUDIO", tokenCount: 500 }] }, true);
    assert.equal(counts.outputTokens, 100);
    assert.equal(estimateQuickAssistCost({ model: "gemini-2.5-flash", ...counts }).amount, (500 + 500 * .1 + 100 * 2.5) / 1e6);
});
