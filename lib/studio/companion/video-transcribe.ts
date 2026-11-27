import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { z } from "zod";
import { StudioJobError, type StudioJobHandler } from "../worker/handlers";
import type { StudioDeviceConfig } from "../devices-policy";
import type { Usage } from "../../build/contract";
import { localRoute, runLocalRoute, type ReportLocalRoute } from "./route";
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
  /** This Mac's device id, so a route step pinned to another Mac is left to the server. */
  deviceId?: string;
  reportRoute?: ReportLocalRoute;
  scriptsDir: string;
  run?: ProcessRunner;
  tmpRoot?: string;
  readFile?: typeof readFile;
  /** Test seams: the clock (cool-down) and the pause between player clients. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Random 5-20 s pause between YouTube requests (seam for tests). */
  jitterMs?: () => number;
  /** Where metadata and captions already fetched for a video are kept, so a re-run asks YouTube for nothing. Off when unset. */
  cacheDir?: string;
}
const MB = 1024 * 1024;
/** YouTube player clients, tried in order after yt-dlp's own default (null). Public videos only: no cookies or sign-in are ever used. */
export const YOUTUBE_CLIENT_ORDER: ReadonlyArray<string | null> = [null, "tv", "web_safari", "mweb", "tv_simply"];
/** After YouTube rate-limits or bot-checks this Mac, no YouTube request is made for this long. */
export const YOUTUBE_COOLDOWN_SECONDS = 30 * 60;
/** Human-like pacing: one YouTube request at a time, 5-20 s apart, and at most this many transcription jobs a rolling hour may touch YouTube (the metadata, captions and client retries of one job count once). */
export const YOUTUBE_MAX_REQUESTS_PER_HOUR = 3;
const defaultJitterMs = () => 5_000 + Math.floor(Math.random() * 15_000);
const baseYtDlp = (tools: VideoTools, client: string | null = null) => ["--ignore-config", "--no-playlist", "--no-cache-dir", "--quiet", "--no-progress", "--socket-timeout", "30", "--retries", "3",
  "--sleep-requests", "1", "--restrict-filenames", ...(tools.paths.ffmpeg ? ["--ffmpeg-location", dirname(tools.paths.ffmpeg)] : []),
  // Newer yt-dlp only enables deno by default; Homebrew node is passed by absolute path (a LaunchAgent PATH is minimal).
  ...(tools.paths.node ? ["--js-runtimes", `node:${tools.paths.node}`] : []), ...(client ? ["--extractor-args", `youtube:player_client=${client}`] : [])];
export type YoutubeFailure = "rate_limited" | "bot_check" | "private" | "removed" | "age_restricted" | "network" | "unknown";
/** Classify yt-dlp's error output. Text only informs the user message and the retry policy; it never selects a command. */
export function classifyYtDlpFailure(stderr: string): YoutubeFailure {
  if (/HTTP Error 429|too many requests/i.test(stderr)) return "rate_limited";
  if (/sign in to confirm you.?re not a bot|confirm you.?re not a bot/i.test(stderr)) return "bot_check";
  if (/private video|members-only|join this channel/i.test(stderr)) return "private";
  if (/confirm your age|age-restricted|inappropriate for some users/i.test(stderr)) return "age_restricted";
  if (/video unavailable|has been removed|account.*terminated|no longer available|not available in your country|does not exist/i.test(stderr)) return "removed";
  if (/unable to download|timed out|connection|http error 5|temporary failure|network is unreachable|name or service not known/i.test(stderr)) return "network";
  return "unknown";
}
/** One accurate, user-facing failure per cause. Every message keeps the paste-a-transcript way out. */
export function youtubeFailureError(kind: YoutubeFailure, retryAfterSeconds = YOUTUBE_COOLDOWN_SECONDS): StudioJobError {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  switch (kind) {
    case "rate_limited": return new StudioJobError("video_rate_limited", `YouTube is rate-limiting this Mac. Studio will try again in about ${minutes} minutes; you can also paste a transcript instead.`, true, retryAfterSeconds);
    case "bot_check": return new StudioJobError("video_rate_limited", `YouTube is asking this Mac to prove it is not a bot, which is usually a temporary limit on its connection. Studio will try again in about ${minutes} minutes; you can also paste a transcript instead.`, true, retryAfterSeconds);
    case "private": return new StudioJobError("video_private", "This video is private or members-only, so it cannot be transcribed. Paste a transcript instead.");
    case "removed": return new StudioJobError("video_unavailable", "YouTube says this video was removed or is not available. Paste a transcript instead.");
    case "age_restricted": return new StudioJobError("video_age_restricted", "This video is age-restricted and needs a YouTube sign-in, which Studio never uses. Paste a transcript instead.");
    case "network": return new StudioJobError("video_network", "Could not reach YouTube from this Mac. It will be retried.", true, 600);
    default: return new StudioJobError("video_unavailable", "YouTube did not return this video's details. It may be private, removed or temporarily unreachable. You can paste a transcript instead.", true, 600);
  }
}
/** Prefer the original-language captions (`xx-orig`), then English, then whatever came back. */
export function pickCaptionFile(names: string[]): { file: string; language?: string } | undefined {
  const files = names.filter(name => /^captions\..+\.json3$/.test(name));
  const lang = (name: string) => name.slice("captions.".length, -".json3".length);
  const file = files.find(n => lang(n).endsWith("-orig")) ?? files.find(n => lang(n) === "en") ?? files.find(n => /^en[-_]/.test(lang(n))) ?? files[0];
  if (!file) return undefined;
  const base = lang(file).replace(/-orig$/, "").split(/[-_]/)[0].toLowerCase();
  return { file, ...(/^[a-z]{2,12}$/.test(base) ? { language: base } : {}) };
}
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
function fail(code: string, message: string, retryable = false, retryAfter?: number): never { throw new StudioJobError(code, message, retryable, retryAfter); }

export function createVideoTranscribeHandler(deps: VideoTranscribeDeps): StudioJobHandler {
  const run = deps.run ?? runNativeProcess;
  const read = deps.readFile ?? readFile;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(done => setTimeout(done, ms)));
  /** Shared by every job on this Mac: one rate-limit answer from YouTube pauses all YouTube requests, not just this job. */
  let blockedUntil = 0; let workingClient: string | null | undefined;
  const jitter = deps.jitterMs ?? defaultJitterMs;
  /** Serialised across every job on this Mac; a request waits for the previous one plus a random pause. */
  let paceChain: Promise<unknown> = Promise.resolve(); let lastRequestAt = 0; const requestTimes: number[] = [];
  const pace = <T,>(request: () => Promise<T>, session: { counted: boolean }): Promise<T> => {
    const turn = paceChain.then(async () => {
      const hourAgo = now() - 3_600_000;
      while (requestTimes.length && requestTimes[0] < hourAgo) requestTimes.shift();
      if (!session.counted && requestTimes.length >= YOUTUBE_MAX_REQUESTS_PER_HOUR) {
        const wait = Math.ceil((requestTimes[0] + 3_600_000 - now()) / 1000);
        throw new StudioJobError("video_paced", `Studio paces its YouTube requests to look like a person. It will try again in about ${Math.max(1, Math.ceil(wait / 60))} minutes; you can also paste a transcript instead.`, true, wait);
      }
      if (lastRequestAt) { const gap = jitter() - (now() - lastRequestAt); if (gap > 0) await sleep(gap); }
      if (!session.counted) { session.counted = true; requestTimes.push(now()); }
      lastRequestAt = now();
      return request();
    });
    paceChain = turn.catch(() => undefined).then(() => { lastRequestAt = now(); });
    return turn;
  };
  const cachePath = (videoId: string) => deps.cacheDir ? join(deps.cacheDir, `${videoId}.json`) : null;
  const block = (kind: "rate_limited" | "bot_check") => { blockedUntil = now() + YOUTUBE_COOLDOWN_SECONDS * 1000; return youtubeFailureError(kind); };
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
    const blockedFor = Math.ceil((blockedUntil - now()) / 1000);
    if (blockedFor > 0) throw youtubeFailureError("rate_limited", blockedFor);
    const exec = async (command: string, args: string[], timeoutMs: number, maxOutputBytes = 64 * 1024, withEnv = false) => {
      if (signal.aborted) fail("worker_lease_lost", "The Mac lost its job lease.", true);
      try { return await run({ command, args, cwd: work, signal, timeoutMs, maxOutputBytes, ...(withEnv ? { env: { ...process.env, ...env } } : {}) }); }
      catch (error) {
        if (signal.aborted) fail("worker_lease_lost", "The Mac lost its job lease.", true);
        throw error instanceof CompanionProcessError ? error : new Error("process_failed");
      }
    };
    /** yt-dlp through the player-client ladder. A 429 stops everything and starts the cool-down; a bot check is tried on the other clients first. */
    const session = { counted: false };
    const ytdlp = async (args: string[], timeoutMs: number, maxOutputBytes = 64 * 1024) => {
      const order = workingClient === undefined ? YOUTUBE_CLIENT_ORDER : [workingClient, ...YOUTUBE_CLIENT_ORDER.filter(client => client !== workingClient)];
      let last: unknown; let botChecked = false;
      for (const [index, client] of order.entries()) {
        try {
          const out = await pace(() => exec(tools.paths.ytDlp!, [...baseYtDlp(tools, client), ...args], timeoutMs, maxOutputBytes), session);
          workingClient = client;
          return out;
        } catch (error) {
          if (!(error instanceof CompanionProcessError) || ["cli_timeout", "cli_cancelled", "cli_unavailable", "cli_output_limit"].includes(error.code)) throw error;
          last = error;
          const kind = classifyYtDlpFailure(error.stderr);
          if (kind === "rate_limited") throw block(kind);
          if (kind === "bot_check") botChecked = true;
          if (kind === "private" || kind === "removed") throw youtubeFailureError(kind);
        }
      }
      if (botChecked) throw block("bot_check");
      throw last;
    };
    /** Captions first: cheap, no media download. Original language, uploaded subtitles or YouTube's automatic ones. */
    let captionsMemo: Promise<{ segments: TranscriptSegment[]; language?: string } | null> | undefined;
    let cached: { meta: { title: string; description: string; channel: string; duration: number; live: boolean }; captions: { segments: TranscriptSegment[]; language?: string } } | null = null;
    const cacheFile = cachePath(video.videoId);
    if (cacheFile) cached = await readFile(cacheFile, "utf8").then(text => { const c = JSON.parse(String(text)); return Array.isArray(c?.captions?.segments) && c?.meta?.duration > 0 ? c : null; }).catch(() => null);
    const captions = () => captionsMemo ??= cached ? Promise.resolve(cached.captions) : (async () => {
      let stderr = "";
      try {
        stderr = (await ytdlp(["--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", ".*-orig,en,en-.*", "--sub-format", "json3",
          "-o", join(work, "captions.%(ext)s"), "--", video.url], 3 * 60_000)).stderr;
      } catch (error) { if (error instanceof StudioJobError) throw error; return null; }
      const picked = pickCaptionFile(await readdir(work));
      if (!picked) {
        // yt-dlp reports a rate-limited subtitle request as a warning and still exits 0.
        if (/HTTP Error 429|too many requests/i.test(stderr)) throw block("rate_limited");
        return null;
      }
      if ((await stat(join(work, picked.file))).size > 8 * MB) return null;
      const segments = normalizeSegments(captionsFromJson3(JSON.parse(String(await read(join(work, picked.file), "utf8")))), meta.duration + 60);
      const found = segments.map(s => s.text).join(" ").length >= 20 ? { segments, ...(picked.language ? { language: picked.language } : {}) } : null;
      if (found && cacheFile) await mkdir(dirname(cacheFile), { recursive: true }).then(() => writeFile(cacheFile, JSON.stringify({ meta, captions: found }))).catch(() => {});
      return found;
    })();
    let meta!: { title: string; description: string; channel: string; duration: number; live: boolean };
    try {
      // 1. Bounded metadata: duration limit, title/description/channel for the relevance gate. No media is downloaded yet.
      if (cached) meta = cached.meta; else try {
        const out = await ytdlp(["--skip-download", "--dump-single-json", "--", video.url], 90_000, 4 * MB);
        const json = JSON.parse(out.stdout) as Record<string, unknown>;
        meta = { title: String(json.title ?? ""), description: String(json.description ?? ""), channel: String(json.channel ?? json.uploader ?? ""), duration: Number(json.duration ?? 0), live: json.is_live === true };
      } catch (error) {
        if (error instanceof StudioJobError) throw error;
        const failure = error instanceof CompanionProcessError ? (error.code === "cli_timeout" ? "network" : classifyYtDlpFailure(error.stderr)) : "unknown";
        throw youtubeFailureError(failure);
      }
      if (meta.live) fail("video_unavailable", "Live streams cannot be transcribed until they end.");
      if (!Number.isFinite(meta.duration) || meta.duration <= 0) fail("video_unavailable", "This video's length is unknown, so it was not downloaded.");
      if (meta.duration > Math.min(payload.limits.maxSeconds, VIDEO_LIMITS.maxSeconds)) fail("video_too_long", "Videos over 2 hours are not transcribed.");

      // 2. Relevance gate (approved-channel discovery only): the Mac's own subscription text route; high auto, borderline asks, low is logged.
      let relevance: (RelevanceResult & { band?: RelevanceBand }) | undefined;
      let routeActual: { provider: LocalProvider; model: string } | undefined;
      if (payload.gate) {
        const thresholds = payload.gate.thresholds;
        // The Location order supplied with the job; without one, Setup's provider only.
        const defaultModel = (p: LocalProvider) => p === config.textProvider ? config.textModel ?? undefined : undefined;
        const routed = localRoute(job, { deviceId: deps.deviceId, defaultModel });
        if (!routed && !config.textProvider) fail("local_policy", "Choose a text subscription provider in Mac Setup so relevance can be checked.", true, 900);
        if (routed && !routed.steps.length) fail("video_relevance_unavailable", "No subscription in this Location's order can check this video. Use Transcribe on your Mac to run it anyway.");
        const steps = routed?.steps ?? [{ provider: config.textProvider!, model: defaultModel(config.textProvider!) }];
        let candidate: VideoCandidate | undefined;
        const attempt = await runLocalRoute(steps, { adapter: deps.adapter, usage: deps.usage }, signal, async (adapter, step) => {
          if (!candidate) {
            const text = (await captions().catch(() => null))?.segments.map(s => s.text).join(" ").slice(0, 5000);
            candidate = { title: meta.title, description: meta.description, channel: meta.channel, ...(text ? { captions: text } : {}) };
          }
          return adapter.generate({ workflowContext: "video_relevance", signal, model: step.model, prompt: buildRelevancePrompt(candidate, payload.gate!.context as RelevanceContext, thresholds),
            jsonSchema: relevanceJsonSchema as unknown as Record<string, unknown>, validate: value => relevanceResultSchema.parse(value), timeoutMs: 120_000, maxResultBytes: 4096 });
        }, () => fail("video_relevance_failed", "Relevance could not be scored with your subscription. Use Transcribe on your Mac to run it anyway."));
        if (!attempt) fail("video_provider_waiting", "Waiting for a subscription in this Location's order to be signed in and available.", true, 300);
        deps.reportRoute?.(job.id, attempt);
        if (routed) routeActual = { provider: attempt.provider, model: attempt.model ?? "native-default" };
        relevance = attempt.value;
        const band = relevanceBand(relevance!, thresholds);
        relevance = { ...relevance!, band };
        if (band !== "high") return { outcome: gateOutcome(band), relevance: stripBand(relevance), ...(routeActual ? { routeActual } : {}) };
      }

      // 3. Captions first (cheap, no media download); only when YouTube has none is the audio downloaded and transcribed locally with Parakeet. No paid service is ever called.
      let segments: TranscriptSegment[] = []; let method: "local-parakeet-tdt-v3-4bit" | "youtube-captions-fallback" = "youtube-captions-fallback"; let language: string | undefined;
      const fromCaptions = await captions();
      if (fromCaptions) { segments = fromCaptions.segments; language = fromCaptions.language; }
      let audioFailure: unknown;
      if (!segments.length) {
        method = "local-parakeet-tdt-v3-4bit";
        try {
          await ytdlp(["--match-filter", `duration < ${VIDEO_LIMITS.maxSeconds}`, `--max-filesize`, `${payload.limits.maxMediaMb}M`, "-f", "bestaudio", "-x", "--audio-format", "mp3", "--audio-quality", "0",
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
          const network = audioFailure instanceof CompanionProcessError && ["cli_timeout"].includes(audioFailure.code);
          fail(network ? "video_network" : "video_no_transcript", network ? (relevance ? "Downloading the audio timed out after scoring relevance." : "Downloading the audio timed out. It will be retried.") : "YouTube has no captions for this video and its audio could not be transcribed on this Mac. You can paste a transcript instead.", network && !relevance, 600);
        }
      }

      // 4. Save the timestamped transcript on the server first: it must survive any visual failure.
      const chunks = chunkSegments(segments);
      if (!chunks.length || chunks.length > VIDEO_LIMITS.maxChunks) fail("video_transcript_too_large", "The transcript is larger than a Library source can hold.");
      for (const [index, chunk] of chunks.entries()) {
        if (signal.aborted) fail("worker_lease_lost", "The Mac lost its job lease.", true);
        await deps.api.chunk(lease, index, chunk).catch(() => fail("video_network", "Could not reach Studio to save the transcript.", !relevance, 120));
      }

      // 5. Slides: scene detection + Tesseract with ±15s transcript context. Any failure here leaves a usable transcript (partial).
      const visual = await visualPass({ exec, ytdlp, tools, video: video.url, work, segments, lease, api: deps.api, signal, scriptsDir: deps.scriptsDir, payload, read })
        .then(frames => ({ status: "ready" as const, frames }), (error: unknown) => {
          if (signal.aborted) fail("worker_lease_lost", "The Mac lost its job lease.", true);
          return { status: "failed" as const, error: visualMessage(error) };
        });
      return { outcome: "transcribed", ...(routeActual ? { routeActual } : {}), ...(relevance ? { relevance: stripBand(relevance) } : {}), method, ...(language ? { language } : {}), durationSeconds: Math.round(meta.duration * 100) / 100,
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
async function visualPass(input: {
  exec: (c: string, a: string[], t: number, m?: number, e?: boolean) => Promise<{ stdout: string; stderr: string }>; tools: VideoTools; video: string; work: string; segments: TranscriptSegment[]; lease: VideoLease; api: VideoDeviceApi;
  ytdlp: (args: string[], timeoutMs: number, maxOutputBytes?: number) => Promise<unknown>;
  signal: AbortSignal; scriptsDir: string; payload: z.infer<typeof payloadSchema>; read: typeof readFile;
}): Promise<number> {
  const { exec, tools, work, signal } = input;
  if (!tools.paths.ffmpeg || !tools.paths.ffprobe || !tools.paths.tesseract || !tools.paths.python) throw new Error("missing_visual_tools");
  await input.ytdlp(["--match-filter", `duration < ${VIDEO_LIMITS.maxSeconds}`, "--max-filesize", `${input.payload.limits.maxMediaMb}M`, "-f", "bv*[height<=480]+ba/b[height<=480]",
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
