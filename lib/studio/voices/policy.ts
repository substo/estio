/** Voice providers a Location can connect with its own key, plus the on-device engine. Pure rules shared by the server, UI and tests. */
export const HOSTED_VOICE_PROVIDERS = ["fish", "elevenlabs"] as const;
export type HostedVoiceProvider = typeof HOSTED_VOICE_PROVIDERS[number];
export type VoiceProvider = HostedVoiceProvider | "local";
export const providerLabels: Record<VoiceProvider, string> = { fish: "Fish Audio", elevenlabs: "ElevenLabs", local: "On this Mac" };
export const isHostedProvider = (value: unknown): value is HostedVoiceProvider => HOSTED_VOICE_PROVIDERS.includes(value as HostedVoiceProvider);

/** Built-in speakers of the on-device Qwen3-TTS CustomVoice model. Listed as local voices; no key, no cost. */
export const LOCAL_SPEAKERS = ["serena", "vivian", "uncle_fu", "ryan", "aiden", "ono_anna", "sohee", "eric", "dylan"] as const;
export const LOCAL_TTS_MODEL = "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-4bit";

export function readVoiceKey(provider: HostedVoiceProvider, value: FormDataEntryValue | null): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (provider === "fish" && !/^[A-Za-z0-9_-]{20,200}$/.test(key)) throw new Error("Enter a valid Fish Audio API key.");
  if (provider === "elevenlabs" && !/^(sk_)?[A-Za-z0-9_-]{20,200}$/.test(key)) throw new Error("Enter a valid ElevenLabs API key.");
  return key;
}
export const keyHint = (key: string) => key.slice(-4);

/** Words the person confirms before a voice is cloned. Stored verbatim with who and when. */
export const CLONE_CONSENT_STATEMENT = "This is my own voice, or the speaker has given me permission to clone it and use it in this workspace's videos.";
export const MAX_SAMPLE_BYTES = 12 * 1024 * 1024;
export const MIN_SAMPLE_BYTES = 20 * 1024;
export const SAMPLE_TYPES = ["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/webm", "audio/ogg", "audio/flac"];

export interface CloneInput { provider: HostedVoiceProvider; name: string; language: string | null; persona: string | null; attested: boolean }
export function readCloneForm(form: FormData): { input: CloneInput; sample: File } {
  const provider = String(form.get("provider") ?? "");
  if (!isHostedProvider(provider)) throw new Error("Choose Fish Audio or ElevenLabs.");
  const name = String(form.get("name") ?? "").trim();
  if (name.length < 1 || name.length > 80 || /[\u0000-\u001f]/.test(name)) throw new Error("Give the voice a name of up to 80 characters.");
  const language = String(form.get("language") ?? "").trim();
  if (language && !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(language)) throw new Error("Use a language code like en or pt-BR.");
  const persona = String(form.get("persona") ?? "").trim();
  if (persona.length > 80) throw new Error("The persona label can be at most 80 characters.");
  if (form.get("attested") !== "on") throw new Error("Confirm you have the right to clone this voice.");
  const sample = form.get("sample");
  if (!(sample instanceof File)) throw new Error("Choose an audio sample.");
  if (sample.size < MIN_SAMPLE_BYTES) throw new Error("The sample is too short. Use at least 10 seconds of clear speech.");
  if (sample.size > MAX_SAMPLE_BYTES) throw new Error("The sample is larger than 12 MB. Use a shorter clip.");
  if (!SAMPLE_TYPES.includes(sample.type)) throw new Error("Use an MP3, WAV, M4A, AAC, OGG, WebM or FLAC sample.");
  return { input: { provider, name, language: language || null, persona: persona || null, attested: true }, sample };
}

export interface VoiceRow { id: string; provider: VoiceProvider; providerVoiceId: string; name: string; kind: "preset" | "clone"; language: string | null; persona: string | null; isDefault: boolean }
/** The voice Make video should offer first: the Location default, else the first voice whose provider can run. */
export function pickDefaultVoice(voices: VoiceRow[], usable: (p: VoiceProvider) => boolean): VoiceRow | null {
  const ok = voices.filter(v => usable(v.provider));
  return ok.find(v => v.isDefault) ?? ok[0] ?? null;
}
/** Narration is billed by the provider to the Location's own account; say so next to any hosted choice. */
export const hostedVoiceNote = "Hosted voices are billed to your own provider account.";
