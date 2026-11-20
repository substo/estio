import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNativeProcess, type ProcessRunner } from "./process";

/** Where the companion keeps its own yt-dlp / Parakeet environment (see scripts/studio-companion-install-transcription.sh). */
export const transcriptionRoot = (home = homedir()) => join(home, "Library", "Application Support", "Estio", "StudioCompanion", "transcription");
const here = dirname(fileURLToPath(import.meta.url));
export const mediaScripts = { transcribe: join(here, "media", "transcribe-local.py"), frames: join(here, "media", "extract-frames.py") };

export const MAX_VIDEO_SECONDS = 7200;
export interface TimedSegment { start: number; end: number; text: string }
export interface VisualFrame { time: number; sceneStart: number; sceneEnd: number; ocr: string; audioContext: string }
export interface MediaTranscript {
  method: "local-parakeet-tdt-v3" | "youtube-captions-fallback"; text: string; segments: TimedSegment[]; language: string;
  frames: VisualFrame[]; visualError: string; localError: string; durationSeconds?: number;
}
export interface MediaTools { ytdlp: string; python: string }
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
/** Only a canonical watch URL built from a validated 11-character id is ever handed to yt-dlp. */
export function canonicalYoutubeUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 2000) return null;
  let url: URL; try { url = new URL(input.trim()); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com") id = url.pathname === "/watch" ? url.searchParams.get("v") : /^\/(?:shorts|embed|live)\//.test(url.pathname) ? url.pathname.split("/")[2] : null;
  return id && YOUTUBE_ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}
export function resolveMediaTools(home = homedir()): MediaTools {
  const root = transcriptionRoot(home);
  return { ytdlp: join(root, "bin", "yt-dlp"), python: join(root, "bin", "python") };
}
/** Probe the dedicated environment. Reports only versions and missing tool names, never paths. */
export async function probeTranscriptionTools(run: ProcessRunner = runNativeProcess, tools = resolveMediaTools()) {
  const quiet = async (command: string, args: string[]) => { try { return (await run({ command, args, cwd: tmpdir(), timeoutMs: 15_000 })).stdout; } catch { return ""; } };
  const [yt, ff, tess, parakeet] = await Promise.all([
    quiet(tools.ytdlp, ["--version"]), quiet("ffmpeg", ["-version"]), quiet("tesseract", ["--version"]),
    quiet(tools.python, ["-I", "-c", "import importlib.metadata as m; print(m.version('parakeet-mlx'))"])]);
  const ver = (t: string) => t.match(/\b\d+\.\d+(?:\.\d+)?\b/)?.[0];
  const runtimes: Record<string, string> = {};
  if (ver(yt)) runtimes.ytdlp = ver(yt)!; if (ver(tess)) runtimes.tesseract = ver(tess)!; if (ver(parakeet)) runtimes.parakeet = ver(parakeet)!;
  const missing = [!ver(yt) && "yt-dlp", !ff && "ffmpeg", !ver(parakeet) && "parakeet-mlx"].filter(Boolean) as string[];
  return { ready: missing.length === 0, missing, runtimes };
}

/** json3 caption events → timed segments (the archived Substo fallback). */
export function captionsFromJson3(data: unknown): { text: string; segments: TimedSegment[] } {
  const events = Array.isArray((data as { events?: unknown })?.events) ? (data as { events: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }> }).events : [];
  const segments: TimedSegment[] = [];
  for (const e of events) {
    const text = (e.segs ?? []).map(s => s.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
    if (!text || typeof e.tStartMs !== "number") continue;
    segments.push({ start: e.tStartMs / 1000, end: (e.tStartMs + (e.dDurationMs ?? 0)) / 1000, text });
  }
  return { text: segments.map(s => s.text).join(" ").trim(), segments };
}
export const timedText = (segments: TimedSegment[]) => segments.map(s => `${s.start.toFixed(1)} ${s.text}`).join("\n");
/** Compact OCR notes: each distinct visual state with its time and what was being said nearby. Marked as machine OCR. */
export function visualNotes(frames: VisualFrame[], limit = 20_000): string {
  const lines = frames.filter(f => f.ocr.trim().length >= 4).map(f => `[${f.time.toFixed(0)}s] On screen (OCR): ${f.ocr.trim()}${f.audioContext ? `\n  Spoken nearby: ${f.audioContext.slice(0, 300)}` : ""}`);
  let out = ""; for (const line of lines) { if (out.length + line.length + 1 > limit) break; out += (out ? "\n" : "") + line; }
  return out;
}
const withContext = (frames: Array<Omit<VisualFrame, "audioContext">>, segments: TimedSegment[]): VisualFrame[] => frames.map(f => ({ ...f,
  ocr: String(f.ocr ?? "").slice(0, 1200),
  audioContext: segments.filter(s => s.end >= f.time - 15 && s.start <= f.time + 15).map(s => s.text).join(" ").slice(0, 1000) }));

export interface MediaDeps { run: ProcessRunner; tools: MediaTools; tmp?: string; signal?: AbortSignal; progress?: () => void }
/**
 * Download audio, transcribe with the local Parakeet model, fall back to platform captions, then scan video for slide/scene
 * states and OCR them against the speech. Visual notes are best effort and never block a transcript.
 */
export async function transcribeYoutube(url: string, deps: MediaDeps): Promise<MediaTranscript> {
  const canonical = canonicalYoutubeUrl(url); if (!canonical) throw new Error("invalid_video_url");
  const { run, tools, signal } = deps;
  await mkdir(deps.tmp ?? tmpdir(), { recursive: true });
  const work = await mkdtemp(join(deps.tmp ?? tmpdir(), "studio-transcribe-"));
  const call = (command: string, args: string[], timeoutMs: number) => { deps.progress?.(); return run({ command, args, cwd: work, signal, timeoutMs, maxOutputBytes: 1 << 20 }); };
  let localError = ""; let result: { text: string; segments: TimedSegment[]; language: string; method: MediaTranscript["method"] } | undefined;
  try {
    try {
      await call(tools.ytdlp, ["--quiet", "--no-warnings", "--no-progress", "--no-playlist", "--match-filter", `duration < ${MAX_VIDEO_SECONDS}`, "--max-filesize", "500M",
        "-f", "bestaudio", "-x", "--audio-format", "mp3", "--audio-quality", "0", "-o", join(work, "source.%(ext)s"), canonical], 20 * 60_000);
      const audio = (await readdir(work)).find(n => n.endsWith(".mp3")); if (!audio) throw new Error("audio_missing");
      const out = join(work, "transcript.json");
      await call(tools.python, ["-I", mediaScripts.transcribe, join(work, audio), out], 60 * 60_000);
      const parsed = JSON.parse(await readFile(out, "utf8")) as { text?: string; segments?: TimedSegment[]; language?: string };
      if (!parsed.text?.trim()) throw new Error("empty_transcript");
      result = { text: parsed.text.trim(), segments: parsed.segments ?? [], language: parsed.language ?? "", method: "local-parakeet-tdt-v3" };
    } catch (error) { if (signal?.aborted) throw error; result = undefined; localError = String((error as Error)?.message ?? error).slice(-300); }
    if (!result) {
      await call(tools.ytdlp, ["--quiet", "--no-warnings", "--no-playlist", "--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", "en.*", "--sub-format", "json3", "-o", join(work, "captions.%(ext)s"), canonical], 3 * 60_000);
      const file = (await readdir(work)).find(n => n.endsWith(".json3")); if (!file) throw new Error(`no_transcript_available: ${localError}`);
      const caps = captionsFromJson3(JSON.parse(await readFile(join(work, file), "utf8"))); if (!caps.text) throw new Error("captions_empty");
      result = { ...caps, language: "en", method: "youtube-captions-fallback" };
    }
    let frames: VisualFrame[] = []; let visualError = ""; let durationSeconds: number | undefined;
    try {
      await call(tools.ytdlp, ["--quiet", "--no-warnings", "--no-progress", "--no-playlist", "--match-filter", `duration < ${MAX_VIDEO_SECONDS}`, "--max-filesize", "500M",
        "-f", "bv*[height<=480]+ba/b[height<=480]", "--merge-output-format", "mp4", "-o", join(work, "video.%(ext)s"), canonical], 30 * 60_000);
      const video = (await readdir(work)).find(n => /^video\./.test(n)); if (!video) throw new Error("video_missing");
      const out = join(work, "frames.json");
      await call("python3", ["-I", mediaScripts.frames, join(work, video), join(work, "frames"), out], 20 * 60_000);
      const parsed = JSON.parse(await readFile(out, "utf8")) as { duration?: number; frames?: Array<Omit<VisualFrame, "audioContext">> };
      frames = withContext(parsed.frames ?? [], result.segments); durationSeconds = parsed.duration;
    } catch (error) { if (signal?.aborted) throw error; visualError = String((error as Error)?.message ?? error).slice(-300); }
    return { ...result, frames, visualError, localError, durationSeconds };
  } finally { await rm(work, { recursive: true, force: true }); }
}

/** Public title/description/channel for the relevance check, read on the Mac so nothing from the platform API is stored server-side. */
export async function youtubeMetadata(url: string, deps: MediaDeps): Promise<{ title: string; description: string; channel: string } | null> {
  const canonical = canonicalYoutubeUrl(url); if (!canonical) return null;
  try {
    const { stdout } = await deps.run({ command: deps.tools.ytdlp, args: ["--quiet", "--no-warnings", "--no-playlist", "--skip-download", "--print", "%(.{title,channel,description})j", canonical],
      cwd: deps.tmp ?? tmpdir(), signal: deps.signal, timeoutMs: 60_000, maxOutputBytes: 512 * 1024 });
    const parsed = JSON.parse(stdout.trim().split("\n")[0]) as Record<string, unknown>;
    const str = (v: unknown, n: number) => typeof v === "string" ? v.slice(0, n) : "";
    return { title: str(parsed.title, 300), description: str(parsed.description, 4000), channel: str(parsed.channel, 200) };
  } catch { return null; }
}
