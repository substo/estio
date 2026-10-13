import test from "node:test";
import assert from "node:assert/strict";
import { estimateReplaySpeechTokens, replaySpeechAudio, replaySpeechCost, replaySpeechUsage } from "./replay-speech";

test("Google TTS audio and usage are parsed without retaining transcript content", () => {
    const wav = Buffer.alloc(44 + 48_000);
    wav.write("RIFF", 0);
    wav.write("WAVE", 8);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24_000, 24);
    wav.writeUInt16LE(16, 34);
    const payload = { steps: [{ type: "model_output", content: [{ type: "audio", data: wav.toString("base64") }] }], usage: { total_input_tokens: 20, total_output_tokens: 25 } };
    assert.deepEqual(replaySpeechAudio(payload), wav);
    assert.deepEqual(replaySpeechUsage(payload), { inputTokens: 20, outputTokens: 25, providerReported: true });
    assert.deepEqual(estimateReplaySpeechTokens("Cześć", wav), { inputTokens: 2, outputTokens: 25, seconds: 1 });
    assert.equal(replaySpeechAudio({ steps: [{ type: "model_output", content: [{ type: "audio", data: "not-a-wav" }] }] }), null);
});

test("Google TTS cost follows published 2026 and 2027 schedules", () => {
    assert.equal(replaySpeechCost("gemini-3.8-flash-lite-tts", 100, 250, new Date("2026-10-13")), (100 * .5 + 250 * 6) / 1_000_000);
    assert.equal(replaySpeechCost("gemini-3.8-flash-tts", 100, 250, new Date("2027-01-01")), (100 + 250 * 18) / 1_000_000);
});
