import { checkSampleLength, wavSeconds } from "./clone-sample";
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

export interface CloneInput { provider: HostedVoiceProvider; name: string; language: string | null; persona: string | null; attested: boolean; consentRecorded?: boolean;
  /** The exact words spoken in the sample, when known (the recorder knows them). Fish uses it as the sample text; it improves the clone. */
  transcript?: string | null; description?: string | null; cleanAudio?: boolean }
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
  const consentRecorded = form.get("consentRecorded") === "on";
  const sample = form.get("sample");
  if (!(sample instanceof File)) throw new Error("Choose an audio sample.");
  if (sample.size < MIN_SAMPLE_BYTES) throw new Error("The sample is too short. Use at least 10 seconds of clear speech.");
  if (sample.size > MAX_SAMPLE_BYTES) throw new Error("The sample is larger than 12 MB. Use a shorter clip.");
  if (!SAMPLE_TYPES.includes(sample.type)) throw new Error("Use an MP3, WAV, M4A, AAC, OGG, WebM or FLAC sample.");
  const transcript = String(form.get("transcript") ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 1500);
  const description = String(form.get("description") ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 300);
  return { input: { provider, name, language: language || null, persona: persona || null, attested: true, consentRecorded, transcript: transcript || null, description: description || null, cleanAudio: form.get("cleanAudio") === "on" }, sample };
}

export interface VoiceRow { id: string; provider: VoiceProvider; providerVoiceId: string; name: string; kind: "preset" | "clone" | "designed"; language: string | null; persona: string | null; isDefault: boolean; description?: string | null; tags?: string[] }
/** The voice Make video should offer first: the Location default, else the first voice whose provider can run. */
export function pickDefaultVoice(voices: VoiceRow[], usable: (p: VoiceProvider) => boolean): VoiceRow | null {
  const ok = voices.filter(v => usable(v.provider));
  return ok.find(v => v.isDefault) ?? ok[0] ?? null;
}
/** Narration is billed by the provider to the Location's own account; say so next to any hosted choice. */
export const hostedVoiceNote = "Hosted voices are billed to your own provider account.";

/** A plain PCM WAV (what the recorder makes) carries its length in the header: refuse a too-short or too-long sample before any paid provider call. Other formats are checked in the browser. */
export async function assertSampleLength(provider: HostedVoiceProvider, sample: File): Promise<void> {
  const seconds = sample.type.includes("wav") ? wavSeconds(new Uint8Array(await sample.arrayBuffer())) : null;
  if (seconds === null) return;
  const verdict = checkSampleLength(provider, seconds);
  if (verdict.level === "error") throw new Error(`The sample: ${verdict.message}`);
}

export const LOCAL_CLONE_PATTERN = /^clone-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isLocalCloneSpeaker = (value: unknown): value is string => typeof value === "string" && LOCAL_CLONE_PATTERN.test(value);
export interface LocalCloneInput { name: string; language: string | null; persona: string | null; transcript: string; consentRecorded: boolean }
/** Clone on this Mac: a recorded WAV plus the exact words spoken. The reference never goes to a voice provider. */
export function readLocalCloneForm(form: FormData): { input: LocalCloneInput; sample: File } {
  const name = String(form.get("name") ?? "").trim();
  if (name.length < 1 || name.length > 80 || /[\u0000-\u001f]/.test(name)) throw new Error("Give the voice a name of up to 80 characters.");
  const language = String(form.get("language") ?? "").trim();
  if (language && !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(language)) throw new Error("Use a language code like en or pt-BR.");
  const persona = String(form.get("persona") ?? "").trim();
  if (persona.length > 80) throw new Error("The persona label can be at most 80 characters.");
  if (form.get("attested") !== "on") throw new Error("Confirm you have the right to clone this voice.");
  const transcript = String(form.get("transcript") ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 1500);
  if (transcript.length < 20) throw new Error("Enter the exact words spoken in the recording.");
  const sample = form.get("sample");
  if (!(sample instanceof File)) throw new Error("Record or choose a sample.");
  if (!sample.type.includes("wav")) throw new Error("Use a WAV recording for on-device cloning.");
  if (sample.size < MIN_SAMPLE_BYTES) throw new Error("The sample is too short. Use at least 8 seconds of clear speech.");
  if (sample.size > MAX_SAMPLE_BYTES) throw new Error("The sample is larger than 12 MB. Use a shorter clip.");
  return { input: { name, language: language || null, persona: persona || null, transcript, consentRecorded: form.get("consentRecorded") === "on" }, sample };
}
export async function assertLocalSampleLength(sample: File): Promise<void> {
  const seconds = wavSeconds(new Uint8Array(await sample.arrayBuffer()));
  if (seconds === null) throw new Error("The sample: use a plain 16-bit WAV recording.");
  const verdict = checkSampleLength("local", seconds);
  if (verdict.level === "error") throw new Error(`The sample: ${verdict.message}`);
}
