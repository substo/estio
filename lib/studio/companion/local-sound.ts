import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runNativeProcess, type ProcessRunner } from "./process";
import { videoProcessEnvironment, type VideoTools } from "./video-tools";

export type SoundRole = "music" | "sfx";
/** Rough spoken length of a script in seconds (about 2.5 words a second plus a lead-in and tail), so the bed covers the video. */
export function soundSeconds(narrationWords: number): number {
  return Math.min(180, Math.max(30, Math.ceil(narrationWords / 2.5) + 6));
}
/** The music bed and the whoosh are made on this Mac: a small deterministic synth (numpy) then ffmpeg to MP3 at a steady loudness. No model, no network, no key. */
export function createLocalSoundMaker(deps: { tools: () => Promise<VideoTools>; scriptsDir: string; run?: ProcessRunner; tmpRoot?: string }) {
  const run = deps.run ?? runNativeProcess;
  return async (role: SoundRole, seconds: number, outFile: string, signal?: AbortSignal): Promise<boolean> => {
    const tools = await deps.tools();
    const { ffmpeg } = tools.paths;
    const python = tools.paths.python ?? "python3";
    if (!ffmpeg) return false;
    const dir = await mkdtemp(join(deps.tmpRoot ?? tmpdir(), "studio-sound-"));
    const env = { ...process.env, ...videoProcessEnvironment(tools) };
    try {
      const wav = join(dir, "s.wav");
      const script = resolve(deps.scriptsDir, "synth-sound.py");
      await run({ command: python, args: role === "music" ? ["-I", script, "music", wav, String(Math.round(Math.min(600, Math.max(5, seconds))))] : ["-I", script, "sfx", wav], cwd: dir, signal, timeoutMs: 5 * 60_000, maxOutputBytes: 16 * 1024, env });
      const target = role === "music" ? "loudnorm=I=-18:TP=-2:LRA=7" : "loudnorm=I=-20:TP=-2";
      await run({ command: ffmpeg, args: ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-af", target, "-ar", "44100", "-b:a", "128k", outFile], cwd: dir, signal, timeoutMs: 2 * 60_000, maxOutputBytes: 8192 });
      return true;
    } catch { if (signal?.aborted) throw new Error("aborted"); return false; }   // a missing sound only costs the video that sound
    finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  };
}
export type LocalSoundMaker = ReturnType<typeof createLocalSoundMaker>;
