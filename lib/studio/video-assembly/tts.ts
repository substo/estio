import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { runNativeProcess } from "../companion/process";

const execFileAsync = promisify(execFile);
export type TtsProvider = "fish" | "elevenlabs" | "local";
/** Eleven v3 steers delivery with audio tags like [excited]; Fish S2 takes the same bracketed natural-language tags. */
export const speechModel = "eleven_v3";
export const defaultVoiceId = "21m00Tcm4TlvDq8ikWAM";
export const fishModel = "s2-pro";
export const localModel = "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-4bit";
const idPattern = /^[A-Za-z0-9_-]{6,64}$/;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

/** The one file the owner pastes keys into. Real environment variables win over it. */
export const keysFile = (home = homedir()) => join(home, ".config", "estio", "studio-video.env");
export const keysFileTemplate = `# Estio Studio script-to-video keys. Paste a value after the = sign. Lines starting with # are ignored.
# Which voice engine to use: fish, elevenlabs or local. Leave empty to use the first one with a key (fish, then elevenlabs, then local).
STUDIO_TTS_PROVIDER=

# Fish Audio (cheapest hosted voice). Key: fish.audio -> Dashboard -> API Keys.
FISH_API_KEY=
# Optional: a voice id (reference_id) from the Fish voice library. Empty = Fish's default voice.
FISH_VOICE_ID=

# ElevenLabs (alternative). Key: elevenlabs.io -> Developers -> API Keys (needs text_to_speech permission).
ELEVENLABS_API_KEY=
# Optional voice id. Empty = ElevenLabs Rachel.
ELEVENLABS_VOICE_ID=
`;

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (m && !raw.trimStart().startsWith("#")) { const v = m[2].replace(/^(['"])(.*)\1$/, "$2"); if (v) out[m[1]] = v; }
  }
  return out;
}
export async function loadVideoKeys(env: NodeJS.ProcessEnv = process.env, file = keysFile()): Promise<Record<string, string>> {
  const fromFile = await readFile(file, "utf8").then(parseEnvFile, () => ({} as Record<string, string>));
  const merged: Record<string, string> = { ...fromFile };
  for (const k of ["STUDIO_TTS_PROVIDER", "FISH_API_KEY", "FISH_VOICE_ID", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "STUDIO_FISH_MODEL", "STUDIO_LOCAL_TTS_MODEL"]) if (env[k]?.trim()) merged[k] = env[k]!.trim();
  return merged;
}
/** ElevenLabs key: the keys file / environment, else the Keychain service `elevenlabs` the editor already uses. */
export async function elevenLabsKey(env: NodeJS.ProcessEnv = process.env, file = keysFile()): Promise<string | null> {
  const k = (await loadVideoKeys(env, file)).ELEVENLABS_API_KEY;
  if (k) return k;
  try {
    const { stdout } = await runNativeProcess({ command: "/usr/bin/security", args: ["find-generic-password", "-s", "elevenlabs", "-w"], cwd: tmpdir(), timeoutMs: 15_000, maxOutputBytes: 512 });
    return stdout.trim() || null;
  } catch { return null; }
}

const venvPython = (home = homedir()) => join(home, "Library", "Application Support", "Estio", "StudioCompanion", "tts-venv", "bin", "python");
export async function localTtsReady(python = venvPython()): Promise<boolean> {
  try { await execFileAsync(python, ["-c", "import mlx_audio"], { timeout: 30_000 }); return true; } catch { return false; }
}

export interface SpeechEngine { provider: TtsProvider; label: string; speak(text: string, signal?: AbortSignal): Promise<Buffer> }
const checkText = (text: string) => { if (!text.trim() || text.length > 4500) throw new Error("invalid_speech_text"); };
const checkAudio = (bytes: Buffer, code: string) => { if (bytes.length < 1000) throw new Error(code); return bytes; };

export async function synthesizeSpeech({ text, apiKey, voiceId = defaultVoiceId, fetchImpl = fetch, signal }: { text: string; apiKey: string; voiceId?: string; fetchImpl?: typeof fetch; signal?: AbortSignal }): Promise<Buffer> {
  if (!idPattern.test(voiceId)) throw new Error("invalid_voice_id"); checkText(text);
  const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST", signal, headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" }, body: JSON.stringify({ text, model_id: speechModel }) });
  if (!response.ok) throw new Error(`elevenlabs_${response.status}`);
  return checkAudio(Buffer.from(await response.arrayBuffer()), "elevenlabs_empty_audio");
}
/** Fish Audio: POST /v1/tts, bearer key, `model` header selects the model, `reference_id` the voice. */
export async function synthesizeFish({ text, apiKey, voiceId, model = fishModel, fetchImpl = fetch, signal }: { text: string; apiKey: string; voiceId?: string; model?: string; fetchImpl?: typeof fetch; signal?: AbortSignal }): Promise<Buffer> {
  if (voiceId && !idPattern.test(voiceId)) throw new Error("invalid_voice_id");
  if (!modelPattern.test(model)) throw new Error("invalid_model"); checkText(text);
  const response = await fetchImpl("https://api.fish.audio/v1/tts", {
    method: "POST", signal, headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", model },
    body: JSON.stringify({ text, format: "mp3", mp3_bitrate: 128, latency: "normal", ...(voiceId ? { reference_id: voiceId } : {}) }) });
  if (!response.ok) throw new Error(`fish_${response.status}`);
  return checkAudio(Buffer.from(await response.arrayBuffer()), "fish_empty_audio");
}
/** On-device Qwen3-TTS through mlx-audio in the companion's own venv. No network after the model is cached. */
export async function synthesizeLocal({ text, model = localModel, python = venvPython(), signal }: { text: string; model?: string; python?: string; signal?: AbortSignal }): Promise<Buffer> {
  if (!modelPattern.test(model)) throw new Error("invalid_model"); checkText(text);
  const dir = await mkdtemp(join(tmpdir(), "studio-tts-"));
  try {
    await execFileAsync(python, ["-m", "mlx_audio.tts.generate", "--model", model, "--text", text, "--output_path", dir, "--file_prefix", "speech", "--audio_format", "mp3", "--lang_code", "a"], { timeout: 10 * 60_000, signal, maxBuffer: 1 << 20 });
    const file = (await readdir(dir)).find(f => f.startsWith("speech") && f.endsWith(".mp3"));
    if (!file) throw new Error("local_tts_no_output");
    return checkAudio(await readFile(join(dir, file)), "local_tts_empty_audio");
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** Pick the engine. An explicit STUDIO_TTS_PROVIDER wins; otherwise the first with a key, then on-device. Returns null when none is usable. */
export async function resolveSpeech(env: NodeJS.ProcessEnv = process.env, file = keysFile(), fetchImpl: typeof fetch = fetch): Promise<SpeechEngine | null> {
  const k = await loadVideoKeys(env, file);
  const eleven = await elevenLabsKey(env, file);
  const options: Record<TtsProvider, () => SpeechEngine | null> = {
    fish: () => k.FISH_API_KEY ? { provider: "fish", label: "Fish Audio", speak: (text, signal) => synthesizeFish({ text, apiKey: k.FISH_API_KEY, voiceId: k.FISH_VOICE_ID, model: k.STUDIO_FISH_MODEL, fetchImpl, signal }) } : null,
    elevenlabs: () => eleven ? { provider: "elevenlabs", label: "ElevenLabs", speak: (text, signal) => synthesizeSpeech({ text, apiKey: eleven, voiceId: k.ELEVENLABS_VOICE_ID, fetchImpl, signal }) } : null,
    local: () => ({ provider: "local", label: "On-device Qwen3-TTS", speak: (text, signal) => synthesizeLocal({ text, model: k.STUDIO_LOCAL_TTS_MODEL, signal }) }),
  };
  const wanted = k.STUDIO_TTS_PROVIDER as TtsProvider | undefined;
  if (wanted) return Object.hasOwn(options, wanted) ? options[wanted]() : null;
  return options.fish() ?? options.elevenlabs() ?? (await localTtsReady() ? options.local() : null);
}
