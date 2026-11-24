import assert from "node:assert/strict";
import { test } from "node:test";
import { FAL_MODELS, FalError, generateFalSound, readFalKey, verifyFalKey } from "./fal-client";
import { generateHostedSound, soundErrorMessage, SOUND_PROMPTS } from "./sound-render";
import { SOUND_PROVIDERS, hostedOptions, pickHostedSound, readSoundProviderChoices, soundProvider, soundSourceLabel } from "./sound-providers";
import { catalogModel, recommendedModels } from "../local-models";

const mp3 = Buffer.alloc(4000, 7);
const dataUri = `data:audio/mpeg;base64,${mp3.toString("base64")}`;
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("the registry lists every option once, with a price, and local models point at catalog entries", () => {
  assert.equal(new Set(SOUND_PROVIDERS.map(p => p.id)).size, SOUND_PROVIDERS.length);
  for (const p of SOUND_PROVIDERS) { assert.ok(p.price && p.freeTier && p.licence, p.id); assert.ok(p.kinds.length > 0); }
  const local = soundProvider("stable-audio-3-small")!;
  assert.equal(local.needs, "model");
  assert.ok(catalogModel(local.modelIds!.music) && catalogModel(local.modelIds!.effects));
  assert.deepEqual(hostedOptions("music").map(p => p.id), ["fal", "elevenlabs"]);
});
test("the gated models are never recommended and carry the terms the person must accept", () => {
  const model = catalogModel("stable-audio-3-small-music")!;
  assert.ok(model.terms && model.terms.length === 2 && model.terms.every(t => t.url.startsWith("https://")));
  assert.deepEqual(recommendedModels({ memoryGb: 16, freeDiskGb: 100 }, ["music", "effects"]), []);
});
test("a stored provider choice is read strictly, and a missing key falls through to the next provider with one", () => {
  assert.deepEqual(readSoundProviderChoices({ music: "fal", effects: "elevenlabs", junk: "x" }), { music: "fal", effects: "elevenlabs" });
  assert.deepEqual(readSoundProviderChoices({ music: "synth", effects: 5 }), {});
  assert.deepEqual(readSoundProviderChoices(null), {});
  assert.equal(pickHostedSound("elevenlabs", { fal: true, elevenlabs: true }), "elevenlabs");
  assert.equal(pickHostedSound("elevenlabs", { fal: true, elevenlabs: false }), "fal");
  assert.equal(pickHostedSound(undefined, { fal: false, elevenlabs: true }), "elevenlabs");
  assert.equal(pickHostedSound("fal", { fal: false, elevenlabs: false }), null);
});
test("the dialog line says what makes each kind", () => {
  assert.equal(soundSourceLabel("music", "local", null, false), "Music: made on this Mac with the built-in synth");
  assert.equal(soundSourceLabel("effects", "local", null, true), "Sound effects: made on this Mac with Stable Audio 3 Small");
  assert.match(soundSourceLabel("music", "hosted", "fal", false), /fal\.ai/);
  assert.match(soundSourceLabel("music", "hosted", null, false), /add a fal\.ai or ElevenLabs key/);
});
test("fal key shape is checked before anything is sent", () => {
  assert.equal(readFalKey("  3f1e2d4c-aaaa-bbbb-cccc-1234567890ab:0123456789abcdef0123456789abcdef  "), "3f1e2d4c-aaaa-bbbb-cccc-1234567890ab:0123456789abcdef0123456789abcdef");
  assert.throws(() => readFalKey("short"));
  assert.throws(() => readFalKey("has spaces in it which is not a key at all"));
});
test("a fal request names the right model, authorises with Key, and asks for inline mp3", async () => {
  let seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null;
  const fetcher = (async (url: string, init: RequestInit) => { seen = { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) }; return ok({ audio: { url: dataUri } }); }) as unknown as typeof fetch;
  const bytes = await generateFalSound("id:secretsecretsecretsecret", "music", "calm piano", 66.04, fetcher);
  assert.equal(bytes.length, 4000);
  assert.equal(seen!.url, `https://fal.run/${FAL_MODELS.music}`);
  assert.equal(seen!.headers.authorization, "Key id:secretsecretsecretsecret");
  assert.deepEqual(seen!.body, { prompt: "calm piano", duration: 66, output_format: "mp3", sync_mode: true, enable_safety_checker: true });
  await generateFalSound("id:secretsecretsecretsecret", "effects", "soft whoosh", 1, fetcher);
  assert.equal(seen!.url, `https://fal.run/${FAL_MODELS.effects}`);
});
test("fal durations are clamped to the model's 1 to 120 seconds", async () => {
  const bodies: number[] = [];
  const fetcher = (async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body)).duration); return ok({ audio: { url: dataUri } }); }) as unknown as typeof fetch;
  await generateFalSound("id:secretsecretsecretsecret", "music", "calm piano", 600, fetcher);
  await generateFalSound("id:secretsecretsecretsecret", "effects", "soft whoosh", 0.2, fetcher);
  assert.deepEqual(bodies, [120, 1]);
});
test("a link answer is followed only on fal's own https hosts", async () => {
  const file = (async (url: string) => url.startsWith("https://v3.fal.media/") ? new Response(mp3) : ok({ audio: { url: "https://v3.fal.media/files/a.mp3" } })) as unknown as typeof fetch;
  assert.equal((await generateFalSound("id:secretsecretsecretsecret", "effects", "soft whoosh", 1, file)).length, 4000);
  for (const bad of ["http://v3.fal.media/a.mp3", "https://evil.example/a.mp3", "https://fal.media.evil.example/a.mp3", "file:///etc/passwd"]) {
    const f = (async () => ok({ audio: { url: bad } })) as unknown as typeof fetch;
    await assert.rejects(generateFalSound("id:secretsecretsecretsecret", "effects", "soft whoosh", 1, f), FalError);
  }
});
test("fal's own reason reaches the page, with keys redacted", async () => {
  const f = (async () => ok({ detail: "User is locked. Reason: Exhausted balance. Key 3f1e2d4c-aaaa-bbbb:0123456789abcdef0123456789abcdef" }, 403)) as unknown as typeof fetch;
  await assert.rejects(generateFalSound("id:secretsecretsecretsecret", "music", "calm piano", 30, f), (e: Error) => /declined the request \(403\): User is locked\. Reason: Exhausted balance\./.test(e.message) && !/0123456789abcdef/.test(e.message));
  const bad = (async () => ok({ detail: "invalid key credentials" }, 401)) as unknown as typeof fetch;
  await assert.rejects(generateFalSound("x:y", "music", "calm piano", 30, bad), (e: FalError) => e.code === "invalid_key");
  assert.match(soundErrorMessage(new FalError("rejected", "fal.ai declined the request (402).")) ?? "", /402/);
  assert.equal(soundErrorMessage(new Error("boom")), null);
});
test("a key is checked with a request that costs nothing: unauthorised means invalid, a validation error means valid", async () => {
  const status = (n: number) => (async () => new Response("{}", { status: n })) as unknown as typeof fetch;
  assert.equal(await verifyFalKey("id:secretsecretsecretsecret", status(401)), "invalid");
  assert.equal(await verifyFalKey("id:secretsecretsecretsecret", status(422)), "valid");
  assert.equal(await verifyFalKey("id:secretsecretsecretsecret", status(503)), "unavailable");
  assert.equal(await verifyFalKey("id:secretsecretsecretsecret", (async () => { throw new Error("offline"); }) as unknown as typeof fetch), "unavailable");
});
test("hosted dispatch: fal for fal, ElevenLabs music and sound-generation for ElevenLabs", async () => {
  const urls: string[] = [];
  const fetcher = (async (url: string) => { urls.push(url); return url.includes("fal.run") ? ok({ audio: { url: dataUri } }) : new Response(mp3); }) as unknown as typeof fetch;
  await generateHostedSound("fal", "music", "id:secretsecretsecretsecret", 60, fetcher);
  await generateHostedSound("elevenlabs", "music", "eleven-key", 60, fetcher);
  await generateHostedSound("elevenlabs", "effects", "eleven-key", 60, fetcher);
  assert.match(urls[0], /fal\.run\/fal-ai\/stable-audio-3\/small\/music/);
  assert.match(urls[1], /api\.elevenlabs\.io\/v1\/music/);
  assert.match(urls[2], /api\.elevenlabs\.io\/v1\/sound-generation/);
  assert.ok(SOUND_PROMPTS.music.length > 20 && SOUND_PROMPTS.effects.length > 10);
});
