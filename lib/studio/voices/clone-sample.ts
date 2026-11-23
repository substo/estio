/** Clone sample rules and the browser-side WAV encoder. Pure, shared by the recorder, the upload checker, the route and tests. */
export type CloneTarget = "elevenlabs" | "fish" | "local";
export interface SamplePolicy {
  /** Below this the provider (or the model) refuses or the clone is poor. */
  minSeconds: number;
  /** "Good enough": the meter turns green here. */
  goodSeconds: number;
  /** More audio does not help; the recorder says so and the route refuses beyond maxSeconds. */
  maxSeconds: number;
  /** Where each number comes from, shown to the owner and kept honest in the findings doc. */
  basis: string;
}
/** ElevenLabs docs: instant clone wants 1-2 minutes of clean single-speaker audio (a minimum of ~10 s total, 5 s per file); clarity beats length.
 *  Fish docs: each sample at least 10 s, more helps up to about a minute (no documented maximum; 90 s is our cap). Local zero-shot (Qwen3-TTS Base): a clean 5-30 s reference plus its exact transcript (mlx-audio guide). */
export const SAMPLE_POLICY: Record<CloneTarget, SamplePolicy> = {
  elevenlabs: { minSeconds: 20, goodSeconds: 60, maxSeconds: 180, basis: "ElevenLabs recommends 1 to 2 minutes of clean audio from one speaker." },
  fish: { minSeconds: 15, goodSeconds: 30, maxSeconds: 90, basis: "Fish Audio needs at least 10 seconds; 30 to 60 clean seconds gives a steadier clone." },
  local: { minSeconds: 8, goodSeconds: 15, maxSeconds: 30, basis: "On-device cloning works from a clean 8 to 30 second reference and the exact words spoken." },
};
export const SAMPLE_TIPS = ["Quiet room, no echo, no music or other voices.", "Same microphone and distance for the whole take.", "Speak the way you will speak in videos, not in a flat reading voice."];

export type SampleVerdict = { level: "error" | "warn" | "ok"; message: string };
export function checkSampleLength(target: CloneTarget, seconds: number): SampleVerdict {
  const p = SAMPLE_POLICY[target];
  if (!Number.isFinite(seconds) || seconds <= 0) return { level: "error", message: "No audio was found in the sample." };
  const s = Math.round(seconds);
  if (seconds < p.minSeconds) return { level: "error", message: `That is ${s} seconds. This voice needs at least ${p.minSeconds} seconds. ${p.basis}` };
  if (seconds > p.maxSeconds) return { level: "error", message: `That is ${s} seconds. Use at most ${p.maxSeconds} seconds; longer samples do not make a better clone.` };
  if (seconds < p.goodSeconds) return { level: "warn", message: `${s} seconds is enough to start. ${p.goodSeconds} seconds or more gives a better clone.` };
  return { level: "ok", message: `${s} seconds. That is plenty.` };
}

export const WAV_RATE = 24_000;
/** Linear resampling of mono float samples. Good enough for speech at 24 kHz. */
export function resampleMono(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || input.length === 0) return input;
  const ratio = from / to, length = Math.max(1, Math.floor(input.length / ratio)), out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio, a = Math.floor(pos), b = Math.min(a + 1, input.length - 1), frac = pos - a;
    out[i] = input[a] * (1 - frac) + input[b] * frac;
  }
  return out;
}
/** 16-bit PCM mono WAV. Accepted by Fish and ElevenLabs and by the on-device model; MediaRecorder's WebM/Opus is not reliably accepted. */
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = samples.length * 2, out = new Uint8Array(44 + bytes), view = new DataView(out.buffer);
  const text = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, 36 + bytes, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, bytes, true);
  for (let i = 0; i < samples.length; i++) { const v = Math.max(-1, Math.min(1, samples[i])); view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
  return out;
}
/** Duration of a PCM WAV from its header, or null when it is not a plain PCM WAV. Used by the route so a too-short sample is refused before any provider call. */
export function wavSeconds(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let offset = 12, rate = 0, channels = 0, bits = 0;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset), size = view.getUint32(offset + 4, true);
    if (id === "fmt ") { if (view.getUint16(offset + 8, true) !== 1) return null; channels = view.getUint16(offset + 10, true); rate = view.getUint32(offset + 12, true); bits = view.getUint16(offset + 22, true); }
    if (id === "data") { if (!rate || !channels || !bits) return null; const length = Math.min(size, bytes.length - offset - 8); return length / (rate * channels * (bits / 8)); }
    offset += 8 + size + (size % 2);
  }
  return null;
}
