import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { detectModel, hubDirectory, modelVenv } from "../companion/model-manager";
import { runNativeProcess } from "../companion/process";
import { catalogModel } from "../local-models";

const execFileAsync = promisify(execFile);
export type TtsProvider = "fish" | "elevenlabs" | "local";
/** Eleven v3 steers delivery with audio tags like [excited]; Fish S2 takes the same bracketed natural-language tags. */
export const speechModel = "eleven_v3";
export const defaultVoiceId = "21m00Tcm4TlvDq8ikWAM";
export const fishModel = "s2-pro";
/** The on-device voice model and speaker come from the reviewed catalog (lib/studio/local-models.ts); the Mac installs it from Settings -> Local models. */
const localEntry = catalogModel("qwen3-tts-0.6b-4bit")!;
export const localModel = localEntry.repo;
const idPattern = /^[A-Za-z0-9_-]{6,64}$/;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

/** The project's own `.env`, found from any worktree or throwaway checkout by following `.git` back to the original project folder.
 * STUDIO_ENV_FILE overrides it. Real environment variables win over the file. */
export function projectEnvFile(start = __dirname, env: NodeJS.ProcessEnv = process.env): string {
  if (env.STUDIO_ENV_FILE) return env.STUDIO_ENV_FILE;
  for (let dir = start; ; dir = dirname(dir)) {
    const git = join(dir, ".git");
    if (existsSync(git)) {
      if (statSync(git).isDirectory()) return join(dir, ".env");
      const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(git, "utf8"))?.[1]?.trim();   // worktree: <main>/.git/worktrees/<name>
      const common = pointer && /^(.*)[\\/]\.git[\\/]worktrees[\\/]/.exec(pointer)?.[1];
      return join(common || dir, ".env");
    }
    if (dirname(dir) === dir) return join(homedir(), ".env");
  }
}
export const keysFile = () => projectEnvFile();
export const keysFileTemplate = `
# Studio script-to-video voice engines (read by the Mac companion; never sent to the web server).
# STUDIO_TTS_PROVIDER: fish, elevenlabs or local. Empty = first with a key (fish, then elevenlabs, then on-device).
STUDIO_TTS_PROVIDER=
# Fish Audio key: fish.audio -> Dashboard -> API Keys. FISH_VOICE_ID (optional) is a voice id from the Fish library.
FISH_API_KEY=
FISH_VOICE_ID=
# ElevenLabs key (needs the text_to_speech permission). ELEVENLABS_VOICE_ID is optional.
ELEVENLABS_API_KEY=
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
  for (const k of ["STUDIO_TTS_PROVIDER", "FISH_API_KEY", "FISH_VOICE_ID", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "STUDIO_FISH_MODEL", "STUDIO_LOCAL_TTS_MODEL", "STUDIO_LOCAL_TTS_VOICE"]) if (env[k]?.trim()) merged[k] = env[k]!.trim();
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

const venvPython = (home = homedir()) => join(modelVenv(home), "bin", "python");
export async function localTtsReady(python = venvPython(), hub = hubDirectory()): Promise<boolean> {
  if (!await detectModel(localEntry, hub)) return false;   // the runtime alone is not enough: the model must be installed
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
export async function synthesizeLocal({ text, model = localModel, voice = localEntry.defaultVoice ?? "ryan", python = venvPython(), signal }: { text: string; model?: string; voice?: string; python?: string; signal?: AbortSignal }): Promise<Buffer> {
  if (!modelPattern.test(model) || !/^[a-z_]{2,20}$/.test(voice)) throw new Error("invalid_model"); checkText(text);
  const dir = await mkdtemp(join(tmpdir(), "studio-tts-"));
  try {
    await execFileAsync(python, ["-m", "mlx_audio.tts.generate", "--model", model, "--voice", voice, "--text", text, "--output_path", dir, "--file_prefix", "speech", "--audio_format", "mp3", "--lang_code", "a"], { timeout: 10 * 60_000, signal, maxBuffer: 1 << 20 });
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
    local: () => ({ provider: "local", label: "On-device Qwen3-TTS", speak: (text, signal) => synthesizeLocal({ text, model: k.STUDIO_LOCAL_TTS_MODEL, voice: k.STUDIO_LOCAL_TTS_VOICE, signal }) }),
  };
  const wanted = k.STUDIO_TTS_PROVIDER as TtsProvider | undefined;
  if (wanted) return Object.hasOwn(options, wanted) ? options[wanted]() : null;
  return options.fish() ?? options.elevenlabs() ?? (await localTtsReady() ? options.local() : null);
}
