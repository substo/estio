import assert from "node:assert/strict";
import { test } from "node:test";
import { cloneProviderVoice, deleteProviderVoice, generateMusicBed, generateSoundEffect, listProviderVoices, synthesizeHosted, verifyVoiceKey, VoiceProviderError } from "./clients";
import { assertSampleLength, pickDefaultVoice, readCloneForm, readVoiceKey, type VoiceRow } from "./policy";

const calls: { url: string; init: RequestInit }[] = [];
const respond = (body: unknown, status = 200) => (async (url: string, init: RequestInit) => { calls.push({ url: String(url), init }); return new Response(typeof body === "string" || body instanceof Buffer ? body : JSON.stringify(body), { status }); }) as unknown as typeof fetch;

test("keys are shape-checked per provider and never echoed", () => {
  assert.throws(() => readVoiceKey("fish", "short"), /Fish/);
  assert.equal(readVoiceKey("fish", " " + "a".repeat(32) + " "), "a".repeat(32));
  assert.throws(() => readVoiceKey("elevenlabs", null), /ElevenLabs/);
});

test("verify: ok is valid, scoped ElevenLabs key is valid, 401 invalid, network unavailable", async () => {
  assert.equal(await verifyVoiceKey("fish", "k", respond({}, 200)), "valid");
  assert.equal(await verifyVoiceKey("elevenlabs", "k", respond({ detail: { status: "missing_permissions" } }, 401)), "valid");
  assert.equal(await verifyVoiceKey("fish", "k", respond({}, 401)), "invalid");
  assert.equal(await verifyVoiceKey("fish", "k", (async () => { throw new Error("net"); }) as unknown as typeof fetch), "unavailable");
});

test("list parses both providers defensively", async () => {
  const fish = await listProviderVoices("fish", "k", respond({ items: [{ _id: "abcdef123456", title: "Mine", languages: ["en"] }, { _id: "../bad" }, {}] }));
  assert.deepEqual(fish, [{ providerVoiceId: "abcdef123456", name: "Mine", language: "en", kind: "clone", description: null, tags: [] }]);
  const eleven = await listProviderVoices("elevenlabs", "k", respond({ voices: [{ voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "premade", description: "Calm", labels: { gender: "female", use_case: "narration" } }, { voice_id: "cloneVoice123", name: "Me", category: "cloned" }] }));
  assert.deepEqual(eleven.map(v => [v.name, v.kind]), [["Rachel", "preset"], ["Me", "clone"]]);
  assert.deepEqual(eleven[0].tags, ["gender:female", "use:narration"]); assert.equal(eleven[0].description, "Calm");
  await assert.rejects(listProviderVoices("fish", "k", respond({}, 401)), (e: unknown) => e instanceof VoiceProviderError && e.code === "invalid_key");
});

test("clone sends the sample as multipart to the right endpoint and returns the id", async () => {
  calls.length = 0;
  const id = await cloneProviderVoice("fish", "k", { name: "Me", sample: new Blob([new Uint8Array(30000)]), filename: "me.mp3" }, respond({ _id: "fishvoice123" }));
  assert.equal(id, "fishvoice123"); assert.equal(calls[0].url, "https://api.fish.audio/model");
  const form = calls[0].init.body as FormData; assert.equal(form.get("type"), "tts"); assert.equal(form.get("visibility"), "private"); assert.ok(form.get("voices") instanceof Blob);
  const e = await cloneProviderVoice("elevenlabs", "k", { name: "Me", sample: new Blob([new Uint8Array(30000)]), filename: "me.mp3" }, respond({ voice_id: "elevenvoice1" }));
  assert.equal(e, "elevenvoice1"); assert.equal(calls[1].url, "https://api.elevenlabs.io/v1/voices/add");
  await assert.rejects(cloneProviderVoice("fish", "k", { name: "x", sample: new Blob(["x"]), filename: "x.mp3" }, respond({})), /voice id/);
});

test("delete tolerates a voice already gone and refuses a bad id", async () => {
  await deleteProviderVoice("fish", "k", "abcdef123456", respond({}, 404));
  await assert.rejects(deleteProviderVoice("fish", "k", "../x", respond({})), /Invalid voice id/);
});

test("synthesis uses the right auth, model and voice for each provider", async () => {
  calls.length = 0;
  const audio = Buffer.alloc(2000);
  await synthesizeHosted("fish", "fk", "fishvoice123", "[laugh] Hi", respond(audio));
  const h = calls[0].init.headers as Record<string, string>; assert.equal(h.authorization, "Bearer fk"); assert.equal(h.model, "s2-pro");
  assert.equal(JSON.parse(String(calls[0].init.body)).reference_id, "fishvoice123");
  await synthesizeHosted("elevenlabs", "ek", "elevenvoice1", "Hi", respond(audio));
  assert.equal((calls[1].init.headers as Record<string, string>)["xi-api-key"], "ek"); assert.match(calls[1].url, /text-to-speech\/elevenvoice1/);
  assert.equal(JSON.parse(String(calls[1].init.body)).model_id, "eleven_v3");
  await assert.rejects(synthesizeHosted("fish", "k", "fishvoice123", "x", respond(Buffer.alloc(10))), /no audio/);
});

test("clone form requires attestation, a valid sample and a name", () => {
  const sample = new File([new Uint8Array(30000)], "s.mp3", { type: "audio/mpeg" });
  const form = (extra: Record<string, string | File>) => { const f = new FormData(); f.set("provider", "fish"); f.set("name", "Me"); f.set("sample", sample); f.set("attested", "on"); for (const [k, v] of Object.entries(extra)) f.set(k, v); return f; };
  assert.equal(readCloneForm(form({})).input.provider, "fish");
  const without = form({}); without.delete("attested"); assert.throws(() => readCloneForm(without), /right to clone/);
  assert.throws(() => readCloneForm(form({ sample: new File([new Uint8Array(100)], "s.mp3", { type: "audio/mpeg" }) })), /too short/);
  assert.throws(() => readCloneForm(form({ sample: new File([new Uint8Array(30000)], "s.exe", { type: "application/x-msdownload" }) })), /MP3/);
  assert.throws(() => readCloneForm(form({ provider: "local" })), /Fish Audio or ElevenLabs/);
});

test("default voice prefers the Location default among usable providers", () => {
  const v = (id: string, provider: VoiceRow["provider"], isDefault = false): VoiceRow => ({ id, provider, providerVoiceId: id + "xxxxxx", name: id, kind: "preset", language: null, persona: null, isDefault });
  assert.equal(pickDefaultVoice([v("a", "fish"), v("b", "elevenlabs", true)], () => true)?.id, "b");
  assert.equal(pickDefaultVoice([v("a", "fish"), v("b", "elevenlabs", true)], p => p === "fish")?.id, "a");
  assert.equal(pickDefaultVoice([v("a", "fish")], () => false), null);
});

import { designProviderVoice, saveDesignedVoice } from "./clients";
test("voice design returns bounded previews and saving uses the documented fields", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const audio = "QUJD".repeat(40);
  const fetcher = (async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) });
    return Response.json(url.endsWith("/design") ? { previews: [{ generated_voice_id: "gen_abc123", audio_base_64: audio }, { generated_voice_id: "bad id", audio_base_64: audio }] } : { voice_id: "voice_xyz789" }); }) as unknown as typeof fetch;
  const previews = await designProviderVoice("k", "A young woman with a British accent. Warm and upbeat.", fetcher);
  assert.deepEqual(previews.map(p => p.generatedVoiceId), ["gen_abc123"]);
  assert.equal(calls[0].url, "https://api.elevenlabs.io/v1/text-to-voice/design");
  assert.equal(calls[0].body.voice_description, "A young woman with a British accent. Warm and upbeat.");
  assert.equal(await saveDesignedVoice("k", { name: "Host", description: "A young woman with a British accent.", generatedVoiceId: "gen_abc123" }, fetcher), "voice_xyz789");
  assert.deepEqual(calls[1].body, { voice_name: "Host", voice_description: "A young woman with a British accent.", generated_voice_id: "gen_abc123" });
  await assert.rejects(designProviderVoice("k", "too short", fetcher), /20 to 1,000/);
});

test("a recorded WAV that is too short is refused before any provider call, with the provider's own minimum", async () => {
  const { encodeWav16 } = await import("./clone-sample");
  const short = new File([encodeWav16(new Float32Array(24_000 * 5), 24_000)], "r.wav", { type: "audio/wav" });
  await assert.rejects(assertSampleLength("elevenlabs", short), /at least 20 seconds/);
  await assert.rejects(assertSampleLength("fish", short), /at least 15 seconds/);
  const ok = new File([encodeWav16(new Float32Array(24_000 * 40), 24_000)], "r.wav", { type: "audio/wav" });
  await assertSampleLength("fish", ok);
  await assertSampleLength("elevenlabs", new File([new Uint8Array(40000)], "s.mp3", { type: "audio/mpeg" }));   // unknown length is checked in the browser
});
test("clone fields: Fish gets texts/enhance, ElevenLabs gets description/noise removal/labels", async () => {
  const { cloneProviderVoice } = await import("./clients");
  const seen: Array<{ url: string; form: FormData }> = [];
  const fetcher = (async (url: string, init: RequestInit) => { seen.push({ url, form: init.body as FormData }); return new Response(JSON.stringify({ _id: "abcdef1234567890", voice_id: "abcdef1234567890" })); }) as unknown as typeof fetch;
  const sample = new Blob([new Uint8Array(2000)], { type: "audio/wav" });
  await cloneProviderVoice("fish", "k".repeat(24), { name: "N", sample, filename: "r.wav", transcript: "hello there", description: "d", cleanAudio: true }, fetcher);
  assert.equal(seen[0].form.get("texts"), "hello there"); assert.equal(seen[0].form.get("enhance_audio_quality"), "true"); assert.equal(seen[0].form.get("train_mode"), "fast");
  await cloneProviderVoice("elevenlabs", "k".repeat(24), { name: "N", sample, filename: "r.wav", description: "d", cleanAudio: true, language: "en" }, fetcher);
  assert.equal(seen[1].form.get("remove_background_noise"), "true"); assert.equal(seen[1].form.get("description"), "d"); assert.equal(seen[1].form.get("labels"), '{"language":"en"}');
  assert.equal(seen[1].form.get("enhance_audio_quality"), null);
});
test("a provider's own reason reaches the owner, trimmed and bounded", async () => {
  const { cloneProviderVoice } = await import("./clients");
  const fetcher = (async () => new Response(JSON.stringify({ detail: { status: "invalid_audio", message: "The sample is too short to clone a voice from.\u0000" } }), { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(cloneProviderVoice("elevenlabs", "k".repeat(24), { name: "N", sample: new Blob([new Uint8Array(2000)]), filename: "r.wav" }, fetcher), /declined the request \(400\): The sample is too short/);
});

test("voice design: custom preview text replaces auto text; bounds are enforced", async () => {
  const { designProviderVoice } = await import("./clients");
  const bodies: Array<Record<string, unknown>> = [];
  const preview = { generated_voice_id: "gen1234567890", audio_base_64: "A".repeat(200) };
  const fetcher = (async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ previews: [preview] })); }) as unknown as typeof fetch;
  await designProviderVoice("k".repeat(24), "A warm middle-aged woman with a calm, steady delivery.", fetcher);
  assert.equal(bodies[0].auto_generate_text, true); assert.equal(bodies[0].text, undefined);
  await designProviderVoice("k".repeat(24), "A warm middle-aged woman with a calm, steady delivery.", fetcher, "x".repeat(120));
  assert.equal(bodies[1].text, "x".repeat(120)); assert.equal(bodies[1].auto_generate_text, undefined);
  await assert.rejects(designProviderVoice("k".repeat(24), "A warm middle-aged woman with a calm, steady delivery.", fetcher, "too short"), /100 to 1,000/);
});

test("music and sound effects: ElevenLabs request bodies, bounds and errors", async () => {
  calls.length = 0;
  const audio = Buffer.alloc(2000);
  await generateMusicBed("ek", "Calm instrumental bed", 64.2, respond(audio));
  assert.match(calls[0].url, /api\.elevenlabs\.io\/v1\/music\?output_format=mp3_44100_128$/);
  assert.equal((calls[0].init.headers as Record<string, string>)["xi-api-key"], "ek");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { prompt: "Calm instrumental bed", music_length_ms: 64200, force_instrumental: true });
  await generateMusicBed("ek", "Bed", 9999, respond(audio));
  assert.equal(JSON.parse(String(calls[1].init.body)).music_length_ms, 600000);   // the provider's own ceiling
  await generateMusicBed("ek", "Bed", 0, respond(audio));
  assert.equal(JSON.parse(String(calls[2].init.body)).music_length_ms, 3000);
  await generateSoundEffect("ek", "soft whoosh", 1, respond(audio));
  assert.match(calls[3].url, /\/v1\/sound-generation\?output_format=mp3_44100_128$/);
  assert.deepEqual(JSON.parse(String(calls[3].init.body)), { text: "soft whoosh", duration_seconds: 1, prompt_influence: 0.5 });
  await generateSoundEffect("ek", "soft whoosh", 99, respond(audio));
  assert.equal(JSON.parse(String(calls[4].init.body)).duration_seconds, 30);
  await assert.rejects(generateMusicBed("ek", "  ", 30, respond(audio)), /music prompt/);
  await assert.rejects(generateSoundEffect("ek", "x".repeat(500), 1, respond(audio)), /sound description/);
  await assert.rejects(generateMusicBed("ek", "Bed", 30, respond(Buffer.alloc(10))), /no audio/);
  await assert.rejects(generateMusicBed("ek", "Bed", 30, respond({ detail: { message: "plan limit reached" } }, 422)), /plan limit reached/);
  await assert.rejects(generateSoundEffect("bad", "whoosh", 1, respond({}, 401)), /rejected this key/);
});
