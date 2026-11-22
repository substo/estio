import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { runNativeProcess, type ProcessRunner } from "../companion/process";
import { buildBrief } from "./brief";
import { parseScript } from "./script";
import { elevenLabsKey, synthesizeSpeech } from "./tts";

const videoExtensions = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".mp3", ".wav", ".m4a"]);
export interface AssembleOptions {
  script: string; clipsDir: string; projectDir: string; editorDocs: string;
  orientation?: "landscape" | "portrait"; voiceover?: boolean; music?: boolean; voiceId?: string; model?: string; dryRun?: boolean;
  run?: ProcessRunner; speak?: typeof synthesizeSpeech; log?: (line: string) => void; signal?: AbortSignal;
}
export interface AssembleResult { projectDir: string; beats: number; clips: string[]; voiceFiles: string[]; timings: number[]; brief: string; agentOutput?: string }
const BEAT_GAP = 0.35;
async function durationOf(file: string, run: ProcessRunner, cwd: string): Promise<number> {
  const { stdout } = await run({ command: "ffprobe", args: ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], cwd, timeoutMs: 30_000, maxOutputBytes: 1024, env: { PATH: `${process.env.PATH ?? ""}:/opt/homebrew/bin` } });
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("voiceover_duration_unreadable");
  return seconds;
}

/** Script + shot footage in, an edited and exported video out. Voiceover is generated (ElevenLabs v3) unless the footage already carries the narration. */
export async function assembleVideo(o: AssembleOptions): Promise<AssembleResult> {
  const log = o.log ?? (() => {}), run = o.run ?? runNativeProcess, speak = o.speak ?? synthesizeSpeech;
  const beats = parseScript(o.script);
  if (!beats.length) throw new Error("The script has no spoken paragraphs.");
  const sources = (await readdir(o.clipsDir)).filter(f => !f.startsWith(".") && videoExtensions.has(extname(f).toLowerCase())).sort();
  if (!sources.length && !o.voiceover) throw new Error("No footage found and voiceover is off.");
  await mkdir(o.projectDir, { recursive: true });
  const clips: string[] = [];
  for (const f of sources) { await copyFile(join(o.clipsDir, f), join(o.projectDir, f)); clips.push(f); }

  const voiceFiles: string[] = [];
  if (o.voiceover) {
    const key = await elevenLabsKey();
    if (!key && !o.dryRun) throw new Error("No ElevenLabs key: add it to Keychain service `elevenlabs` or set ELEVENLABS_API_KEY.");
    for (const b of beats) {
      const name = `voice-${String(b.index).padStart(2, "0")}.mp3`;
      if (!o.dryRun) { log(`Voicing beat ${b.index}/${beats.length}`); await writeFile(join(o.projectDir, name), await speak({ text: b.narration, apiKey: key!, voiceId: o.voiceId, signal: o.signal })); }
      voiceFiles.push(name);
    }
  }
  /** Where each voiced beat starts on the timeline, so captions and titles can be placed even where the editor can't transcribe (it needs macOS 26). */
  const timings: number[] = []; let at = 0;
  if (!o.dryRun) for (const f of voiceFiles) { timings.push(Number(at.toFixed(2))); at += await durationOf(join(o.projectDir, f), run, o.projectDir) + BEAT_GAP; }
  const cwd = o.projectDir, env = { HOME: process.env.HOME, USER: process.env.USER, TMPDIR: process.env.TMPDIR, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, PATH: `${process.env.PATH ?? ""}:${process.env.HOME ?? ""}/.local/bin` };
  if (!o.dryRun) await run({ command: "substo", args: ["new", "Video.substo", ...(o.orientation === "portrait" ? ["--portrait"] : [])], cwd, env, timeoutMs: 120_000, maxOutputBytes: 64 * 1024, signal: o.signal });
  const brief = buildBrief({ editorDocs: o.editorDocs, orientation: o.orientation ?? "landscape", beats, voiceFiles, timings, clips, hasVoiceover: Boolean(o.voiceover), music: o.music ?? false });
  if (o.dryRun) return { projectDir: o.projectDir, beats: beats.length, clips, voiceFiles, timings, brief };
  log("Editing with the agent");
  const agent = await run({ command: "claude", cwd, env, signal: o.signal, timeoutMs: 45 * 60_000, maxOutputBytes: 512 * 1024, input: brief,
    args: ["-p", ...(o.model ? ["--model", o.model] : []), "--permission-mode", "dontAsk", "--allowedTools", "Bash(substo:*),Read", "--add-dir", o.editorDocs, "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--no-session-persistence"] });
  return { projectDir: o.projectDir, beats: beats.length, clips, voiceFiles, timings, brief, agentOutput: agent.stdout };
}
