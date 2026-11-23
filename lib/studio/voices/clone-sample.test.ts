import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSampleLength, encodeWav16, resampleMono, SAMPLE_POLICY, wavSeconds } from "./clone-sample";

test("WAV encoding round-trips duration and is mono 16-bit PCM", () => {
  const samples = new Float32Array(24_000 * 3).map((_, i) => Math.sin(i / 20));
  const wav = encodeWav16(samples, 24_000);
  assert.equal(wav.length, 44 + 24_000 * 3 * 2);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), "RIFF");
  assert.ok(Math.abs((wavSeconds(wav) ?? 0) - 3) < 0.001);
  assert.equal(wavSeconds(new Uint8Array(10)), null);
  assert.equal(wavSeconds(new TextEncoder().encode("ID3".padEnd(60, "x"))), null);
});
test("clipping is clamped, not wrapped", () => {
  const wav = encodeWav16(new Float32Array([2, -2]), 8000), view = new DataView(wav.buffer);
  assert.equal(view.getInt16(44, true), 32767); assert.equal(view.getInt16(46, true), -32768);
});
test("resampling halves the length for 48k to 24k and keeps a constant signal constant", () => {
  const out = resampleMono(new Float32Array(48_000).fill(0.5), 48_000, 24_000);
  assert.equal(out.length, 24_000); assert.ok(out.every(v => Math.abs(v - 0.5) < 1e-6));
  assert.equal(resampleMono(new Float32Array(10), 24_000, 24_000).length, 10);
});
test("each provider has its own minimum, good and maximum", () => {
  assert.equal(checkSampleLength("elevenlabs", 10).level, "error");
  assert.equal(checkSampleLength("elevenlabs", 30).level, "warn");
  assert.equal(checkSampleLength("elevenlabs", 90).level, "ok");
  assert.equal(checkSampleLength("fish", 12).level, "error");
  assert.equal(checkSampleLength("fish", 40).level, "ok");
  assert.equal(checkSampleLength("fish", 200).level, "error");
  assert.equal(checkSampleLength("local", 20).level, "ok");
  assert.equal(checkSampleLength("local", 0).level, "error");
  for (const p of Object.values(SAMPLE_POLICY)) assert.ok(p.minSeconds < p.goodSeconds && p.goodSeconds < p.maxSeconds);
});
