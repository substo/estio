import assert from "node:assert/strict";
import { test } from "node:test";
import { cloneProviderVoice, deleteProviderVoice, listProviderVoices, synthesizeHosted, verifyVoiceKey, VoiceProviderError } from "./clients";
import { pickDefaultVoice, readCloneForm, readVoiceKey, type VoiceRow } from "./policy";

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
  assert.deepEqual(fish, [{ providerVoiceId: "abcdef123456", name: "Mine", language: "en", kind: "clone" }]);
  const eleven = await listProviderVoices("elevenlabs", "k", respond({ voices: [{ voice_id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", category: "premade" }, { voice_id: "cloneVoice123", name: "Me", category: "cloned" }] }));
  assert.deepEqual(eleven.map(v => [v.name, v.kind]), [["Rachel", "preset"], ["Me", "clone"]]);
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
