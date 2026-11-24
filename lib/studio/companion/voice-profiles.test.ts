import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { encodeWav16 } from "../voices/clone-sample";
import { ensureVoiceReference, forgetVoiceReference } from "./voice-profiles";

const ID = "33333333-3333-4333-8333-333333333333";
const wav = (seconds: number) => encodeWav16(new Float32Array(24_000 * seconds).map((_, i) => Math.sin(i / 15)), 24_000);
const refs = { id: ID, audioUrl: "https://r2.example/a.wav", textUrl: "https://r2.example/t.json" };
const fetcher = (audio: Uint8Array, text: unknown, calls: string[] = []) => (async (url: URL) => { calls.push(String(url)); return String(url).endsWith("wav") ? new Response(audio as BodyInit) : new Response(JSON.stringify(text)); }) as unknown as typeof fetch;

test("fetches the reference once, stores it on this Mac, and reuses it without the network", async () => {
  const root = await mkdtemp(join(tmpdir(), "voices-")), calls: string[] = [];
  const spoken = "Welcome to the demo. Three things matter.";
  const first = await ensureVoiceReference(refs, { root, fetcher: fetcher(wav(12), { text: spoken }, calls) });
  assert.equal(first.text, spoken); assert.equal(calls.length, 2); assert.ok((await stat(first.audio)).size > 100_000); assert.equal(await readFile(join(root, ID, "reference.txt"), "utf8"), spoken);
  const again = await ensureVoiceReference(refs, { root, fetcher: (async () => { throw new Error("no network"); }) as unknown as typeof fetch });
  assert.equal(again.audio, first.audio);
  await forgetVoiceReference(ID, root); await assert.rejects(stat(join(root, ID)));
});
test("refuses bad ids, plain-http links, a too-short or non-WAV reference, and missing text", async () => {
  const root = await mkdtemp(join(tmpdir(), "voices-"));
  await assert.rejects(ensureVoiceReference({ ...refs, id: "../x" }, { root }), /voice_reference_id/);
  await assert.rejects(ensureVoiceReference({ ...refs, audioUrl: "http://r2.example/a.wav" }, { root, fetcher: fetcher(wav(12), { text: "x".repeat(30) }) }), /voice_reference_refused/);
  await assert.rejects(ensureVoiceReference(refs, { root, fetcher: fetcher(wav(2), { text: "x".repeat(30) }) }), /voice_reference_invalid/);
  await assert.rejects(ensureVoiceReference(refs, { root, fetcher: fetcher(new TextEncoder().encode("not a wav"), { text: "x".repeat(30) }) }), /voice_reference_invalid/);
  await assert.rejects(ensureVoiceReference(refs, { root, fetcher: fetcher(wav(12), { text: "short" }) }), /voice_reference_text/);
  await assert.rejects(stat(join(root, ID, "reference.wav")));   // nothing half-written
});
