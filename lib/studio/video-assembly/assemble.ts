import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { runNativeProcess, type ProcessRunner } from "../companion/process";
import { buildBrief } from "./brief";
import { parseScriptTimeline } from "./script";
import { prepareSourceQuotes } from "./source-quotes";
import { MAX_SOURCE_QUOTES } from "../script-source-quotes";
import { agentEnv, runEditingAgent } from "./agent";
import { localCloneSpeech, localSpeech, type SpeechEngine } from "./tts";

const videoExtensions = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".mp3", ".wav", ".m4a"]);
export interface AssembleOptions {
  script: string; clipsDir: string; footageNames?: ReadonlyMap<string, string>; projectDir: string; editorDocs: string;
  /** The project file inside projectDir (a revision of the same piece gets the next free name). */ projectFile?: string;
  orientation?: "landscape" | "portrait"; voiceover?: boolean; music?: boolean; model?: string; dryRun?: boolean;
  run?: ProcessRunner;
  /** Music bed and whoosh the server already rendered (file names inside clipsDir). They are copied into the project beside the voice files and never treated as footage. */
  sounds?: { music?: string; sfx?: string };
  /** File name (in clipsDir) of the creator's storyboard photo, if they saved one. */
  avatar?: string;
  /** Storyboard frames the Mac drew, by beat number (file names in clipsDir): used for that beat's placeholder instead of the plain photo. */
  frames?: string[];
  /** The look of titles and callouts (Clean when absent). */
  motion?: import("./motion-style").MotionChoice;
  /** Timed speech in a footage file (file time, seconds), made on this Mac when the editor cannot transcribe. */
  transcribeFootage?: (file: string, signal?: AbortSignal) => Promise<{ start: number; end: number; text: string }[] | null>;
  /** Who narrates when voiceover is on: the on-device engine, or narration the server already rendered with the Location's key (files in clipsDir, in beat order). */
  voice?: { engine: "local"; speaker?: string; model?: string; /** An on-device clone: the reference recording and its exact transcript, both on this Mac. */ reference?: { audio: string; text: string } } | { engine: "prerendered"; files: string[] };
  /** Test seam. */ speak?: SpeechEngine; log?: (line: string) => void; signal?: AbortSignal;
}
export interface AssembleResult { projectDir: string; projectFile: string; beats: number; clips: string[]; voiceFiles: string[]; timings: number[]; brief: string; agentOutput?: string }
const BEAT_GAP = 0.35;
async function durationOf(file: string, run: ProcessRunner, cwd: string): Promise<number> {
  const { stdout } = await run({ command: "ffprobe", args: ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], cwd, timeoutMs: 30_000, maxOutputBytes: 1024, env: { PATH: `${process.env.PATH ?? ""}:/opt/homebrew/bin` } });
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("voiceover_duration_unreadable");
  return seconds;
}

/** Script + shot footage in, an edited and exported video out. Voiceover is generated (rendered on the server with the Location key, or on-device) unless the footage already carries the narration. */
export async function assembleVideo(o: AssembleOptions): Promise<AssembleResult> {
  const log = o.log ?? (() => {}), run = o.run ?? runNativeProcess, projectFile = o.projectFile ?? "Video.substo";
  const { beats, quotes } = parseScriptTimeline(o.script);
  if (quotes.length > MAX_SOURCE_QUOTES) throw new Error(`Use at most ${MAX_SOURCE_QUOTES} source clips in one script.`);
  if (!beats.length) throw new Error("The script has no spoken paragraphs.");
  const narration = new Set([...(o.voice?.engine === "prerendered" ? o.voice.files : []), ...[o.sounds?.music, o.sounds?.sfx].filter((f): f is string => Boolean(f))]);
  const sources = (await readdir(o.clipsDir)).filter(f => !f.startsWith(".") && !narration.has(f) && videoExtensions.has(extname(f).toLowerCase())).sort();
  if (!sources.length && !o.voiceover) throw new Error("No footage found and voiceover is off.");
  await mkdir(o.projectDir, { recursive: true });
  const prepared = await prepareSourceQuotes({ quotes, names: o.footageNames, files: new Set(sources),
    clipsDir: o.clipsDir, projectDir: o.projectDir, run, signal: o.signal, dryRun: o.dryRun });
  const clips: string[] = [];
  for (const f of sources) { if (prepared.quotedFiles.has(f)) continue; await copyFile(join(o.clipsDir, f), join(o.projectDir, f)); clips.push(f); }

  const soundFiles: { music?: string; sfx?: string } = {};
  const avatarFile = o.avatar && /^storyboard-avatar\.(jpg|png|webp)$/.test(o.avatar) ? o.avatar : undefined;
  if (avatarFile && !o.dryRun) await copyFile(join(o.clipsDir, avatarFile), join(o.projectDir, avatarFile));
  const frameFiles = (o.frames ?? []).map(f => f && /^storyboard-frame-\d{1,2}\.png$/.test(f) ? f : "");
  if (!o.dryRun) for (const f of frameFiles) if (f) await copyFile(join(o.clipsDir, f), join(o.projectDir, f));
  if (!o.dryRun) for (const role of ["music", "sfx"] as const) { const f = o.sounds?.[role]; if (f && o.music !== false) { await copyFile(join(o.clipsDir, f), join(o.projectDir, f)); soundFiles[role] = f; } }
  const voiceFiles: string[] = [];
  if (o.voiceover) {
    if (!o.voice && !o.speak) throw new Error("Choose a voice for the voiceover.");
    if (o.voice?.engine === "prerendered" && o.voice.files.length !== beats.length) throw new Error("The rendered narration does not match the script. Make the video again.");
    const engine = o.speak ?? (o.voice?.engine === "local" ? (o.voice.reference ? localCloneSpeech(o.voice.reference.audio, o.voice.reference.text) : localSpeech(o.voice.speaker ?? "ryan", o.voice.model)) : null);
    for (const b of beats) {
      const name = `voice-${String(b.index).padStart(2, "0")}.mp3`;
      if (!o.dryRun) {
        if (engine) { log(`Voicing beat ${b.index}/${beats.length} (${engine.label})`); await writeFile(join(o.projectDir, name), await engine.speak(b.narration, o.signal)); }
        else await copyFile(join(o.clipsDir, (o.voice as { files: string[] }).files[b.index - 1]), join(o.projectDir, name));
      }
      voiceFiles.push(name);
    }
  }
  /** Where each voiced beat starts on the timeline, so captions and titles can be placed even where the editor can't transcribe (it needs macOS 26). */
  const timings: number[] = []; let at = 0;
  if (!o.dryRun) for (const f of voiceFiles) { const beforeBeat = timings.length + 1;
    at += prepared.quotes.filter(quote => quote.beforeBeat === beforeBeat).reduce((total, quote) => total + quote.seconds, 0);
    timings.push(Number(at.toFixed(2))); at += await durationOf(join(o.projectDir, f), run, o.projectDir) + BEAT_GAP; }
  const cwd = o.projectDir, env = agentEnv();
  if (!o.dryRun) await run({ command: "substo", args: ["new", projectFile, ...(o.orientation === "portrait" ? ["--portrait"] : [])], cwd, env, timeoutMs: 120_000, maxOutputBytes: 64 * 1024, signal: o.signal });
  const footageTranscripts: { file: string; lines: string }[] = [];
  if (o.transcribeFootage && !o.dryRun) for (const f of clips) {
    if (!/\.(mp4|mov|m4v|mkv|webm|mp3|wav|m4a)$/i.test(f)) continue;
    log(`Transcribing ${f}`);
    const segments = await o.transcribeFootage(join(o.projectDir, f), o.signal).catch(() => null);
    if (segments?.length) footageTranscripts.push({ file: f, lines: segments.map(x => `${x.start.toFixed(1)}-${x.end.toFixed(1)} ${x.text}`).join("\n").slice(0, 6000) });
  }
  const brief = buildBrief({ footageTranscripts, projectFile, editorDocs: o.editorDocs, orientation: o.orientation ?? "landscape", beats, voiceFiles, timings, clips, sourceQuotes: prepared.quotes, hasVoiceover: Boolean(o.voiceover), music: o.music ?? false, soundFiles, avatarFile, ...(frameFiles.some(Boolean) ? { frameFiles } : {}), ...(o.motion ? { motion: o.motion } : {}) });
  if (o.dryRun) return { projectDir: o.projectDir, projectFile, beats: beats.length, clips, voiceFiles, timings, brief };
  log("Editing with the agent");
  const agentOutput = await runEditingAgent({ cwd, brief, editorDocs: o.editorDocs, model: o.model, run, signal: o.signal });
  return { projectDir: o.projectDir, projectFile, beats: beats.length, clips, voiceFiles, timings, brief, agentOutput };
}
