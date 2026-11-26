import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runNativeProcess, type ProcessRunner } from "./process";
import { videoProcessEnvironment, type VideoTools } from "./video-tools";
import { measureCompanionFeature } from "./metrics";

export type SoundRole = "music" | "sfx";
/** Rough spoken length of a script in seconds (about 2.5 words a second plus a lead-in and tail), so the bed covers the video. */
export function soundSeconds(narrationWords: number): number {
  return Math.min(180, Math.max(30, Math.ceil(narrationWords / 2.5) + 6));
}
const modelPrompt: Record<SoundRole, string> = {
  music: "Calm, modern instrumental background music for a creator video. Soft pulse, light piano and warm pads, no vocals, steady energy, leaves room for a spoken voiceover.",
  sfx: "A soft, short whoosh transition sound, smooth air swoosh, clean, no music",
};
/** The longest bed the Stable Audio 3 Small model makes in one go; a longer video loops the bed (with a closing fade). */
export const MODEL_MAX_SECONDS = 120;
/** ffmpeg filter for a model-made file: loop to the wanted length when it is shorter, fade the tail of music, then a steady loudness. */
export function modelFilter(role: SoundRole, wantSeconds: number, haveSeconds: number): string {
  const loudness = role === "music" ? "loudnorm=I=-18:TP=-2:LRA=7" : "loudnorm=I=-20:TP=-2";
  if (role === "sfx") return loudness;
  const want = Math.round(Math.max(5, wantSeconds));
  const loop = haveSeconds + 0.5 < want ? `aloop=loop=-1:size=2147483647,atrim=0:${want},` : "";
  return `${loop}afade=t=out:st=${Math.max(0, want - 2)}:d=2,${loudness}`;
}
/** The music bed and the whoosh are made on this Mac: with an installed Stable Audio 3 Small model when there is one, otherwise a small deterministic synth (numpy); then ffmpeg to MP3 at a steady loudness. No network, no key. */
export function createLocalSoundMaker(deps: { tools: () => Promise<VideoTools>; scriptsDir: string; run?: ProcessRunner; tmpRoot?: string;
  /** The Hugging Face repo of the installed model for this role (fixed catalog value), or null when it is not installed. */
  model?: (role: SoundRole) => Promise<string | null>; modelPython?: string }) {
  const run = deps.run ?? runNativeProcess;
  return async (role: SoundRole, seconds: number, outFile: string, signal?: AbortSignal): Promise<boolean> => measureCompanionFeature(role === "music" ? "music" : "sound_effects", async () => {
    const tools = await deps.tools();
    const { ffmpeg } = tools.paths;
    const python = tools.paths.python ?? "python3";
    if (!ffmpeg) return false;
    const dir = await mkdtemp(join(deps.tmpRoot ?? tmpdir(), "studio-sound-"));
    const env = { ...process.env, ...videoProcessEnvironment(tools) };
    try {
      const wav = join(dir, "s.wav");
      const repo = deps.model ? await deps.model(role).catch(() => null) : null;
      if (repo && deps.modelPython) {
        const want = role === "music" ? Math.min(MODEL_MAX_SECONDS, Math.max(5, seconds)) : 1.5;
        try {
          await run({ command: deps.modelPython, args: ["-m", "mlx_audio.music.generate", "--model", repo, "--caption", modelPrompt[role], "--duration", String(want), "--output", wav], cwd: dir, signal, timeoutMs: 20 * 60_000, maxOutputBytes: 16_384, env });
          await run({ command: ffmpeg, args: ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-af", modelFilter(role, seconds, want), "-ar", "44100", "-b:a", "128k", outFile], cwd: dir, signal, timeoutMs: 2 * 60_000, maxOutputBytes: 8192 });
          return true;
        } catch { if (signal?.aborted) throw new Error("aborted"); /* the model failed (memory, a bad cache): the synth below still makes a usable sound */ }
      }
      const script = resolve(deps.scriptsDir, "synth-sound.py");
      await run({ command: python, args: role === "music" ? ["-I", script, "music", wav, String(Math.round(Math.min(600, Math.max(5, seconds))))] : ["-I", script, "sfx", wav], cwd: dir, signal, timeoutMs: 5 * 60_000, maxOutputBytes: 16 * 1024, env });
      const target = role === "music" ? "loudnorm=I=-18:TP=-2:LRA=7" : "loudnorm=I=-20:TP=-2";
      await run({ command: ffmpeg, args: ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-af", target, "-ar", "44100", "-b:a", "128k", outFile], cwd: dir, signal, timeoutMs: 2 * 60_000, maxOutputBytes: 8192 });
      return true;
    } catch { if (signal?.aborted) throw new Error("aborted"); return false; }   // a missing sound only costs the video that sound
    finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  }, { unit: "audio_seconds", units: role === "music" ? seconds : 1.5 });
}
export type LocalSoundMaker = ReturnType<typeof createLocalSoundMaker>;
