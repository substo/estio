import assert from "node:assert/strict";
import test from "node:test";
import { IMAGE_MODELS, IMAGE_PLATFORMS, IMAGE_PLATFORM_IDS, UNSUPPORTED_IMAGE_MODELS, endpointFor, imageModel, readImageChoice, runnableEndpoints } from "./catalog";
import { DEFAULT_NEGATIVE, SAMPLE_SHOT, renderShot, stripFiller } from "./prompts";

test("every model runs on at least one platform that exists, ids are unique, and shared platforms are named", () => {
  const ids = new Set<string>();
  for (const m of IMAGE_MODELS) {
    assert.ok(!ids.has(m.id), `duplicate ${m.id}`); ids.add(m.id);
    assert.ok(m.endpoints.length > 0, m.id);
    for (const e of m.endpoints) { assert.ok(IMAGE_PLATFORM_IDS.includes(e.platform), `${m.id}: ${e.platform}`); assert.ok(e.endpoint.length > 2); }
    assert.equal(new Set(m.endpoints.map(e => e.platform)).size, m.endpoints.length, `${m.id} lists a platform twice`);
  }
  for (const p of IMAGE_PLATFORM_IDS) assert.ok(IMAGE_PLATFORMS[p].keyUrl.startsWith("https://"), p);
  assert.equal(UNSUPPORTED_IMAGE_MODELS[0].id, "midjourney");
});

test("the same model is offered on every platform that hosts it, and only where a key exists", () => {
  const kontext = imageModel("flux-kontext-max")!;
  assert.deepEqual(kontext.endpoints.map(e => e.platform).sort(), ["bfl", "fal", "replicate"]);
  assert.deepEqual(runnableEndpoints(kontext, { fal: true }).map(e => e.platform), ["fal"]);
  assert.deepEqual(runnableEndpoints(kontext, {}), []);
});

test("a saved choice is validated: unknown model, a platform that does not host it, or a bad endpoint id is dropped", () => {
  assert.deepEqual(readImageChoice({ model: "flux-kontext-max", platform: "fal" }), { model: "flux-kontext-max", platform: "fal" });
  assert.equal(readImageChoice({ model: "flux-kontext-max", platform: "google" }), null);
  assert.equal(readImageChoice({ model: "nope", platform: "fal" }), null);
  assert.equal(readImageChoice({ model: "gpt-image", platform: "openai", endpoint: "gpt-image-2; drop table" })!.endpoint, undefined);
  assert.equal(readImageChoice("x"), null);
  // Discovered ids (OpenAI, Google) use the owner's pick; fixed ids ignore it.
  assert.equal(endpointFor({ model: "gpt-image", platform: "openai", endpoint: "gpt-image-2.5" }), "gpt-image-2.5");
  assert.equal(endpointFor({ model: "flux-kontext-max", platform: "fal", endpoint: "evil" }), "fal-ai/flux-pro/kontext/max");
});

test("filler quality words are removed and reported", () => {
  const r = stripFiller("a beautiful, stunning masterpiece of a man, 8k, ultra detailed, standing");
  assert.equal(r.text, "a of a man, standing");
  assert.ok(r.removed.includes("masterpiece") && r.removed.includes("8k"));
  const shot = renderShot({ ...SAMPLE_SHOT, texture: "masterpiece, 8k, visible fabric weave" }, "natural");
  assert.ok(!/masterpiece|8k/i.test(shot.prompt));
  assert.ok(shot.notes.some(n => /Removed filler words from texture/.test(n)));
});

test("natural dialect: one shot, ordered the way the research found works, with the locked character and continuity", () => {
  const { prompt } = renderShot(SAMPLE_SHOT, "natural");
  assert.match(prompt, /^Medium shot, eye-level of the man in the reference photo, short dark hair, grey hoodie, already mid-stride/);
  const order = ["Medium shot", "a small podcast studio", "soft window light", "Shot on 35mm", "visible fabric weave", "Continuity: same grey hoodie"].map(s => prompt.toLowerCase().indexOf(s.toLowerCase()));
  assert.ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), `order ${order}`);
  assert.match(prompt, /Frame contains no extra people, no text\./);
  assert.ok(prompt.split(/\s+/).length < 100);
});

test("edit dialect names the person by description, says what to keep, and matches the previous frame", () => {
  const { prompt } = renderShot(SAMPLE_SHOT, "edit");
  assert.match(prompt, /^Show the man in the reference photo, short dark hair, grey hoodie already mid-stride/);
  assert.match(prompt, /Keep the man in the reference photo, short dark hair, grey hoodie's face, hairstyle and clothing exactly the same as in the reference image\./);
  assert.match(prompt, /Match the previous frame: same grey hoodie/);
  assert.doesNotMatch(prompt, /\b(she|he|her|his)\b/i);
  assert.match(renderShot({ ...SAMPLE_SHOT, character: undefined }, "edit").prompt, /the person in the reference image/);
});

test("tags dialect puts the subject first with a weight and a real negative prompt", () => {
  const r = renderShot(SAMPLE_SHOT, "tags");
  assert.match(r.prompt, /^\(the man in the reference photo, short dark hair, grey hoodie, already mid-stride/);
  assert.ok(r.negative!.startsWith(DEFAULT_NEGATIVE) && /extra people/.test(r.negative!));
});

test("text goes first for Ideogram, and is left out (with a note) for models that cannot draw it", () => {
  const shot = { ...SAMPLE_SHOT, text: [{ quote: "OPEN LATE", placement: "in neon above the door" }] };
  assert.match(renderShot(shot, "ideogram").prompt, /^The exact text "OPEN LATE" in neon above the door\./);
  const none = renderShot(shot, "tags", { acceptsText: false });
  assert.ok(!/OPEN LATE/.test(none.prompt) && none.notes.some(n => /does not draw text/.test(n)));
});

test("an over-long natural prompt is flagged, not silently trimmed", () => {
  const r = renderShot({ ...SAMPLE_SHOT, texture: Array.from({ length: 150 }, (_, i) => `detail${i}`).join(" ") }, "natural");
  assert.ok(r.notes.some(n => /words/.test(n)));
});
