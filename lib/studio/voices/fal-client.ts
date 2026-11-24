import type { SoundKind } from "./sound-providers";

type Fetch = typeof fetch;
/** Music and sound effects from fal.ai's hosted Stable Audio 3 Small models (one fal key covers both). Prices and limits: https://fal.ai/models/fal-ai/stable-audio-3/small/music/text-to-audio */
export const FAL_MODELS: Record<SoundKind, string> = {
  music: "fal-ai/stable-audio-3/small/music/text-to-audio",
  effects: "fal-ai/stable-audio-3/small/sfx/text-to-audio",
};
const FAL = "https://fal.run";
export class FalError extends Error {
  constructor(readonly code: "invalid_key" | "unavailable" | "rejected", message: string) { super(message); }
}
const keyPattern = /^[A-Za-z0-9_:.-]{16,200}$/;
export function readFalKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (!keyPattern.test(key)) throw new Error("Paste the fal.ai API key exactly as shown (it looks like an id, a colon and a secret).");
  return key;
}
const headers = (key: string) => ({ authorization: `Key ${key}`, "content-type": "application/json" });
/** The provider's own reason, plain text, bounded: what the owner needs to see ("exhausted balance", "locked"). */
async function reason(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  const detail = body?.detail;
  const flat = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map(d => (d && typeof d === "object" ? String((d as Record<string, unknown>).msg ?? "") : "")).filter(Boolean).join("; ") : "";
  return flat.replace(/[\u0000-\u001f]/g, " ").replace(/[A-Za-z0-9_-]{8,}:[A-Za-z0-9]{16,}/g, "[key]").trim().slice(0, 240);
}

/** Free check before a key is stored: a request with no prompt is refused with a validation error and costs nothing; a bad key is refused as unauthorised first. */
export async function verifyFalKey(key: string, fetcher: Fetch = fetch): Promise<"valid" | "invalid" | "unavailable"> {
  try {
    const response = await fetcher(`${FAL}/${FAL_MODELS.effects}`, { method: "POST", headers: headers(key), body: "{}", cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (response.status === 401) return "invalid";
    return response.status >= 500 ? "unavailable" : "valid";
  } catch { return "unavailable"; }
}

const falHost = /^(?:[a-z0-9-]+\.)*fal\.(?:media|run|ai)$/i;
/** One clip as MP3 bytes. Asks for the audio inline; when fal answers with a link instead, only fal's own https hosts are followed. */
export async function generateFalSound(key: string, kind: SoundKind, prompt: string, seconds: number, fetcher: Fetch = fetch, signal?: AbortSignal): Promise<Buffer> {
  if (prompt.trim().length < 3 || prompt.length > 1000) throw new FalError("rejected", "The sound description must be 3 to 1,000 characters.");
  const duration = Math.round(Math.min(120, Math.max(1, seconds)) * 10) / 10;
  let response: Response;
  try {
    response = await fetcher(`${FAL}/${FAL_MODELS[kind]}`, { method: "POST", headers: headers(key), cache: "no-store", signal: signal ?? AbortSignal.timeout(300_000),
      body: JSON.stringify({ prompt, duration, output_format: "mp3", sync_mode: true, enable_safety_checker: true }) });
  } catch { throw new FalError("unavailable", "fal.ai could not be reached. Try again shortly."); }
  if (response.status === 401) throw new FalError("invalid_key", "fal.ai rejected this key. Replace it in the voice settings.");
  if (!response.ok) { const why = await reason(response); throw new FalError(response.status >= 500 ? "unavailable" : "rejected", `fal.ai declined the request (${response.status})${why ? `: ${why}` : ""}.`); }
  const body = await response.json().catch(() => null) as { audio?: { url?: unknown } } | null;
  const url = typeof body?.audio?.url === "string" ? body.audio.url : "";
  let bytes: Buffer;
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    bytes = Buffer.from(url.slice(comma + 1), url.slice(0, comma).includes("base64") ? "base64" : "utf8");
  } else {
    let parsed: URL | null = null;
    try { parsed = new URL(url); } catch { /* handled below */ }
    if (!parsed || parsed.protocol !== "https:" || !falHost.test(parsed.hostname)) throw new FalError("rejected", "fal.ai returned no audio.");
    const file = await fetcher(parsed.toString(), { cache: "no-store", signal: signal ?? AbortSignal.timeout(60_000) }).catch(() => null);
    if (!file?.ok) throw new FalError("unavailable", "fal.ai made the clip but it could not be downloaded. Try again.");
    bytes = Buffer.from(await file.arrayBuffer());
  }
  if (bytes.length < 1000) throw new FalError("rejected", "fal.ai returned no audio.");
  return bytes;
}
