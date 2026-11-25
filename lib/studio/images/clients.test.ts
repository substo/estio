import assert from "node:assert/strict";
import test from "node:test";
import { imageModel } from "./catalog";
import { ImageError, generateImage, listImageModels, testReferencePng, verifyImageKey } from "./clients";

const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const png = (extra = "") => Buffer.concat([PNG, Buffer.from(extra)]);
type Call = { url: string; init: RequestInit };
const mock = (responder: (url: string, init: RequestInit) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => { const url = String(input); calls.push({ url, init }); return responder(url, init); }) as typeof fetch;
  return { calls, fetcher };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const image = (bytes = png()) => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/png" } });
const ref = { data: Buffer.from("ref"), mime: "image/png" };
const body = (c: Call) => JSON.parse(String(c.init.body));
const base = { prompt: "Medium shot of a person", aspect: "16:9" };

test("fal: Kontext takes aspect_ratio and one image_url; the key goes in the Key header; the picture is fetched from fal's own host", async () => {
  const { calls, fetcher } = mock(url => url.startsWith("https://fal.run/") ? json({ images: [{ url: "https://v3.fal.media/files/a.png" }] }) : image());
  const out = await generateImage("falkey:1234567890abcdef12", { ...base, platform: "fal", endpoint: "fal-ai/flux-pro/kontext/max", model: imageModel("flux-kontext-max")!, references: [ref] }, fetcher);
  assert.equal(out.contentType, "image/png"); assert.ok(out.bytes.length > 0);
  assert.equal(calls[0].url, "https://fal.run/fal-ai/flux-pro/kontext/max");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Key falkey:1234567890abcdef12");
  const b = body(calls[0]); assert.equal(b.aspect_ratio, "16:9"); assert.match(b.image_url, /^data:image\/png;base64,/); assert.equal(b.image_urls, undefined);
});

test("fal: FLUX.2 edit takes image_urls and a named size; an edit-only model without a reference is refused before any request", async () => {
  const { calls, fetcher } = mock(() => json({ images: [{ url: "data:image/png;base64,iVBORw0KGgo=" }] }));
  await generateImage("k".repeat(20), { ...base, platform: "fal", endpoint: "fal-ai/flux-2-max/edit", model: imageModel("flux-2-max")!, references: [ref, ref] }, fetcher);
  const b = body(calls[0]); assert.equal(b.image_size, "landscape_16_9"); assert.equal(b.image_urls.length, 2);
  await assert.rejects(generateImage("k".repeat(20), { ...base, platform: "fal", endpoint: "fal-ai/flux-pro/kontext", model: imageModel("flux-kontext-pro")! }, fetcher), (e: ImageError) => e.code === "rejected" && /reference/.test(e.message));
  assert.equal(calls.length, 1);
});

test("a model is never given more references than it takes, and links to unexpected hosts are not followed", async () => {
  const { fetcher } = mock(() => json({ images: [{ url: "https://evil.example/x.png" }] }));
  await assert.rejects(generateImage("k".repeat(20), { ...base, platform: "fal", endpoint: "fal-ai/flux-pro/kontext", model: imageModel("flux-kontext-pro")!, references: [ref, ref] }, fetcher), /at most 1 reference/);
  await assert.rejects(generateImage("k".repeat(20), { ...base, platform: "fal", endpoint: "fal-ai/flux-pro/kontext", model: imageModel("flux-kontext-pro")!, references: [ref] }, fetcher), (e: ImageError) => e.code === "no_image" && /unexpected host/.test(e.message));
});

test("Google: key in the x-goog-api-key header, references as inline data, the aspect ratio in imageConfig, the picture read from inline data", async () => {
  const { calls, fetcher } = mock(() => json({ candidates: [{ content: { parts: [{ text: "ok" }, { inlineData: { mimeType: "image/png", data: png().toString("base64") } }] } }] }));
  const out = await generateImage("AIza" + "x".repeat(30), { ...base, platform: "google", endpoint: "gemini-3.1-flash-image", model: imageModel("gemini-image")!, references: [ref] }, fetcher);
  assert.equal(out.contentType, "image/png");
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent");
  assert.ok((calls[0].init.headers as Record<string, string>)["x-goog-api-key"].startsWith("AIza"));
  const b = body(calls[0]); assert.equal(b.generationConfig.imageConfig.aspectRatio, "16:9"); assert.equal(b.contents[0].parts[1].inline_data.mime_type, "image/png");
});

test("OpenAI: plain generations without references, multipart edits with input_fidelity high when there are some", async () => {
  const { calls, fetcher } = mock(() => json({ data: [{ b64_json: png().toString("base64") }] }));
  await generateImage("sk-" + "a".repeat(30), { ...base, platform: "openai", endpoint: "gpt-image-2.5", model: imageModel("gpt-image")! }, fetcher);
  assert.equal(calls[0].url, "https://api.openai.com/v1/images/generations"); assert.equal(body(calls[0]).size, "1536x1024"); assert.equal(body(calls[0]).model, "gpt-image-2.5");
  await generateImage("sk-" + "a".repeat(30), { ...base, platform: "openai", endpoint: "gpt-image-2.5", model: imageModel("gpt-image")!, references: [ref] }, fetcher);
  assert.equal(calls[1].url, "https://api.openai.com/v1/images/edits");
  const form = calls[1].init.body as FormData; assert.equal(form.get("input_fidelity"), "high"); assert.equal(form.getAll("image[]").length, 1);
});

test("Replicate: model path, wait header, the reference as input_image, the result from replicate's own host", async () => {
  const { calls, fetcher } = mock(url => url.includes("/predictions") ? json({ status: "succeeded", output: ["https://replicate.delivery/x/out.png"] }) : image());
  await generateImage("r8_" + "a".repeat(30), { ...base, platform: "replicate", endpoint: "black-forest-labs/flux-kontext-max", model: imageModel("flux-kontext-max")!, references: [ref] }, fetcher);
  assert.equal(calls[0].url, "https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-max/predictions");
  assert.match((calls[0].init.headers as Record<string, string>).prefer, /wait/); assert.match(body(calls[0]).input.input_image, /^data:image\/png/);
});

test("BFL: x-key header, base64 reference, polls the result link until Ready, only on bfl hosts", async () => {
  let polls = 0;
  const { calls, fetcher } = mock(url => url === "https://api.bfl.ai/v1/flux-kontext-max" ? json({ polling_url: "https://api.eu1.bfl.ai/v1/get_result?id=1" }) : url.includes("get_result") ? json(++polls < 2 ? { status: "Pending" } : { status: "Ready", result: { sample: "https://delivery-eu1.bfl.ai/out.png" } }) : image());
  await generateImage("bfl-" + "a".repeat(30), { ...base, platform: "bfl", endpoint: "flux-kontext-max", model: imageModel("flux-kontext-max")!, references: [ref] }, fetcher);
  assert.equal((calls[0].init.headers as Record<string, string>)["x-key"].startsWith("bfl-"), true); assert.equal(body(calls[0]).input_image, Buffer.from("ref").toString("base64"));
  assert.ok(polls >= 2);
});

test("Ideogram: Api-Key header, 16x9 spelling, character references; Stability: Bearer, image/* accepted, image-to-image with a reference", async () => {
  const a = mock(url => url.includes("ideogram.ai/v1") ? json({ data: [{ url: "https://ideogram.ai/api/images/x.png" }] }) : image());
  await generateImage("i".repeat(30), { ...base, platform: "ideogram", endpoint: "ideogram-v3/generate", model: imageModel("ideogram-v3")!, references: [ref], negative: "blurry" }, a.fetcher);
  const f = a.calls[0].init.body as FormData; assert.equal(f.get("aspect_ratio"), "16x9"); assert.equal(f.getAll("character_reference_images").length, 1); assert.equal((a.calls[0].init.headers as Record<string, string>)["Api-Key"], "i".repeat(30));
  const b = mock(() => image());
  await generateImage("s".repeat(30), { ...base, platform: "stability", endpoint: "stable-image/generate/sd3", model: imageModel("sd-3-5")!, references: [ref], negative: "blurry" }, b.fetcher);
  const g = b.calls[0].init.body as FormData; assert.equal(g.get("mode"), "image-to-image"); assert.equal(g.get("negative_prompt"), "blurry"); assert.equal((b.calls[0].init.headers as Record<string, string>).accept, "image/*");
});

test("errors are classified, give the platform's reason, and never contain the key", async () => {
  const key = "sk-secretsecretsecretsecret1234";
  const rejected = (status: number, message: string) => mock(() => json({ error: { message } }, status)).fetcher;
  const req = { ...base, platform: "openai" as const, endpoint: "gpt-image-2.5", model: imageModel("gpt-image")! };
  await assert.rejects(generateImage(key, req, rejected(401, `Incorrect API key provided: ${key}`)), (e: ImageError) => e.code === "invalid_key" && !e.message.includes(key));
  await assert.rejects(generateImage(key, req, rejected(402, "Billing hard limit has been reached")), (e: ImageError) => e.code === "rejected" && /Billing/.test(e.message));
  await assert.rejects(generateImage(key, req, rejected(503, "x")), (e: ImageError) => e.code === "unavailable");
  await assert.rejects(generateImage(key, req, (async () => { throw new Error("offline"); }) as unknown as typeof fetch), (e: ImageError) => e.code === "unavailable");
});

test("key checks: a bad key is invalid, a 400 from an empty request means the key was accepted, a 5xx is unavailable", async () => {
  assert.equal(await verifyImageKey("openai", "k", mock(() => json({}, 401)).fetcher), "invalid");
  assert.equal(await verifyImageKey("openai", "k", mock(() => json({ data: [] })).fetcher), "valid");
  assert.equal(await verifyImageKey("ideogram", "k", mock(() => json({ error: "prompt required" }, 400)).fetcher), "valid");
  assert.equal(await verifyImageKey("fal", "k", mock(() => json({}, 422)).fetcher), "valid");
  assert.equal(await verifyImageKey("bfl", "k", mock(() => json({}, 503)).fetcher), "unavailable");
});

test("model discovery keeps only image generators, newest first", async () => {
  assert.deepEqual(await listImageModels("openai", "k", mock(() => json({ data: [{ id: "gpt-4o" }, { id: "gpt-image-1" }, { id: "gpt-image-2.5" }] })).fetcher), ["gpt-image-2.5", "gpt-image-1"]);
  assert.deepEqual(await listImageModels("google", "k", mock(() => json({ models: [{ name: "models/gemini-2.5-pro" }, { name: "models/gemini-3.1-flash-image" }, { name: "models/gemini-2.5-flash-image" }] })).fetcher), ["gemini-3.1-flash-image", "gemini-2.5-flash-image"]);
  assert.deepEqual(await listImageModels("openai", "k", mock(() => json({}, 500)).fetcher), []);
});

test("the test reference is a valid 128x128 PNG", () => {
  const p = testReferencePng();
  assert.deepEqual([...p.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(p.readUInt32BE(16), 128); assert.equal(p.readUInt32BE(20), 128);
  assert.equal(p.subarray(p.length - 8, p.length - 4).toString("hex"), "49454e44");
});
