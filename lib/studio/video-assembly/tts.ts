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
/** Zero-shot cloning uses the Base checkpoint (no built-in speakers): a reference clip and its transcript, both kept on this Mac. */
const cloneEntry = catalogModel("qwen3-tts-0.6b-base-4bit")!;
export const cloneModel = cloneEntry.repo;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

/** Hosted voices (Fish, ElevenLabs) are rendered on the server with the Location's own key (lib/studio/voices). Only the on-device engine lives on the Mac. */
export interface SpeechEngine { label: string; speak(text: string, signal?: AbortSignal): Promise<Buffer> }

const venvPython = (home = homedir()) => join(modelVenv(home), "bin", "python");
export async function localTtsReady(python = venvPython(), hub = hubDirectory()): Promise<boolean> {
  if (!await detectModel(localEntry, hub)) return false;   // the runtime alone is not enough: the model must be installed
  try { await execFileAsync(python, ["-c", "import mlx_audio"], { timeout: 30_000 }); return true; } catch { return false; }
}

export async function localCloneReady(python = venvPython(), hub = hubDirectory()): Promise<boolean> {
  if (!await detectModel(cloneEntry, hub)) return false;
  try { await execFileAsync(python, ["-c", "import mlx_audio"], { timeout: 30_000 }); return true; } catch { return false; }
}
/** Qwen3-TTS makes about 12.5 tokens a second and people speak about 2.6 words a second, so 5 tokens a word is natural pace. Twice that, plus a little, leaves room for slow speech but stops a run that never ends (a 3 second sentence once produced 11 minutes of audio and 15 GB of memory). */
export const ttsMaxTokens = (text: string) => Math.min(9000, Math.max(100, text.trim().split(/\s+/).filter(Boolean).length * 10 + 60));
/** Speak with an on-device cloned voice: mlx-audio's --ref_audio/--ref_text zero-shot cloning on the Base model. The transcript must be the exact words in the reference. */
export async function synthesizeLocalClone({ text, refAudio, refText, model = cloneModel, python = venvPython(), signal }: { text: string; refAudio: string; refText: string; model?: string; python?: string; signal?: AbortSignal }): Promise<Buffer> {
  if (!modelPattern.test(model)) throw new Error("invalid_model");
  if (!text.trim() || text.length > 4500 || !refText.trim() || refText.length > 1500) throw new Error("invalid_speech_text");
  const dir = await mkdtemp(join(tmpdir(), "studio-tts-"));
  try {
    await execFileAsync(python, ["-m", "mlx_audio.tts.generate", "--model", model, "--text", text, "--max_tokens", String(ttsMaxTokens(text)), "--ref_audio", refAudio, "--ref_text", refText, "--output_path", dir, "--file_prefix", "speech", "--audio_format", "mp3", "--lang_code", "a"], { timeout: 10 * 60_000, signal, maxBuffer: 1 << 20 });
    const file = (await readdir(dir)).find(f => f.startsWith("speech") && f.endsWith(".mp3"));
    if (!file) throw new Error("local_tts_no_output");
    const bytes = await readFile(join(dir, file));
    if (bytes.length < 1000) throw new Error("local_tts_empty_audio");
    return bytes;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
export const localCloneSpeech = (refAudio: string, refText: string): SpeechEngine => ({ label: "On-device cloned voice", speak: (text, signal) => synthesizeLocalClone({ text, refAudio, refText, signal }) });

/** On-device Qwen3-TTS through mlx-audio in the companion's own venv. No network after the model is cached. */
export async function synthesizeLocal({ text, model = localModel, voice = localEntry.defaultVoice ?? "ryan", python = venvPython(), signal }: { text: string; model?: string; voice?: string; python?: string; signal?: AbortSignal }): Promise<Buffer> {
  if (!modelPattern.test(model) || !/^[a-z_]{2,20}$/.test(voice)) throw new Error("invalid_model");
  if (!text.trim() || text.length > 4500) throw new Error("invalid_speech_text");
  const dir = await mkdtemp(join(tmpdir(), "studio-tts-"));
  try {
    await execFileAsync(python, ["-m", "mlx_audio.tts.generate", "--model", model, "--voice", voice, "--text", text, "--max_tokens", String(ttsMaxTokens(text)), "--output_path", dir, "--file_prefix", "speech", "--audio_format", "mp3", "--lang_code", "a"], { timeout: 10 * 60_000, signal, maxBuffer: 1 << 20 });
    const file = (await readdir(dir)).find(f => f.startsWith("speech") && f.endsWith(".mp3"));
    if (!file) throw new Error("local_tts_no_output");
    const bytes = await readFile(join(dir, file));
    if (bytes.length < 1000) throw new Error("local_tts_empty_audio");
    return bytes;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
export const localSpeech = (voice: string, model = localModel): SpeechEngine => ({ label: "On-device Qwen3-TTS", speak: (text, signal) => synthesizeLocal({ text, model, voice, signal }) });
