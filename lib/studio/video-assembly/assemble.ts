import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { runNativeProcess, type ProcessRunner } from "../companion/process";
import { buildBrief } from "./brief";
import { buildMotionPassBrief, DEFAULT_MOTION_CHOICE } from "./motion-style";
import { parseScriptTimeline } from "./script";
import { prepareSourceQuotes } from "./source-quotes";
import { MAX_SOURCE_QUOTES } from "../script-source-quotes";
import { soundFromTranscript, soundFromVolume, type ShotSound } from "../shoot/shot-sound";
import { parseShotFileName, shotFilesByBeat, supersededShotFiles } from "../shoot/shots";
import { agentEnv, runEditingAgent } from "./agent";
import { localCloneSpeech, localSpeech, type SpeechEngine } from "./tts";
import { measureCompanionFeature, observeCompanionMetricUnits } from "../companion/metrics";

const videoExtensions = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm", ".mp3", ".wav", ".m4a"]);
export interface AssembleOptions {
  script: string; clipsDir: string; footageNames?: ReadonlyMap<string, string>; projectDir: string; editorDocs: string;
  /** The project file inside projectDir (a revision of the same piece gets the next free name). */ projectFile?: string;
  orientation?: "landscape" | "portrait"; voiceover?: boolean; music?: boolean; model?: string;
  /** The model for the motion-graphics pass. When it differs from `model` the graphics are a separate pass after the first export; otherwise one run does both. */ motionModel?: string; dryRun?: boolean;
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
export interface AssembleResult { /** The models that actually ran (undefined = the Mac's default). */ ran?: { edit?: string; motion?: string }; projectDir: string; projectFile: string; beats: number; clips: string[]; voiceFiles: string[]; timings: number[]; brief: string; agentOutput?: string }
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
  const listed = (await readdir(o.clipsDir)).filter(f => !f.startsWith(".") && !narration.has(f) && videoExtensions.has(extname(f).toLowerCase())).sort();
  const retired = supersededShotFiles(listed);   // a re-shot beat uses only its newest take
  const sources = listed.filter(f => !retired.has(f));
  if (!sources.length && !o.voiceover) throw new Error("No footage found and voiceover is off.");
  await mkdir(o.projectDir, { recursive: true });
  const prepared = await prepareSourceQuotes({ quotes, names: o.footageNames, files: new Set(sources),
    clipsDir: o.clipsDir, projectDir: o.projectDir, run, signal: o.signal, dryRun: o.dryRun });
  const clips: string[] = [];
  for (const f of sources) {
    if (prepared.quotedFiles.has(f)) continue;
    // Browsers record WebM, which the editor cannot read: a shot filmed on the Shoot page is converted once, here on the Mac. If that fails the original is kept.
    if (parseShotFileName(f) && extname(f).toLowerCase() === ".webm" && !o.dryRun) {
      const mp4 = f.replace(/\.webm$/i, ".mp4");
      const done = await run({ command: "ffmpeg", args: ["-y", "-i", join(o.clipsDir, f), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", join(o.projectDir, mp4)], cwd: o.projectDir, timeoutMs: 20 * 60_000, maxOutputBytes: 64 * 1024, env: { PATH: `${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin` }, signal: o.signal }).then(() => true, () => false);
      if (done) { clips.push(mp4); continue; }
    }
    await copyFile(join(o.clipsDir, f), join(o.projectDir, f)); clips.push(f);
  }
  const shotFiles = shotFilesByBeat(clips);

  const soundFiles: { music?: string; sfx?: string } = {};
  const avatarFile = o.avatar && /^storyboard-avatar\.(jpg|png|webp)$/.test(o.avatar) ? o.avatar : undefined;
  if (avatarFile && !o.dryRun) await copyFile(join(o.clipsDir, avatarFile), join(o.projectDir, avatarFile));
  const frameFiles = (o.frames ?? []).map(f => f && /^storyboard-frame-\d{1,2}\.png$/.test(f) ? f : "");
  if (!o.dryRun) for (const f of frameFiles) if (f) await copyFile(join(o.clipsDir, f), join(o.projectDir, f));
  if (!o.dryRun) for (const role of ["music", "sfx"] as const) { const f = o.sounds?.[role]; if (f && o.music !== false) { await copyFile(join(o.clipsDir, f), join(o.projectDir, f)); soundFiles[role] = f; } }
  // A filmed beat uses its own sound only when the clip has speech that matches the line; otherwise the voiceover plays over the clip.
  const shotSound: ShotSound[] = [];
  const transcripts = new Map<string, { start: number; end: number; text: string }[] | null>();
  const transcriptOf = async (file: string) => {
    if (!transcripts.has(file)) transcripts.set(file, o.transcribeFootage ? await o.transcribeFootage(join(o.projectDir, file), o.signal).catch(() => null) : null);
    return transcripts.get(file) ?? null;
  };
  if (o.voiceover && !o.dryRun) for (const b of beats) {
    const file = shotFiles[b.index];
    if (!file) continue;
    const segments = await transcriptOf(file);
    if (segments) { shotSound[b.index] = soundFromTranscript(segments.map(x => x.text).join(" "), b.narration); continue; }
    const probe = await run({ command: "ffmpeg", args: ["-hide_banner", "-nostats", "-i", join(o.projectDir, file), "-vn", "-af", "volumedetect", "-f", "null", "-"], cwd: o.projectDir, timeoutMs: 120_000, maxOutputBytes: 64 * 1024, env: { PATH: `${process.env.PATH ?? ""}:/opt/homebrew/bin:/usr/local/bin` }, signal: o.signal }).then(r => `${r.stdout}\n${r.stderr}`, () => "");
    shotSound[b.index] = soundFromVolume(probe);
    log(`Shot ${b.index}: no transcript, volume check says ${shotSound[b.index] === "own" ? "speech-like sound" : "no speech"}`);
  }
  const ownSound = (beat: number) => Boolean(shotFiles[beat]) && shotSound[beat] === "own";
  const voiceFiles: string[] = [];
  const timings: number[] = [];
  let at = 0;
  if (o.voiceover) {
    if (!o.voice && !o.speak) throw new Error("Choose a voice for the voiceover.");
    if (o.voice?.engine === "prerendered" && o.voice.files.length !== beats.length) throw new Error("The rendered narration does not match the script. Make the video again.");
    const engine = o.speak ?? (o.voice?.engine === "local" ? (o.voice.reference ? localCloneSpeech(o.voice.reference.audio, o.voice.reference.text) : localSpeech(o.voice.speaker ?? "ryan", o.voice.model)) : null);
    const voiceWork = async () => {
      for (const b of beats) {
        const name = `voice-${String(b.index).padStart(2, "0")}.mp3`;
        if (!o.dryRun) {
          if (engine) { log(`Voicing beat ${b.index}/${beats.length} (${engine.label})`); await writeFile(join(o.projectDir, name), await engine.speak(b.narration, o.signal)); }
          else await copyFile(join(o.clipsDir, (o.voice as { files: string[] }).files[b.index - 1]), join(o.projectDir, name));
        }
        voiceFiles.push(name);
      }
      let narrationSeconds = 0;
      if (!o.dryRun) for (const f of voiceFiles) { const beforeBeat = timings.length + 1;
        at += prepared.quotes.filter(quote => quote.beforeBeat === beforeBeat).reduce((total, quote) => total + quote.seconds, 0);
        timings.push(Number(at.toFixed(2))); const filmed = ownSound(beforeBeat) ? shotFiles[beforeBeat] : undefined;
        // A beat whose filmed clip carries matching speech is as long as that clip, so the generated voice must not reserve a longer, empty slot. A clip without speech takes the voiceover's length.
        const seconds = await durationOf(join(o.projectDir, f), run, o.projectDir);
        if (!filmed) narrationSeconds += seconds;
        at += (filmed ? await durationOf(join(o.projectDir, filmed), run, o.projectDir).catch(() => seconds) : seconds) + BEAT_GAP;
      }
      if (engine && narrationSeconds > 0) observeCompanionMetricUnits("audio_seconds", narrationSeconds);
    };
    if (engine && !o.dryRun) await measureCompanionFeature(o.voice?.engine === "local" && o.voice.reference ? "voice_clone" : "narration", voiceWork);
    else await voiceWork();
  }
  /** Where each voiced beat starts on the timeline, so captions and titles can be placed even where the editor can't transcribe (it needs macOS 26). */
  const cwd = o.projectDir, env = agentEnv();
  if (!o.dryRun) await run({ command: "substo", args: ["new", projectFile, ...(o.orientation === "portrait" ? ["--portrait"] : [])], cwd, env, timeoutMs: 120_000, maxOutputBytes: 64 * 1024, signal: o.signal });
  const footageTranscripts: { file: string; lines: string }[] = [];
  if (o.transcribeFootage && !o.dryRun) for (const f of clips) {
    if (!/\.(mp4|mov|m4v|mkv|webm|mp3|wav|m4a)$/i.test(f)) continue;
    log(`Transcribing ${f}`);
    const segments = await transcriptOf(f);
    if (segments?.length) footageTranscripts.push({ file: f, lines: segments.map(x => `${x.start.toFixed(1)}-${x.end.toFixed(1)} ${x.text}`).join("\n").slice(0, 6000) });
  }
  const separateMotion = "motionModel" in o && o.motionModel !== o.model && (o.motion?.style ?? "clean") !== "minimal";
  const brief = buildBrief({ footageTranscripts, projectFile, editorDocs: o.editorDocs, orientation: o.orientation ?? "landscape", beats, voiceFiles, timings, clips, sourceQuotes: prepared.quotes, hasVoiceover: Boolean(o.voiceover), music: o.music ?? false, soundFiles, avatarFile, ...(shotFiles.length ? { shotFiles, shotSound } : {}), ...(frameFiles.some(Boolean) ? { frameFiles } : {}), ...(o.motion ? { motion: o.motion } : {}), ...(separateMotion ? { deferMotion: true } : {}) });
  if (o.dryRun) return { projectDir: o.projectDir, projectFile, beats: beats.length, clips, voiceFiles, timings, brief };
  log("Editing with the agent");
  let agentOutput = await runEditingAgent({ cwd, brief, editorDocs: o.editorDocs, model: o.model, run, signal: o.signal });
  if (separateMotion) {
    log("Adding motion graphics with the motion model");
    const pass = buildMotionPassBrief({ editorDocs: o.editorDocs, projectFile, choice: o.motion ?? DEFAULT_MOTION_CHOICE, orientation: o.orientation ?? "landscape", script: beats.map(b => `${b.index}. ${b.narration}`).join("\n") });
    agentOutput += "\n" + await runEditingAgent({ cwd, brief: pass, editorDocs: o.editorDocs, model: o.motionModel, run, signal: o.signal });
  }
  return { projectDir: o.projectDir, projectFile, beats: beats.length, clips, voiceFiles, timings, brief, agentOutput, ran: { edit: o.model, motion: separateMotion ? o.motionModel : o.model } };
}
