import { deflateSync } from "node:zlib";
import type { ImageModel, ImagePlatformId } from "./catalog";

type Fetch = typeof fetch;
export interface Reference { data: Buffer; mime: string }
export interface ImageRequest { platform: ImagePlatformId; endpoint: string; model: ImageModel; prompt: string; negative?: string; aspect: string; references?: Reference[] }
export interface ImageResult { bytes: Buffer; contentType: string }
export class ImageError extends Error {
  constructor(readonly code: "invalid_key" | "unavailable" | "rejected" | "no_image", message: string) { super(message); }
}

const MAX_BYTES = 12 * 1024 * 1024;
/** Only these hosts are followed when a platform answers with a link (never an arbitrary URL). */
const RESULT_HOSTS: Record<string, RegExp> = {
  fal: /(^|\.)fal\.(media|run|ai)$/i, replicate: /(^|\.)replicate\.(delivery|com)$/i, bfl: /(^|\.)bfl\.(ai|ml)$/i, ideogram: /(^|\.)ideogram\.ai$/i,
};
const secret = (text: string) => text.replace(/[\u0000-\u001f]/g, " ").replace(/\b[A-Za-z0-9_-]{8,}:[A-Za-z0-9]{16,}\b/g, "[key]").replace(/\b(sk|key|r8|bfl|AIza)[-_A-Za-z0-9]{12,}\b/g, "[key]").trim().slice(0, 260);

/** The platform's own reason in plain text, bounded and with anything key-shaped removed: what the owner needs to see ("balance exhausted", "content refused"). */
async function reason(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const err = body.error ?? body.detail ?? body.message ?? body.errors;
    const flat = typeof err === "string" ? err : Array.isArray(err) ? err.map(e => typeof e === "string" ? e : String((e as Record<string, unknown>)?.msg ?? (e as Record<string, unknown>)?.message ?? "")).join("; ") : err && typeof err === "object" ? String((err as Record<string, unknown>).message ?? "") : "";
    if (flat) return secret(flat);
  } catch { /* not JSON */ }
  return secret(text);
}
async function fail(response: Response): Promise<never> {
  const why = await reason(response);
  if (response.status === 401 || response.status === 403) throw new ImageError("invalid_key", `The platform refused this key${why ? `: ${why}` : "."}`);
  if (response.status >= 500) throw new ImageError("unavailable", "The platform is not available right now. Try again shortly.");
  throw new ImageError("rejected", why || `The platform refused the request (${response.status}).`);
}
const timeout = (signal?: AbortSignal) => signal ?? AbortSignal.timeout(120_000);

async function download(platform: string, url: string, fetcher: Fetch, signal?: AbortSignal): Promise<ImageResult> {
  let target: URL;
  try { target = new URL(url); } catch { throw new ImageError("no_image", "The platform returned an unusable link."); }
  if (target.protocol !== "https:" || !(RESULT_HOSTS[platform] ?? /^$/).test(target.hostname)) throw new ImageError("no_image", "The platform returned a link to an unexpected host, so it was not followed.");
  const r = await fetcher(target, { signal: timeout(signal), cache: "no-store" });
  if (!r.ok) return fail(r);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new ImageError("no_image", "The picture came back empty or too large.");
  return { bytes, contentType: r.headers.get("content-type")?.split(";")[0] || "image/png" };
}
const fromBase64 = (b64: unknown, mime = "image/png"): ImageResult => {
  if (typeof b64 !== "string" || !b64) throw new ImageError("no_image", "The platform answered without a picture.");
  const bytes = Buffer.from(b64, "base64");
  if (!bytes.length || bytes.length > MAX_BYTES) throw new ImageError("no_image", "The picture came back empty or too large.");
  return { bytes, contentType: mime };
};
const dataUri = (ref: Reference) => `data:${ref.mime};base64,${ref.data.toString("base64")}`;

// Aspect ratio in each platform's own spelling.
const FAL_SIZE: Record<string, string> = { "16:9": "landscape_16_9", "9:16": "portrait_16_9", "1:1": "square_hd", "4:3": "landscape_4_3", "3:4": "portrait_4_3" };
const OPENAI_SIZE: Record<string, string> = { "16:9": "1536x1024", "9:16": "1024x1536", "1:1": "1024x1024" };

// ---- fal.ai: one synchronous endpoint per model ------------------------------------------------------------------------------------
async function fal(key: string, r: ImageRequest, fetcher: Fetch, signal?: AbortSignal): Promise<ImageResult> {
  const refs = r.references ?? [];
  const body: Record<string, unknown> = { prompt: r.prompt, num_images: 1, output_format: "png" };
  const kontext = r.endpoint.includes("/kontext"), edit = r.endpoint.endsWith("/edit") || r.endpoint.includes("qwen-image-edit");
  // Kontext and Gemini-style models take an aspect_ratio; the rest take fal's named sizes.
  if (kontext) body.aspect_ratio = r.aspect; else if (FAL_SIZE[r.aspect]) body.image_size = FAL_SIZE[r.aspect];
  if (r.negative && r.model.negative) body.negative_prompt = r.negative;
  if (refs.length) { if (r.endpoint.endsWith("/edit") && r.endpoint.includes("flux-2")) body.image_urls = refs.map(dataUri); else body.image_url = dataUri(refs[0]); }
  else if (kontext || edit) throw new ImageError("rejected", "This model edits a reference photo: add one.");
  const response = await fetcher(`https://fal.run/${r.endpoint}`, { method: "POST", headers: { authorization: `Key ${key}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: timeout(signal), cache: "no-store" });
  if (!response.ok) return fail(response);
  const json = await response.json().catch(() => null) as { images?: Array<{ url?: string; content_type?: string }> } | null;
  const url = json?.images?.[0]?.url;
  if (!url) throw new ImageError("no_image", "fal.ai answered without a picture.");
  if (url.startsWith("data:")) { const m = /^data:([^;]+);base64,(.*)$/.exec(url); return fromBase64(m?.[2], m?.[1]); }
  return download("fal", url, fetcher, signal);
}

// ---- Google (Gemini image): inline base64 both ways --------------------------------------------------------------------------------
async function google(key: string, r: ImageRequest, fetcher: Fetch, signal?: AbortSignal): Promise<ImageResult> {
  const parts: unknown[] = [{ text: r.prompt }, ...(r.references ?? []).map(ref => ({ inline_data: { mime_type: ref.mime, data: ref.data.toString("base64") } }))];
  const body = { contents: [{ parts }], generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: r.aspect } } };
  const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(r.endpoint)}:generateContent`, { method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body), signal: timeout(signal), cache: "no-store" });
  if (!response.ok) return fail(response);
  const json = await response.json().catch(() => null) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }> } }> } | null;
  const part = json?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data || p.inline_data?.data);
  const inline = part?.inlineData ?? (part?.inline_data ? { data: part.inline_data.data, mimeType: part.inline_data.mime_type } : undefined);
  return fromBase64(inline?.data, inline?.mimeType);
}

// ---- OpenAI: generations without references, edits (multipart) with them -----------------------------------------------------------
async function openai(key: string, r: ImageRequest, fetcher: Fetch, signal?: AbortSignal): Promise<ImageResult> {
  const size = OPENAI_SIZE[r.aspect] ?? "1024x1024", refs = r.references ?? [];
  let response: Response;
  if (refs.length) {
    const form = new FormData();
    form.set("model", r.endpoint); form.set("prompt", r.prompt); form.set("size", size); form.set("input_fidelity", "high");
    refs.forEach((ref, i) => form.append("image[]", new Blob([new Uint8Array(ref.data)], { type: ref.mime }), `reference-${i}.${ref.mime.split("/")[1] ?? "png"}`));
    response = await fetcher("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form, signal: timeout(signal), cache: "no-store" });
  } else {
    response = await fetcher("https://api.openai.com/v1/images/generations", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: r.endpoint, prompt: r.prompt, size, n: 1 }), signal: timeout(signal), cache: "no-store" });
  }
  if (!response.ok) return fail(response);
  const json = await response.json().catch(() => null) as { data?: Array<{ b64_json?: string; url?: string }> } | null;
  return fromBase64(json?.data?.[0]?.b64_json);
}

// ---- Replicate: one prediction, answered when ready --------------------------------------------------------------------------------
async function replicate(key: string, r: ImageRequest, fetcher: Fetch, signal?: AbortSignal): Promise<ImageResult> {
  const refs = r.references ?? [];
  const input: Record<string, unknown> = { prompt: r.prompt, aspect_ratio: r.aspect, output_format: "png" };
  if (refs.length) { input.input_image = dataUri(refs[0]); input.image = dataUri(refs[0]); }
  if (r.negative && r.model.negative) input.negative_prompt = r.negative;
  const response = await fetcher(`https://api.replicate.com/v1/models/${r.endpoint}/predictions`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "wait=60" }, body: JSON.stringify({ input }), signal: timeout(signal), cache: "no-store" });
  if (!response.ok) return fail(response);
  const json = await response.json().catch(() => null) as { status?: string; output?: string | string[]; error?: string } | null;
  if (json?.status === "failed") throw new ImageError("rejected", secret(json.error ?? "The prediction failed."));
  const out = Array.isArray(json?.output) ? json?.output[0] : json?.output;
  if (!out) throw new ImageError("rejected", "The picture was not ready within a minute. Try again.");
  return download("replicate", out, fetcher, signal);
}

// ---- Black Forest Labs: submit, then poll the result link ---------------------------------------------------------------------------
async function bfl(key: string, r: ImageRequest, fetcher: Fetch, signal?: AbortSignal): Promise<ImageResult> {
  const refs = r.references ?? [];
  const body: Record<string, unknown> = { prompt: r.prompt, aspect_ratio: r.aspect, output_format: "png" };
  refs.slice(0, 8).forEach((ref, i) => { body[i === 0 ? "input_image" : `input_image_${i + 1}`] = ref.data.toString("base64"); });
  const submit = await fetcher(`https://api.bfl.ai/v1/${r.endpoint}`, { method: "POST", headers: { "x-key": key, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), signal: timeout(signal), cache: "no-store" });
  if (!submit.ok) return fail(submit);
  const queued = await submit.json().catch(() => null) as { polling_url?: string } | null;
  const poll = queued?.polling_url;
  if (!poll) throw new ImageError("no_image", "Black Forest Labs did not return a result link.");
  for (let i = 0; i < 60; i++) {
    const host = new URL(poll).hostname;
    if (!RESULT_HOSTS.bfl.test(host)) throw new ImageError("no_image", "The result link was for an unexpected host, so it was not followed.");
    const status = await fetcher(poll, { headers: { "x-key": key, accept: "application/json" }, signal: timeout(signal), cache: "no-store" });
    if (!status.ok) return fail(status);
    const json = await status.json().catch(() => null) as { status?: string; result?: { sample?: string } } | null;
    if (json?.status === "Ready" && json.result?.sample) return download("bfl", json.result.sample, fetcher, signal);
    if (json?.status && /error|failed|moderated/i.test(json.status)) throw new ImageError("rejected", `Black Forest Labs: ${secret(json.status)}.`);
    await new Promise(res => setTimeout(res, 1500));
  }
  throw new ImageError("unavailable", "The picture was not ready in time. Try again.");
}

// ---- Ideogram: multipart, answered with a link --------------------------------------------------------------------------------------
async function ideogram(key: string, r: ImageRequest, fetcher: Fetch, signal?: AbortSignal): Promise<ImageResult> {
  const form = new FormData();
  form.set("prompt", r.prompt); form.set("aspect_ratio", r.aspect.replace(":", "x")); form.set("rendering_speed", "DEFAULT"); form.set("num_images", "1");
  if (r.negative && r.model.negative) form.set("negative_prompt", r.negative);
  (r.references ?? []).slice(0, 3).forEach((ref, i) => form.append("character_reference_images", new Blob([new Uint8Array(ref.data)], { type: ref.mime }), `reference-${i}.png`));
  const response = await fetcher(`https://api.ideogram.ai/v1/${r.endpoint}`, { method: "POST", headers: { "Api-Key": key }, body: form, signal: timeout(signal), cache: "no-store" });
  if (!response.ok) return fail(response);
  const json = await response.json().catch(() => null) as { data?: Array<{ url?: string }> } | null;
  const url = json?.data?.[0]?.url;
  if (!url) throw new ImageError("no_image", "Ideogram answered without a picture.");
  return download("ideogram", url, fetcher, signal);
}

// ---- Stability AI: multipart, answered with the image itself -------------------------------------------------------------------------
async function stability(key: string, r: ImageRequest, fetcher: Fetch, signal?: AbortSignal): Promise<ImageResult> {
  const form = new FormData();
  form.set("prompt", r.prompt); form.set("aspect_ratio", r.aspect); form.set("output_format", "png"); form.set("model", "sd3.5-large");
  if (r.negative) form.set("negative_prompt", r.negative);
  const ref = r.references?.[0];
  if (ref) { form.set("mode", "image-to-image"); form.set("strength", "0.65"); form.set("image", new Blob([new Uint8Array(ref.data)], { type: ref.mime }), "reference.png"); }
  const response = await fetcher(`https://api.stability.ai/v2beta/${r.endpoint}`, { method: "POST", headers: { authorization: `Bearer ${key}`, accept: "image/*" }, body: form, signal: timeout(signal), cache: "no-store" });
  if (!response.ok) return fail(response);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new ImageError("no_image", "The picture came back empty or too large.");
  return { bytes, contentType: response.headers.get("content-type")?.split(";")[0] || "image/png" };
}

const PLATFORM = { fal, google, openai, replicate, bfl, ideogram, stability } as const;
/** One picture. The caller has already chosen the model and rendered the prompt for its dialect (prompts.ts). */
export async function generateImage(key: string, request: ImageRequest, fetcher: Fetch = fetch, signal?: AbortSignal): Promise<ImageResult> {
  if ((request.references?.length ?? 0) > request.model.references) throw new ImageError("rejected", `${request.model.label} takes at most ${request.model.references} reference photo(s).`);
  if (request.prompt.trim().length < 3 || request.prompt.length > 4000) throw new ImageError("rejected", "The prompt must be 3 to 4,000 characters.");
  try { return await PLATFORM[request.platform](key, request, fetcher, signal); }
  catch (error) { if (error instanceof ImageError) throw error; throw new ImageError("unavailable", "Could not reach the platform. Try again shortly."); }
}

/** Free checks before a key is stored. A deliberately empty request is used only where the platform has no account endpoint: bad keys are refused as unauthorised before anything is drawn or billed. */
export async function verifyImageKey(platform: ImagePlatformId, key: string, fetcher: Fetch = fetch): Promise<"valid" | "invalid" | "unavailable"> {
  const sig = () => AbortSignal.timeout(15_000);
  try {
    let response: Response;
    switch (platform) {
      case "google": response = await fetcher("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": key }, signal: sig(), cache: "no-store" }); break;
      case "openai": response = await fetcher("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` }, signal: sig(), cache: "no-store" }); break;
      case "replicate": response = await fetcher("https://api.replicate.com/v1/account", { headers: { authorization: `Bearer ${key}` }, signal: sig(), cache: "no-store" }); break;
      case "bfl": response = await fetcher("https://api.bfl.ai/v1/credits", { headers: { "x-key": key, accept: "application/json" }, signal: sig(), cache: "no-store" }); break;
      case "stability": response = await fetcher("https://api.stability.ai/v1/user/balance", { headers: { authorization: `Bearer ${key}` }, signal: sig(), cache: "no-store" }); break;
      case "ideogram": response = await fetcher("https://api.ideogram.ai/v1/ideogram-v3/generate", { method: "POST", headers: { "Api-Key": key }, body: new FormData(), signal: sig(), cache: "no-store" }); break;
      case "fal": response = await fetcher("https://fal.run/fal-ai/flux-pro/kontext", { method: "POST", headers: { authorization: `Key ${key}`, "content-type": "application/json" }, body: "{}", signal: sig(), cache: "no-store" }); break;
    }
    if (response.status === 401 || response.status === 403) return "invalid";
    return response.status >= 500 ? "unavailable" : "valid";
  } catch { return "unavailable"; }
}

/** Models the platform itself offers for this key (OpenAI and Google), filtered to image generators. Empty when it cannot be listed. */
export async function listImageModels(platform: "openai" | "google", key: string, fetcher: Fetch = fetch): Promise<string[]> {
  try {
    if (platform === "openai") {
      const r = await fetcher("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
      const json = r.ok ? await r.json() as { data?: Array<{ id?: string }> } : null;
      return (json?.data ?? []).map(m => m.id ?? "").filter(id => /^gpt-image/i.test(id)).sort().reverse();
    }
    const r = await fetcher("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
    const json = r.ok ? await r.json() as { models?: Array<{ name?: string }> } : null;
    return (json?.models ?? []).map(m => (m.name ?? "").replace(/^models\//, "")).filter(id => /image/i.test(id) && /^gemini/i.test(id)).sort().reverse();
  } catch { return []; }
}

// ---- A tiny reference picture, so models that only edit can be tested without anyone's photo -------------------------------------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf: Buffer) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), 4 + body.length); return out;
}
/** A 128x128 gradient PNG: a neutral stand-in for a reference photo in key tests. */
export function testReferencePng(): Buffer {
  const size = 128, rows: Buffer[] = [];
  for (let y = 0; y < size; y++) { const row = Buffer.alloc(1 + size * 3); for (let x = 0; x < size; x++) { row[1 + x * 3] = 60 + x; row[2 + x * 3] = 90 + y; row[3 + x * 3] = 160; } rows.push(row); }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}
