import assert from "node:assert/strict";
import { test } from "node:test";
import { StudioJobError } from "../worker/handlers";
import { createVoicePreviewHandler, MAX_PREVIEW_BASE64, PREVIEW_TEXT } from "./voice-preview";

const job = (p: Record<string, unknown>) => ({ id: "j", kind: "studio.voice_preview", payload: p, lease_token: "t" }) as never;
const ctx = () => ({ signal: new AbortController().signal, workerId: "w" }) as never;
const base = { voiceId: "11111111-1111-4111-8111-111111111111", speaker: "ryan" };
const deps = (o: Record<string, unknown> = {}) => ({ enabled: () => true, ready: async () => true, synth: async () => Buffer.alloc(5000, 1), compress: async (b: Buffer) => b.subarray(0, 3000), ...o }) as never;
const code = async (h: ReturnType<typeof createVoicePreviewHandler>, p: Record<string, unknown>) => { try { await h(job(p), ctx()); return null; } catch (e) { return e instanceof StudioJobError ? e.code : String(e); } };

test("returns a bounded base64 preview of the chosen speaker with the fixed sentence", async () => {
  let text = "", speaker = "";
  const h = createVoicePreviewHandler(deps({ synth: async (s: string, t: string) => { speaker = s; text = t; return Buffer.alloc(5000, 1); } }));
  const r = await h(job(base), ctx()) as { preview: { audioBase64: string; bytes: number; speaker: string; seconds: number } };
  assert.equal(speaker, "ryan"); assert.equal(text, PREVIEW_TEXT);
  assert.equal(r.preview.bytes, 3000); assert.equal(r.preview.speaker, "ryan");
  assert.ok(r.preview.audioBase64.length <= MAX_PREVIEW_BASE64 && /^[A-Za-z0-9+/=]+$/.test(r.preview.audioBase64));
});
test("gates: bad payload, unknown speaker, processing off, model not installed, oversized or tiny audio", async () => {
  const h = createVoicePreviewHandler(deps());
  assert.equal(await code(h, { voiceId: "x", speaker: "ryan" }), "invalid_job_payload");
  assert.equal(await code(h, { ...base, speaker: "../etc" }), "invalid_job_payload");
  assert.equal(await code(createVoicePreviewHandler(deps({ enabled: () => false })), base), "local_policy");
  assert.equal(await code(createVoicePreviewHandler(deps({ ready: async () => false })), base), "voice_model_missing");
  assert.equal(await code(createVoicePreviewHandler(deps({ compress: async () => Buffer.alloc(30000, 1) })), base), "voice_preview_failed");
  assert.equal(await code(createVoicePreviewHandler(deps({ compress: async () => Buffer.alloc(10) })), base), "voice_preview_failed");
  assert.equal(await code(createVoicePreviewHandler(deps({ synth: async () => { throw new Error("boom"); } })), base), "voice_preview_failed");
});

const CLONE = "clone-22222222-2222-4222-8222-222222222222";
const ref = { id: "22222222-2222-4222-8222-222222222222", audioUrl: "https://r2.example/a.wav", textUrl: "https://r2.example/t.json" };
test("an on-device clone is previewed from its reference; it needs the Base model and a reference", async () => {
  let seen: { speaker: string; reference?: { audio: string; text: string } } | null = null;
  const h = createVoicePreviewHandler(deps({ ready: async (s: string) => s.startsWith("clone-"), reference: async () => ({ audio: "/v/a.wav", text: "the exact words spoken" }),
    synth: async (speaker: string, _t: string, _s: AbortSignal, reference?: { audio: string; text: string }) => { seen = { speaker, reference }; return Buffer.alloc(5000, 1); } }));
  const r = await h(job({ ...base, speaker: CLONE, voiceReference: ref }), ctx()) as { preview: { speaker: string } };
  assert.equal(r.preview.speaker, CLONE); assert.deepEqual(seen!.reference, { audio: "/v/a.wav", text: "the exact words spoken" });
  assert.equal(await code(createVoicePreviewHandler(deps({ ready: async () => false })), { ...base, speaker: CLONE, voiceReference: ref }), "voice_model_missing");
  assert.equal(await code(createVoicePreviewHandler(deps({ reference: async () => ({ audio: "a", text: "b" }) })), { ...base, speaker: CLONE }), "voice_reference_missing");
  assert.equal(await code(createVoicePreviewHandler(deps({ reference: async () => ({ audio: "a", text: "b" }) })), { ...base, speaker: "clone-../x", voiceReference: ref }), "invalid_job_payload");
});
