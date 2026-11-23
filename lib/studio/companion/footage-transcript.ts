import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runNativeProcess, type ProcessRunner } from "./process";
import { videoProcessEnvironment, type VideoTools } from "./video-tools";

export interface FootageSegment { start: number; end: number; text: string }
/** Parakeet is offline and private to this Mac. The editor's own transcription needs macOS 26, so the agent gets this timed text in its brief instead. */
export function createFootageTranscriber(deps: { tools: () => Promise<VideoTools>; scriptsDir: string; run?: ProcessRunner; tmpRoot?: string }) {
  const run = deps.run ?? runNativeProcess;
  return async (file: string, signal?: AbortSignal): Promise<FootageSegment[] | null> => {
    const tools = await deps.tools();
    const { python, ffmpeg } = tools.paths;
    if (!python || !ffmpeg || tools.report.tools.model !== "downloaded") return null;   // transcription not set up: the brief says so instead of guessing
    const dir = await mkdtemp(join(deps.tmpRoot ?? tmpdir(), "studio-footage-"));
    const env = { ...process.env, ...videoProcessEnvironment(tools) };
    try {
      await run({ command: ffmpeg, args: ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", join(dir, "a.mp3")], cwd: dir, signal, timeoutMs: 30 * 60_000, maxOutputBytes: 8192 });
      await run({ command: python, args: ["-I", resolve(deps.scriptsDir, "transcribe-local.py"), join(dir, "a.mp3"), join(dir, "t.json")], cwd: dir, signal, timeoutMs: 40 * 60_000, maxOutputBytes: 64 * 1024, env });
      const parsed = JSON.parse(await readFile(join(dir, "t.json"), "utf8")) as { segments?: unknown };
      const list = Array.isArray(parsed.segments) ? parsed.segments : [];
      return list.flatMap(s => {
        const o = s as Partial<FootageSegment>;
        return typeof o.start === "number" && typeof o.end === "number" && typeof o.text === "string" && o.text.trim() && o.end >= o.start
          ? [{ start: Math.round(o.start * 100) / 100, end: Math.round(o.end * 100) / 100, text: o.text.trim().slice(0, 400) }] : [];
      }).slice(0, 3000);
    } catch { if (signal?.aborted) throw new Error("aborted"); return null; }
    finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  };
}
export const transcriptLines = (segments: FootageSegment[], max = 6000) => {
  let out = ""; for (const s of segments) { const line = `${s.start.toFixed(1)}-${s.end.toFixed(1)} ${s.text}\n`; if (out.length + line.length > max) { out += "(transcript truncated)\n"; break; } out += line; }
  return out;
};
