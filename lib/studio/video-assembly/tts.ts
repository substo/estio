import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { detectModel, hubDirectory, modelVenv } from "../companion/model-manager";
import { catalogModel } from "../local-models";

const execFileAsync = promisify(execFile);
/** Eleven v3 steers delivery with audio tags like [excited]; Fish S2 takes the same bracketed natural-language tags. */
export const speechModel = "eleven_v3";
/** The on-device voice model and speaker come from the reviewed catalog (lib/studio/local-models.ts); the Mac installs it from Settings -> Local models. */
const localEntry = catalogModel("qwen3-tts-0.6b-4bit")!;
export const localModel = localEntry.repo;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

/** Hosted voices (Fish, ElevenLabs) are rendered on the server with the Location's own key (lib/studio/voices). Only the on-device engine lives on the Mac. */
export interface SpeechEngine { label: string; speak(text: string, signal?: AbortSignal): Promise<Buffer> }

const venvPython = (home = homedir()) => join(modelVenv(home), "bin", "python");
export async function localTtsReady(python = venvPython(), hub = hubDirectory()): Promise<boolean> {
  if (!await detectModel(localEntry, hub)) return false;   // the runtime alone is not enough: the model must be installed
  try { await execFileAsync(python, ["-c", "import mlx_audio"], { timeout: 30_000 }); return true; } catch { return false; }
}

/** On-device Qwen3-TTS through mlx-audio in the companion's own venv. No network after the model is cached. */
export async function synthesizeLocal({ text, model = localModel, voice = localEntry.defaultVoice ?? "ryan", python = venvPython(), signal }: { text: string; model?: string; voice?: string; python?: string; signal?: AbortSignal }): Promise<Buffer> {
  if (!modelPattern.test(model) || !/^[a-z_]{2,20}$/.test(voice)) throw new Error("invalid_model");
  if (!text.trim() || text.length > 4500) throw new Error("invalid_speech_text");
  const dir = await mkdtemp(join(tmpdir(), "studio-tts-"));
  try {
    await execFileAsync(python, ["-m", "mlx_audio.tts.generate", "--model", model, "--voice", voice, "--text", text, "--output_path", dir, "--file_prefix", "speech", "--audio_format", "mp3", "--lang_code", "a"], { timeout: 10 * 60_000, signal, maxBuffer: 1 << 20 });
    const file = (await readdir(dir)).find(f => f.startsWith("speech") && f.endsWith(".mp3"));
    if (!file) throw new Error("local_tts_no_output");
    const bytes = await readFile(join(dir, file));
    if (bytes.length < 1000) throw new Error("local_tts_empty_audio");
    return bytes;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
export const localSpeech = (voice: string, model = localModel): SpeechEngine => ({ label: "On-device Qwen3-TTS", speak: (text, signal) => synthesizeLocal({ text, model, voice, signal }) });
