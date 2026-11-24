import { speechModel } from "../video-assembly/tts";
import { elevenLabsMeta, fishMeta } from "./library";
import type { HostedVoiceProvider } from "./policy";

type Fetch = typeof fetch;
export interface ProviderVoice { providerVoiceId: string; name: string; language: string | null; kind: "preset" | "clone"; description?: string | null; tags?: string[] }
export class VoiceProviderError extends Error {
  constructor(readonly code: "invalid_key" | "unavailable" | "rejected" | "not_found", message: string) { super(message); }
}
const FISH = "https://api.fish.audio";
const ELEVEN = "https://api.elevenlabs.io";
const idPattern = /^[A-Za-z0-9_-]{6,64}$/;
const fishHeaders = (key: string) => ({ authorization: `Bearer ${key}` });
const elevenHeaders = (key: string) => ({ "xi-api-key": key });

async function send(fetcher: Fetch, url: string, init: RequestInit, failure: string): Promise<Response> {
  let response: Response;
  try { response = await fetcher(url, { ...init, cache: "no-store", signal: init.signal ?? AbortSignal.timeout(60_000) }); }
  catch { throw new VoiceProviderError("unavailable", `${failure} The provider could not be reached. Try again shortly.`); }
  if (response.status === 401) throw new VoiceProviderError("invalid_key", "The provider rejected this key. Replace it in AI settings.");
  if (response.status === 404) throw new VoiceProviderError("not_found", "The voice no longer exists at the provider.");
  if (!response.ok) {
    // The provider's own reason is what tells the owner what to change (sample too short, wrong format, plan limit). Plain text only, bounded, no echo of keys or URLs.
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    const detail = body && typeof body === "object" ? (typeof body.detail === "string" ? body.detail : (body.detail && typeof body.detail === "object" ? (body.detail as Record<string, unknown>).message : undefined) ?? body.message ?? (typeof body.error === "string" ? body.error : undefined)) : undefined;
    const reason = typeof detail === "string" ? detail.replace(/[\u0000-\u001f]/g, " ").replace(/sk[-_][A-Za-z0-9_-]{8,}/g, "[key]").trim().slice(0, 240) : "";
    throw new VoiceProviderError(response.status >= 500 ? "unavailable" : "rejected", `${failure} The provider declined the request (${response.status})${reason ? `: ${reason}` : ""}.`);
  }
  return response;
}
const json = async (response: Response) => { try { return await response.json() as Record<string, unknown>; } catch { return {}; } };
const text = (v: unknown, max: number) => typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";

/** Free read-only check before a key is stored. ElevenLabs keys can be scoped: a missing-permission 401 still proves the key exists. */
export async function verifyVoiceKey(provider: HostedVoiceProvider, key: string, fetcher: Fetch = fetch): Promise<"valid" | "invalid" | "unavailable"> {
  try {
    const response = provider === "fish"
      ? await fetcher(`${FISH}/wallet/self/api-credit`, { headers: fishHeaders(key), cache: "no-store", signal: AbortSignal.timeout(10_000) })
      : await fetcher(`${ELEVEN}/v1/voices?page_size=1`, { headers: elevenHeaders(key), cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (response.ok) return "valid";
    if (response.status === 401 && provider === "elevenlabs" && /missing_permissions/.test(await response.text().catch(() => ""))) return "valid";
    return response.status === 401 || response.status === 403 ? "invalid" : "unavailable";
  } catch { return "unavailable"; }
}

export async function listProviderVoices(provider: HostedVoiceProvider, key: string, fetcher: Fetch = fetch): Promise<ProviderVoice[]> {
  if (provider === "fish") {
    const body = await json(await send(fetcher, `${FISH}/model?self=true&page_size=100&page_number=1`, { headers: fishHeaders(key) }, "Could not list Fish voices."));
    const items = Array.isArray(body.items) ? body.items : [];
    return items.flatMap((item: Record<string, unknown>) => typeof item._id === "string" && idPattern.test(item._id)
      ? [{ providerVoiceId: item._id, name: text(item.title, 80) || "Untitled voice", language: Array.isArray(item.languages) ? text(item.languages[0], 12) || null : null, kind: "clone" as const, ...fishMeta(item) }] : []);
  }
  const body = await json(await send(fetcher, `${ELEVEN}/v1/voices`, { headers: elevenHeaders(key) }, "Could not list ElevenLabs voices."));
  const voices = Array.isArray(body.voices) ? body.voices : [];
  return voices.flatMap((v: Record<string, unknown>) => typeof v.voice_id === "string" && idPattern.test(v.voice_id)
    ? [{ providerVoiceId: v.voice_id, name: text(v.name, 80) || "Untitled voice",
        language: text((v.labels as Record<string, unknown> | undefined)?.language, 12) || null, kind: (v.category === "cloned" || v.category === "professional" ? "clone" : "preset") as "preset" | "clone", ...elevenLabsMeta(v) }] : []);
}

/** Instant clone from one sample. The sample is forwarded and never stored by Studio. Returns the provider's voice id. */
export async function cloneProviderVoice(provider: HostedVoiceProvider, key: string, input: { name: string; sample: Blob; filename: string; language?: string | null; transcript?: string | null; description?: string | null; cleanAudio?: boolean }, fetcher: Fetch = fetch): Promise<string> {
  const form = new FormData();
  if (provider === "fish") {
    form.set("type", "tts"); form.set("title", input.name); form.set("train_mode", "fast"); form.set("visibility", "private"); form.append("voices", input.sample, input.filename);
    // Fish: one transcript per sample improves the clone; enhance_audio_quality cleans a noisy recording.
    if (input.transcript) form.append("texts", input.transcript);
    if (input.description) form.set("description", input.description);
    if (input.cleanAudio) form.set("enhance_audio_quality", "true");
    const id = (await json(await send(fetcher, `${FISH}/model`, { method: "POST", headers: fishHeaders(key), body: form, signal: AbortSignal.timeout(180_000) }, "Could not clone the voice.")))._id;
    if (typeof id !== "string" || !idPattern.test(id)) throw new VoiceProviderError("rejected", "The provider did not return a voice id.");
    return id;
  }
  form.set("name", input.name); form.append("files", input.sample, input.filename);
  // ElevenLabs: optional description and background-noise removal (default off; the docs say clean audio matters more).
  if (input.description) form.set("description", input.description);
  if (input.cleanAudio) form.set("remove_background_noise", "true");
  if (input.language) form.set("labels", JSON.stringify({ language: input.language }));
  const id = (await json(await send(fetcher, `${ELEVEN}/v1/voices/add`, { method: "POST", headers: elevenHeaders(key), body: form, signal: AbortSignal.timeout(180_000) }, "Could not clone the voice."))).voice_id;
  if (typeof id !== "string" || !idPattern.test(id)) throw new VoiceProviderError("rejected", "The provider did not return a voice id.");
  return id;
}

export async function deleteProviderVoice(provider: HostedVoiceProvider, key: string, voiceId: string, fetcher: Fetch = fetch): Promise<void> {
  if (!idPattern.test(voiceId)) throw new VoiceProviderError("rejected", "Invalid voice id.");
  try {
    await send(fetcher, provider === "fish" ? `${FISH}/model/${voiceId}` : `${ELEVEN}/v1/voices/${voiceId}`, { method: "DELETE", headers: provider === "fish" ? fishHeaders(key) : elevenHeaders(key) }, "Could not delete the voice.");
  } catch (error) { if (!(error instanceof VoiceProviderError && error.code === "not_found")) throw error; }
}

const checkAudio = (bytes: Buffer) => { if (bytes.length < 1000) throw new VoiceProviderError("rejected", "The provider returned no audio."); return bytes; };
/** One narration beat to MP3 bytes. Eleven v3 and Fish S2 both read bracketed tags such as [excited] or [laugh]. */
export async function synthesizeHosted(provider: HostedVoiceProvider, key: string, voiceId: string, text: string, fetcher: Fetch = fetch, signal?: AbortSignal, fishModel = "s2-pro"): Promise<Buffer> {
  if (!idPattern.test(voiceId)) throw new VoiceProviderError("rejected", "Invalid voice id.");
  if (!text.trim() || text.length > 4500) throw new VoiceProviderError("rejected", "A narration paragraph must be 1 to 4,500 characters.");
  const response = provider === "fish"
    ? await send(fetcher, `${FISH}/v1/tts`, { method: "POST", signal, headers: { ...fishHeaders(key), "content-type": "application/json", model: fishModel }, body: JSON.stringify({ text, reference_id: voiceId, format: "mp3", mp3_bitrate: 128, latency: "normal" }) }, "Could not generate the voice.")
    : await send(fetcher, `${ELEVEN}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, { method: "POST", signal, headers: { ...elevenHeaders(key), "content-type": "application/json", accept: "audio/mpeg" }, body: JSON.stringify({ text, model_id: speechModel }) }, "Could not generate the voice.");
  return checkAudio(Buffer.from(await response.arrayBuffer()));
}

export interface DesignPreview { generatedVoiceId: string; audioBase64: string }
const base64 = /^[A-Za-z0-9+/=]{100,400000}$/;
/** ElevenLabs Voice Design: a text description in, a few candidate voices out (each with a short audio preview). Nothing is saved until one is chosen. */
export async function designProviderVoice(key: string, description: string, fetcher: Fetch = fetch, previewText?: string): Promise<DesignPreview[]> {
  if (description.length < 20 || description.length > 1000) throw new VoiceProviderError("rejected", "Describe the voice in 20 to 1,000 characters.");
  if (previewText && (previewText.length < 100 || previewText.length > 1000)) throw new VoiceProviderError("rejected", "The preview text must be 100 to 1,000 characters, or leave it empty.");
  const body = await json(await send(fetcher, `${ELEVEN}/v1/text-to-voice/design`, { method: "POST", headers: { ...elevenHeaders(key), "content-type": "application/json" },
    body: JSON.stringify(previewText ? { voice_description: description, text: previewText } : { voice_description: description, auto_generate_text: true }), signal: AbortSignal.timeout(120_000) }, "Could not design the voice."));
  const previews = Array.isArray(body.previews) ? body.previews : [];
  const out = previews.flatMap((p: Record<string, unknown>) => typeof p.generated_voice_id === "string" && idPattern.test(p.generated_voice_id) && typeof p.audio_base_64 === "string" && base64.test(p.audio_base_64)
    ? [{ generatedVoiceId: p.generated_voice_id, audioBase64: p.audio_base_64 }] : []).slice(0, 3);
  if (!out.length) throw new VoiceProviderError("rejected", "The provider returned no voice previews. Try a different description.");
  return out;
}
/** Turn a chosen preview into a saved voice in the provider account. Returns the provider's voice id. */
export async function saveDesignedVoice(key: string, input: { name: string; description: string; generatedVoiceId: string }, fetcher: Fetch = fetch): Promise<string> {
  if (!idPattern.test(input.generatedVoiceId)) throw new VoiceProviderError("rejected", "Invalid preview id.");
  const id = (await json(await send(fetcher, `${ELEVEN}/v1/text-to-voice`, { method: "POST", headers: { ...elevenHeaders(key), "content-type": "application/json" },
    body: JSON.stringify({ voice_name: input.name, voice_description: input.description, generated_voice_id: input.generatedVoiceId }), signal: AbortSignal.timeout(60_000) }, "Could not save the voice.")))?.voice_id;
  if (typeof id !== "string" || !idPattern.test(id)) throw new VoiceProviderError("rejected", "The provider did not return a voice id.");
  return id;
}

/** Instrumental music bed for a video. ElevenLabs Music: prompt + length in, MP3 out. Billed to the Location's own account. */
export async function generateMusicBed(key: string, prompt: string, seconds: number, fetcher: Fetch = fetch, signal?: AbortSignal): Promise<Buffer> {
  const ms = Math.round(Math.min(600, Math.max(3, seconds)) * 1000);
  if (prompt.trim().length < 3 || prompt.length > 1000) throw new VoiceProviderError("rejected", "The music prompt must be 3 to 1,000 characters.");
  const response = await send(fetcher, `${ELEVEN}/v1/music?output_format=mp3_44100_128`, { method: "POST", signal: signal ?? AbortSignal.timeout(300_000),
    headers: { ...elevenHeaders(key), "content-type": "application/json", accept: "audio/mpeg" }, body: JSON.stringify({ prompt, music_length_ms: ms, force_instrumental: true }) }, "Could not generate the music.");
  return checkAudio(Buffer.from(await response.arrayBuffer()));
}
/** One short sound effect (for example a soft whoosh). ElevenLabs Sound Effects: text + duration in, MP3 out. */
export async function generateSoundEffect(key: string, description: string, seconds: number, fetcher: Fetch = fetch, signal?: AbortSignal): Promise<Buffer> {
  if (description.trim().length < 3 || description.length > 450) throw new VoiceProviderError("rejected", "The sound description must be 3 to 450 characters.");
  const response = await send(fetcher, `${ELEVEN}/v1/sound-generation?output_format=mp3_44100_128`, { method: "POST", signal: signal ?? AbortSignal.timeout(120_000),
    headers: { ...elevenHeaders(key), "content-type": "application/json", accept: "audio/mpeg" }, body: JSON.stringify({ text: description, duration_seconds: Math.min(30, Math.max(0.5, seconds)), prompt_influence: 0.5 }) }, "Could not generate the sound effect.");
  return checkAudio(Buffer.from(await response.arrayBuffer()));
}
