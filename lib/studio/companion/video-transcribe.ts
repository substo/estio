import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { StudioJobError, type StudioJobHandler } from "../worker/handlers";
import type { StudioDeviceConfig } from "../devices-policy";
import type { Usage } from "../../build/contract";
import { summaryProviders } from "./library-summary";
import { runNativeProcess, CompanionProcessError, type ProcessRunner } from "./process";
import type { LocalProvider, LocalTextAdapter } from "./providers";
import { videoProcessEnvironment, type VideoTools } from "./video-tools";
import type { FrameDeclaration, VideoDeviceApi, VideoLease } from "./video-api";
import {
  VIDEO_LIMITS, VIDEO_REQUIRED_TOOLS, buildRelevancePrompt, canonicalYoutubeVideo, chunkSegments, gateOutcome, normalizeSegments, relevanceBand, relevanceJsonSchema,
  relevanceResultSchema, videoToolLabels, type RelevanceBand, type RelevanceContext, type RelevanceResult, type TranscriptSegment, type VideoCandidate,
} from "../video-transcription-policy";

const payloadSchema = z.object({
  transcriptionId: z.string().uuid(), recordId: z.string().uuid(), videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/), url: z.string().max(200), origin: z.string().max(40),
  gate: z.object({ thresholds: z.object({ auto: z.number(), review: z.number() }), context: z.object({
    approvedTitles: z.array(z.string()).max(30).optional(), pinnedKnowledge: z.array(z.string()).max(20).optional(), profile: z.record(z.string()).optional() }).passthrough() }).nullable(),
  limits: z.object({ maxSeconds: z.number().max(VIDEO_LIMITS.maxSeconds), maxMediaMb: z.number().max(500), maxFrames: z.number().max(VIDEO_LIMITS.maxFrames) }),
}).passthrough();

export interface VideoTranscribeDeps {
  tools: () => Promise<VideoTools>;
  api: VideoDeviceApi;
  /** Processing On, unpaused, battery/hours/disk gates (the same local gate as every other processing kind). */
  enabled: () => boolean;
  config: () => StudioDeviceConfig;
  adapter: (provider: LocalProvider) => LocalTextAdapter;
  usage: () => Promise<Usage>;
  scriptsDir: string;
  run?: ProcessRunner;
  tmpRoot?: string;
  readFile?: typeof readFile;
}
const MB = 1024 * 1024;
const baseYtDlp = (tools: VideoTools) => ["--ignore-config", "--no-playlist", "--no-cache-dir", "--no-warnings", "--quiet", "--no-progress", "--socket-timeout", "30", "--retries", "3",
  "--restrict-filenames", ...(tools.paths.ffmpeg ? ["--ffmpeg-location", dirname(tools.paths.ffmpeg)] : [])];
/** YouTube json3 captions -> timestamped segments (ported from the archived Substo transcriber). */
export function captionsFromJson3(data: unknown): TranscriptSegment[] {
  const events = (data as { events?: Array<{ tStartMs?: number; dDurationMs?: number; segs?: Array<{ utf8?: string }> }> })?.events ?? [];
  let previous = ""; const segments: TranscriptSegment[] = [];
  for (const event of events) {
    const current = (event.segs ?? []).map(part => part.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
    if (!current || current === previous) continue;
    let novel = current;
    if (current.startsWith(previous)) novel = current.slice(previous.length).trim(); else if (previous.endsWith(current)) novel = "";
    if (novel) { const start = Number(event.tStartMs ?? 0) / 1000; segments.push({ start, end: start + Number(event.dDurationMs ?? 0) / 1000, text: novel }); }
    previous = current;
  }
  return segments;
}
const networkish = /unable to download|timed out|connection|http error 5|temporary failure|network is unreachable|name or service not known|HTTP Error 429/i;
function fail(code: string, message: string, retryable = false, retryAfter?: number): never { throw new StudioJobError(code, message, retryable, retryAfter); }

export function createVideoTranscribeHandler(deps: VideoTranscribeDeps): StudioJobHandler {
  const run = deps.run ?? runNativeProcess;
  const read = deps.readFile ?? readFile;
  return async (job, context) => {
    const parsed = payloadSchema.safeParse(job.payload);
    const video = parsed.success ? canonicalYoutubeVideo(parsed.data.url) : null;
    if (!parsed.success || !video || video.videoId !== parsed.data.videoId || video.url !== parsed.data.url) fail("invalid_job_payload", "This transcription job is invalid.");
    const payload = parsed.data;
    if (!deps.enabled()) fail("local_policy", "Waiting for the Mac's processing settings (power, working hours or disk).", true, 300);
    const config = deps.config();
    if (!config.features.transcription) fail("video_mac_settings_changed", "Video transcription was turned off in Mac Setup. Transcribe again once it is on.");
    const tools = await deps.tools();
    const missing = VIDEO_REQUIRED_TOOLS.filter(name => !tools.report.tools[name]);
    if (missing.length || !tools.paths.ytDlp || !tools.paths.python || !tools.paths.ffmpeg) fail("video_tools_missing", `Mac transcription tools are missing: ${missing.map(name => videoToolLabels[name]).join(", ") || "tools"}. Run the Mac Setup guide.`, true, 900);
    const lease: VideoLease = { jobId: job.id, workerId: context.workerId, leaseToken: job.lease_token };
    const signal = context.signal;
    const env = videoProcessEnvironment(tools);
    const work = await mkdtemp(join(deps.tmpRoot ?? tmpdir(), "studio-video-"));
    const exec = async (command: string, args: string[], timeoutMs: number, maxOutputBytes = 64 * 1024, withEnv = false) => {
      if (signal.aborted) fail("worker_lease_lost", "The Mac lost its job lease.", true);
      try { return await run({ command, args, cwd: work, signal, timeoutMs, maxOutputBytes, ...(withEnv ? { env: { ...process.env, ...env } } : {}) }); }
      catch (error) {
        if (signal.aborted) fail("worker_lease_lost", "The Mac lost its job lease.", true);
        throw error instanceof CompanionProcessError ? error : new Error("process_failed");
      }
    };
    try {
      // 1. Bounded metadata: duration limit, title/description/channel for the relevance gate. No media is downloaded yet.
      let meta: { title: string; description: string; channel: string; duration: number; live: boolean };
      try {
        const out = await exec(tools.paths.ytDlp, [...baseYtDlp(tools), "--skip-download", "--dump-single-json", "--", video.url], 90_000, 4 * MB);
        const json = JSON.parse(out.stdout) as Record<string, unknown>;
        meta = { title: String(json.title ?? ""), description: String(json.description ?? ""), channel: String(json.channel ?? json.uploader ?? ""), duration: Number(json.duration ?? 0), live: json.is_live === true };
      } catch (error) {
        if (error instanceof StudioJobError) throw error;
        fail(error instanceof CompanionProcessError && error.code === "cli_timeout" ? "video_network" : "video_unavailable", "YouTube did not return this video's details. It may be private, removed or temporarily unreachable.", true, 600);
      }
      if (meta.live) fail("video_unavailable", "Live streams cannot be transcribed until they end.");
      if (!Number.isFinite(meta.duration) || meta.duration <= 0) fail("video_unavailable", "This video's length is unknown, so it was not downloaded.");
      if (meta.duration > Math.min(payload.limits.maxSeconds, VIDEO_LIMITS.maxSeconds)) fail("video_too_long", "Videos over 2 hours are not transcribed.");

      // 2. Relevance gate (approved-channel discovery only): the Mac's own subscription text route; high auto, borderline asks, low is logged.
      let relevance: (RelevanceResult & { band?: RelevanceBand }) | undefined;
      if (payload.gate) {
        const thresholds = payload.gate.thresholds;
        const provider = config.textProvider;
        if (!provider) fail("local_policy", "Choose a text subscription provider in Mac Setup so relevance can be checked.", true, 900);
        const adapter = deps.adapter(provider);
        const ready = await adapter.readiness(signal);
        if (!summaryProviders(await deps.usage()).includes(provider) || !ready.ready || !ready.authenticated || ready.loginMethod !== (provider === "codex" ? "chatgpt" : "claudeai"))
          fail("video_provider_waiting", "Waiting for the selected subscription's sign-in and fresh capacity.", true, 300);
        const captions = await captionText(exec, tools, video.url, work, read, signal).catch(() => undefined);
        const candidate: VideoCandidate = { title: meta.title, description: meta.description, channel: meta.channel, ...(captions ? { captions } : {}) };
        try {
          relevance = await adapter.generate({ workflowContext: "video_relevance", signal, model: config.textModel ?? undefined, prompt: buildRelevancePrompt(candidate, payload.gate.context as RelevanceContext, thresholds),
            jsonSchema: relevanceJsonSchema as unknown as Record<string, unknown>, validate: value => relevanceResultSchema.parse(value), timeoutMs: 120_000, maxResultBytes: 4096 });
        } catch { fail("video_relevance_failed", "Relevance could not be scored with your subscription. Use Transcribe on your Mac to run it anyway."); }
        const band = relevanceBand(relevance!, thresholds);
        relevance = { ...relevance!, band };
        if (band !== "high") return { outcome: gateOutcome(band), relevance: stripBand(relevance) };
      }

      // 3. Audio -> local Parakeet; YouTube captions only as the fallback. No paid service is ever called.
      let segments: TranscriptSegment[] = []; let method: "local-parakeet-tdt-v3-4bit" | "youtube-captions-fallback" = "local-parakeet-tdt-v3-4bit"; let language: string | undefined;
      let audioFailure: unknown;
      try {
        await exec(tools.paths.ytDlp, [...baseYtDlp(tools), "--match-filter", `duration < ${VIDEO_LIMITS.maxSeconds}`, `--max-filesize`, `${payload.limits.maxMediaMb}M`, "-f", "bestaudio", "-x", "--audio-format", "mp3", "--audio-quality", "0",
          "-o", join(work, "source.%(ext)s"), "--", video.url], 40 * 60_000, 256 * 1024);
        const audio = (await readdir(work)).find(name => name.endsWith(".mp3"));
        if (!audio) throw new Error("audio_missing");
        const resultFile = join(work, "transcript.json");
        await exec(tools.paths.python, ["-I", resolve(deps.scriptsDir, "transcribe-local.py"), join(work, audio), resultFile], 40 * 60_000, 64 * 1024, true);
        const size = (await stat(resultFile)).size; if (size > 8 * MB) throw new Error("transcript_too_large");
        const result = JSON.parse(String(await read(resultFile, "utf8"))) as { segments?: unknown; language?: unknown };
        segments = normalizeSegments(result.segments, meta.duration + 60);
        if (typeof result.language === "string" && /^[a-z]{2,12}$/.test(result.language)) language = result.language;
        if (!segments.length) throw new Error("empty_transcript");
      } catch (error) {
        if (error instanceof StudioJobError) throw error;
        audioFailure = error; segments = [];
      }
      if (!segments.length) {
        try {
          segments = normalizeSegments(await captionSegments(exec, tools, video.url, work, read), meta.duration + 60);
          method = "youtube-captions-fallback"; language = "en";
        } catch (error) { if (error instanceof StudioJobError) throw error; /* both routes failed */ }
        if (!segments.length) {
          const network = audioFailure instanceof CompanionProcessError && ["cli_timeout"].includes(audioFailure.code);
          fail(network ? "video_network" : "video_no_transcript", network ? "Downloading the audio timed out. It will be retried." : "No local transcript could be produced and YouTube has no English captions for this video.", network, 600);
        }
      }

      // 4. Save the timestamped transcript on the server first: it must survive any visual failure.
      const chunks = chunkSegments(segments);
      if (!chunks.length || chunks.length > VIDEO_LIMITS.maxChunks) fail("video_transcript_too_large", "The transcript is larger than a Library source can hold.");
      for (const [index, chunk] of chunks.entries()) {
        if (signal.aborted) fail("worker_lease_lost", "The Mac lost its job lease.", true);
        await deps.api.chunk(lease, index, chunk).catch(() => fail("video_network", "Could not reach Studio to save the transcript. It will be retried.", true, 120));
      }

      // 5. Slides: scene detection + Tesseract with ±15s transcript context. Any failure here leaves a usable transcript (partial).
      const visual = await visualPass({ exec, tools, video: video.url, work, segments, lease, api: deps.api, signal, scriptsDir: deps.scriptsDir, payload, read })
        .then(frames => ({ status: "ready" as const, frames }), (error: unknown) => {
          if (signal.aborted) fail("worker_lease_lost", "The Mac lost its job lease.", true);
          return { status: "failed" as const, error: visualMessage(error) };
        });
      return { outcome: "transcribed", ...(relevance ? { relevance: stripBand(relevance) } : {}), method, ...(language ? { language } : {}), durationSeconds: Math.round(meta.duration * 100) / 100,
        transcript: { chunks: chunks.length, segments: segments.length }, visual };
    } finally { await rm(work, { recursive: true, force: true }); }
  };
}
const stripBand = (r: RelevanceResult & { band?: RelevanceBand }): RelevanceResult => ({ relevant: r.relevant, score: r.score, reason: r.reason, matches: r.matches });
function visualMessage(error: unknown) {
  if (error instanceof StudioJobError) return error.message.slice(0, 280);
  const code = error instanceof CompanionProcessError ? error.code : error instanceof Error ? error.message : "failed";
  const known: Record<string, string> = { missing_visual_tools: "Slides were skipped: ffmpeg, ffprobe and tesseract are needed.", cli_timeout: "The slide scan timed out.", cli_output_limit: "The slide scan produced too much output.", video_upload_failed: "Frame upload failed.", video_upload_refused: "Frame upload was refused.", frames_unverified: "Frames could not be verified in private storage." };
  return known[code] ?? "The slide and frame pass failed.";
}
async function captionSegments(exec: (c: string, a: string[], t: number, m?: number, e?: boolean) => Promise<{ stdout: string }>, tools: VideoTools, url: string, work: string, read: typeof readFile, _signal?: AbortSignal) {
  await exec(tools.paths.ytDlp!, [...baseYtDlp(tools), "--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", "en.*", "--sub-format", "json3", "-o", join(work, "captions.%(ext)s"), "--", url], 3 * 60_000);
  const file = (await readdir(work)).find(name => name.endsWith(".json3"));
  if (!file) throw new Error("no_captions");
  if ((await stat(join(work, file))).size > 8 * MB) throw new Error("captions_too_large");
  return captionsFromJson3(JSON.parse(String(await read(join(work, file), "utf8"))));
}
async function captionText(exec: Parameters<typeof captionSegments>[0], tools: VideoTools, url: string, work: string, read: typeof readFile, signal: AbortSignal) {
  const segments = await captionSegments(exec, tools, url, work, read, signal);
  await Promise.all((await readdir(work)).filter(name => name.endsWith(".json3")).map(name => rm(join(work, name), { force: true })));
  return normalizeSegments(segments).map(s => s.text).join(" ").slice(0, 5000) || undefined;
}

async function visualPass(input: {
  exec: Parameters<typeof captionSegments>[0]; tools: VideoTools; video: string; work: string; segments: TranscriptSegment[]; lease: VideoLease; api: VideoDeviceApi;
  signal: AbortSignal; scriptsDir: string; payload: z.infer<typeof payloadSchema>; read: typeof readFile;
}): Promise<number> {
  const { exec, tools, work, signal } = input;
  if (!tools.paths.ffmpeg || !tools.paths.ffprobe || !tools.paths.tesseract || !tools.paths.python) throw new Error("missing_visual_tools");
  await exec(tools.paths.ytDlp!, [...baseYtDlp(tools), "--match-filter", `duration < ${VIDEO_LIMITS.maxSeconds}`, "--max-filesize", `${input.payload.limits.maxMediaMb}M`, "-f", "bv*[height<=480]+ba/b[height<=480]",
    "--merge-output-format", "mp4", "-o", join(work, "video.%(ext)s"), "--", input.video], 40 * 60_000, 256 * 1024);
  const file = (await readdir(work)).find(name => /^video\.(mp4|mkv|webm)$/.test(name));
  if (!file) throw new Error("video_missing");
  const framesDir = join(work, "frames"); await mkdir(framesDir, { recursive: true });
  const resultFile = join(work, "frames.json");
  await exec(tools.paths.python, ["-I", resolve(input.scriptsDir, "extract-frames.py"), join(work, file), framesDir, resultFile], 20 * 60_000, 64 * 1024, true);
  if ((await stat(resultFile)).size > 4 * MB) throw new Error("frames_result_too_large");
  const raw = (JSON.parse(String(await input.read(resultFile, "utf8"))) as { frames?: unknown }).frames;
  const found = Array.isArray(raw) ? raw.slice(0, Math.min(input.payload.limits.maxFrames, VIDEO_LIMITS.maxFrames)) : [];
  const declared: Array<FrameDeclaration & { path: string }> = [];
  for (const item of found) {
    const f = item as Record<string, unknown>;
    if (typeof f.file !== "string" || !/^frame-\d{5}\.jpg$/.test(f.file) || basename(f.file) !== f.file) continue;
    const path = join(framesDir, f.file); const size = (await stat(path).catch(() => null))?.size ?? 0;
    if (size < 1 || size > VIDEO_LIMITS.maxFrameBytes) continue;
    const bytes = await input.read(path);
    const time = clamp(Number(f.time)), start = clamp(Number(f.sceneStart)), end = clamp(Number(f.sceneEnd));
    const around = input.segments.filter(s => s.end >= time - VIDEO_LIMITS.contextSeconds && s.start <= time + VIDEO_LIMITS.contextSeconds).map(s => s.text).join(" ").slice(0, 1000);
    declared.push({ index: declared.length, timeSeconds: time, sceneStart: start, sceneEnd: Math.max(start, end), ocr: String(f.ocr ?? "").replace(/\s+/g, " ").trim().slice(0, 1200), audioContext: around,
      selection: /^[a-z][a-z0-9-]{0,39}$/.test(String(f.selection)) ? String(f.selection) : "settled-visual-change", sha256: createHash("sha256").update(bytes).digest("hex"), byteSize: size, path });
  }
  for (let i = 0; i < declared.length; i += VIDEO_LIMITS.framesPerCall) {
    if (signal.aborted) throw new Error("aborted");
    const batch = declared.slice(i, i + VIDEO_LIMITS.framesPerCall);
    const plan = await input.api.reserve(input.lease, batch.map(({ path: _path, ...rest }) => rest));
    for (const slot of plan) {
      if (slot.status !== "pending") continue;
      const frame = batch.find(b => b.index === slot.index);
      if (!frame || !slot.uploadUrl) throw new Error("video_upload_refused");
      await input.api.upload(slot.uploadUrl, await input.read(frame.path), signal);
    }
    const checked = await input.api.verify(input.lease, batch.map(b => b.index));
    if (checked.missing > 0) throw new Error("frames_unverified");
  }
  return declared.length;
}
const clamp = (n: number) => Number.isFinite(n) ? Math.min(Math.max(n, 0), VIDEO_LIMITS.maxSeconds + 100) : 0;
