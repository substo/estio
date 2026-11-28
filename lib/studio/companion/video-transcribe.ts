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
import { commentExtractorArgs, parseYoutubeSourceMeta, youtubeSourceMetadataTemplate, type SourceMeta } from "../youtube-source-meta";
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

export const VIDEO_PHASES = ["info", "download", "transcribe", "captions", "save", "slides_scan", "slides_read", "slides_save"] as const;
export type VideoPhase = typeof VIDEO_PHASES[number];
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
  youtubePacing?: ReturnType<typeof createYoutubePacing>;
}
const MB = 1024 * 1024;
/** YouTube player clients, tried in order after yt-dlp's own default (null). Public videos only: no cookies or sign-in are ever used. */
export const YOUTUBE_CLIENT_ORDER: ReadonlyArray<string | null> = [null, "tv", "web_safari", "mweb", "tv_simply"];
/** After YouTube rate-limits or bot-checks this Mac, no YouTube request is made for this long. */
export const YOUTUBE_COOLDOWN_SECONDS = 30 * 60;
/** Human-like pacing: one YouTube request at a time, 5-20 s apart, and at most this many transcription jobs a rolling hour may touch YouTube (the metadata, captions and client retries of one job count once). */
export const YOUTUBE_MAX_REQUESTS_PER_HOUR = 3;
const defaultJitterMs = () => 5_000 + Math.floor(Math.random() * 15_000);
export const baseYtDlp = (tools: VideoTools, client: string | null = null, youtubeArgs: string[] = []) => ["--ignore-config", "--no-playlist", "--no-cache-dir", "--quiet", "--no-progress", "--socket-timeout", "30", "--retries", "3",
  "--sleep-requests", "1", "--restrict-filenames", ...(tools.paths.ffmpeg ? ["--ffmpeg-location", dirname(tools.paths.ffmpeg)] : []),
  // Newer yt-dlp only enables deno by default; Homebrew node is passed by absolute path (a LaunchAgent PATH is minimal).
  ...(tools.paths.node ? ["--js-runtimes", `node:${tools.paths.node}`] : []), ...(client || youtubeArgs.length ? ["--extractor-args", `youtube:${[...(client ? [`player_client=${client}`] : []), ...youtubeArgs].join(";")}`] : [])];
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
    case "private": return new StudioJobError("video_private", "This video is private or members-only, so it cannot be transcribed. Paste a transcript instead.", false);
    case "removed": return new StudioJobError("video_unavailable", "YouTube says this video was removed or is not available. Paste a transcript instead.", false);
    case "age_restricted": return new StudioJobError("video_age_restricted", "This video is age-restricted and needs a YouTube sign-in, which Studio never uses. Paste a transcript instead.", false);
    case "network": return new StudioJobError("video_network", "Could not reach YouTube from this Mac. It will be retried.", true, 600);
    default: return new StudioJobError("video_metadata_failed", "Your Mac couldn’t read the video details from YouTube.", true, 600);
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

/** One budget and cooldown for transcription and source details on this companion. */
export function createYoutubePacing(deps: Pick<VideoTranscribeDeps, "now" | "sleep" | "jitterMs"> = {}) {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(done => setTimeout(done, ms)));
  /** Shared by every job on this Mac: one rate-limit answer from YouTube pauses all YouTube requests, not just this job. */
  let blockedUntil = 0;
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
      if (coolingDown() > 0) throw youtubeFailureError("rate_limited", coolingDown());
      if (!session.counted) { session.counted = true; requestTimes.push(now()); }
      lastRequestAt = now();
      return request();
    });
    paceChain = turn.catch(() => undefined).then(() => { lastRequestAt = now(); });
    return turn;
  };
  const coolingDown = () => Math.ceil((blockedUntil - now()) / 1000);
  const block = (kind: "rate_limited" | "bot_check") => {
    blockedUntil = now() + YOUTUBE_COOLDOWN_SECONDS * 1000;
    return youtubeFailureError(kind);
  };
  return { pace, coolingDown, block };
}

export function createVideoTranscribeHandler(deps: VideoTranscribeDeps): StudioJobHandler {
  const run = deps.run ?? runNativeProcess;
  const read = deps.readFile ?? readFile;
  const now = deps.now ?? Date.now;
  const { pace, coolingDown, block } = deps.youtubePacing ?? createYoutubePacing(deps);
  let workingClient: string | null | undefined;
  const cachePath = (videoId: string) => deps.cacheDir ? join(deps.cacheDir, `${videoId}.json`) : null;
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
    const cacheFile = cachePath(video.videoId);
    let cached: { meta: { title: string; description: string; channel: string; duration: number; live: boolean }; captions: { segments: TranscriptSegment[]; language?: string }; source?: SourceMeta } | null = null;
    if (cacheFile) cached = await readFile(cacheFile, "utf8").then(text => { const c = JSON.parse(String(text)); return Array.isArray(c?.captions?.segments) && c?.meta?.duration > 0 ? c : null; }).catch(() => null);
    /** During a cool-down nothing asks YouTube; a video whose captions are already stored still gets its transcript (only the slide download waits). */
    /** An older cache entry has no comments; it is only reused while cooling down, otherwise the one metadata request is made again so the page gets them. */
    if (cached && !cached.source && coolingDown() <= 0) cached = null;
    if (coolingDown() > 0 && !cached) throw youtubeFailureError("rate_limited", coolingDown());
    const work = await mkdtemp(join(deps.tmpRoot ?? tmpdir(), "studio-video-"));
    /** Live progress for the Source page. Best effort: a failed report never affects the job. */
    let lastKey = ""; let lastAt = 0;
    const report = (phase: VideoPhase, percent?: number, detail?: string) => {
      const key = `${phase}:${percent ?? ""}:${detail ?? ""}`;
      if (!deps.api.progress || key === lastKey || (percent !== undefined && key.startsWith(lastKey.split(":")[0] + ":") && now() - lastAt < 1500)) return;
      lastKey = key; lastAt = now();
      void deps.api.progress(lease, { phase, ...(percent === undefined ? {} : { percent: Math.max(0, Math.min(100, Math.round(percent))) }), ...(detail ? { detail: detail.slice(0, 160) } : {}) }).catch(() => undefined);
    };
    /** Runs a script that writes {phase,percent,detail} to a progress file, and forwards it while the script works. */
    const withProgress = async <T,>(run: (progressFile: string) => Promise<T>): Promise<T> => {
      const file = join(work, `progress-${Math.random().toString(36).slice(2)}.json`);
      const timer = setInterval(() => { void read(file, "utf8").then(text => { const p = JSON.parse(String(text)) as { phase?: string; percent?: number; detail?: string };
        if (p.phase && (VIDEO_PHASES as readonly string[]).includes(p.phase)) report(p.phase as VideoPhase, typeof p.percent === "number" ? p.percent : undefined, p.detail); }).catch(() => undefined); }, 2000);
      try { return await run(file); } finally { clearInterval(timer); }
    };
    const exec = async (command: string, args: string[], timeoutMs: number, maxOutputBytes = 64 * 1024, withEnv = false, extraEnv: Record<string, string> = {}) => {
      if (signal.aborted) fail("worker_lease_lost", "The Mac lost its job lease.", true);
      try { return await run({ command, args, cwd: work, signal, timeoutMs, maxOutputBytes, ...(withEnv ? { env: { ...process.env, ...env, ...extraEnv } } : {}) }); }
      catch (error) {
        if (signal.aborted) fail("worker_lease_lost", "The Mac lost its job lease.", true);
        throw error instanceof CompanionProcessError ? error : new Error("process_failed");
      }
    };
    /** yt-dlp through the player-client ladder. A 429 stops everything and starts the cool-down; a bot check is tried on the other clients first. */
    const session = { counted: false };
    const ytdlp = async (args: string[], timeoutMs: number, maxOutputBytes = 64 * 1024, youtubeArgs: string[] = []) => {
      if (coolingDown() > 0) throw youtubeFailureError("rate_limited", coolingDown());
      const order = workingClient === undefined ? YOUTUBE_CLIENT_ORDER : [workingClient, ...YOUTUBE_CLIENT_ORDER.filter(client => client !== workingClient)];
      let last: unknown; let botChecked = false;
      for (const [index, client] of order.entries()) {
        try {
          const out = await pace(() => exec(tools.paths.ytDlp!, [...baseYtDlp(tools, client, youtubeArgs), ...args], timeoutMs, maxOutputBytes), session);
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
      if (found && cacheFile) await mkdir(dirname(cacheFile), { recursive: true }).then(() => writeFile(cacheFile, JSON.stringify({ meta, captions: found, ...(source ? { source } : {}) }))).catch(() => {});
      return found;
    })();
    /** One YouTube download of the video (480p with its audio) feeds both the transcript and the slides. */
    let mediaMemo: Promise<string> | undefined;
    const media = () => mediaMemo ??= (async () => {
      report("download", undefined, "Downloading the video from YouTube");
      await ytdlp(["--match-filter", `duration < ${VIDEO_LIMITS.maxSeconds}`, "--max-filesize", `${payload.limits.maxMediaMb}M`, "-f", "bv*[height<=480]+ba/b[height<=480]",
        "--merge-output-format", "mp4", "-o", join(work, "video.%(ext)s"), "--", video.url], 40 * 60_000, 256 * 1024);
      const file = (await readdir(work)).find(name => /^video\.(mp4|mkv|webm)$/.test(name));
      if (!file) throw new Error("video_missing");
      return join(work, file);
    })();
    let meta!: { title: string; description: string; channel: string; duration: number; live: boolean };
    let source: SourceMeta | undefined;
    try {
      report("info", undefined, "Checking the video on YouTube");
      // 1. Bounded metadata: duration limit, title/description/channel for the relevance gate. No media is downloaded yet.
      if (cached) { meta = cached.meta; source = cached.source; } else try {
        const args = ["--skip-download", "--print", youtubeSourceMetadataTemplate];
        const readMetadata = (withComments: boolean) => ytdlp(
          [...args, ...(withComments ? ["--write-comments"] : []), "--", video.url], 150_000, 4 * MB, withComments ? [commentExtractorArgs] : [],
        );
        // Optional comments can still make the output too big. Continue with the same bounded metadata once without them.
        let commentsTooLarge = false;
        const out = await readMetadata(true).catch(error => {
          if (!(error instanceof CompanionProcessError) || error.code !== "cli_output_limit") throw error;
          commentsTooLarge = true;
          return readMetadata(false);
        });
        const json = JSON.parse(out.stdout) as Record<string, unknown>;
        meta = { title: String(json.title ?? ""), description: String(json.description ?? ""), channel: String(json.channel ?? json.uploader ?? ""), duration: Number(json.duration ?? 0), live: json.is_live === true };
        source = parseYoutubeSourceMeta(json, out.stderr);
        if (commentsTooLarge) source.commentsError = "Comments exceeded the safe size limit. Use Fetch details to load them separately.";
        if (classifyYtDlpFailure(out.stderr) === "rate_limited") {
          const error = block("rate_limited");
          await deps.api.meta?.(lease, source).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        if (error instanceof StudioJobError) throw error;
        if (error instanceof CompanionProcessError && error.code === "cli_output_limit") {
          fail("video_metadata_too_large", "The video details exceeded your Mac’s safe size limit. You can paste a transcript to continue.");
        }
        const failure = error instanceof CompanionProcessError ? (error.code === "cli_timeout" ? "network" : classifyYtDlpFailure(error.stderr)) : "unknown";
        throw youtubeFailureError(failure);
      }
      // Best effort: what YouTube told us about the video (and its comments) is shown on the Source page; a failure here never affects the transcript.
      if (source) await deps.api.meta?.(lease, source).catch(() => undefined);
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

      // 3. The transcript is made on this Mac (Parakeet, accurate timestamps). YouTube's own captions are only the fallback when that cannot run. No paid service is ever called.
      let segments: TranscriptSegment[] = []; let method: "local-parakeet-tdt-v3-4bit" | "youtube-captions-fallback" = "local-parakeet-tdt-v3-4bit"; let language: string | undefined;
      let audioFailure: unknown; let captionFailure: StudioJobError | undefined;
      try {
        const file = await media();
        report("transcribe", 0, "Transcribing on your Mac");
        const resultFile = join(work, "transcript.json");
        await withProgress(progressFile => exec(tools.paths.python!, ["-I", resolve(deps.scriptsDir, "transcribe-local.py"), file, resultFile], 40 * 60_000, 64 * 1024, true, { STUDIO_PROGRESS_FILE: progressFile }));
        const size = (await stat(resultFile)).size; if (size > 8 * MB) throw new Error("transcript_too_large");
        const result = JSON.parse(String(await read(resultFile, "utf8"))) as { segments?: unknown; language?: unknown };
        segments = normalizeSegments(result.segments, meta.duration + 60);
        if (typeof result.language === "string" && /^[a-z]{2,12}$/.test(result.language)) language = result.language;
        if (!segments.length) throw new Error("empty_transcript");
      } catch (error) {
        if (error instanceof StudioJobError && error.code === "worker_lease_lost") throw error;
        audioFailure = error; segments = [];
      }
      if (!segments.length) {
        report("captions", undefined, "Using YouTube's captions instead");
        method = "youtube-captions-fallback";
        const fromCaptions = await captions().catch(error => { if (error instanceof StudioJobError) captionFailure = error; return null; });
        if (fromCaptions) { segments = fromCaptions.segments; language = fromCaptions.language; }
      }
      if (!segments.length) {
        if (captionFailure) throw captionFailure;
        if (audioFailure instanceof StudioJobError) throw audioFailure;
        const network = audioFailure instanceof CompanionProcessError && ["cli_timeout"].includes(audioFailure.code);
        fail(network ? "video_network" : "video_no_transcript", network ? (relevance ? "Downloading the video timed out after scoring relevance." : "Downloading the video timed out. It will be retried.") : "The transcript could not be made on this Mac and YouTube has no captions for this video. You can paste a transcript instead.", network && !relevance, 600);
      }

      // 4. Save the timestamped transcript on the server first: it must survive any visual failure.
      const chunks = chunkSegments(segments);
      if (!chunks.length || chunks.length > VIDEO_LIMITS.maxChunks) fail("video_transcript_too_large", "The transcript is larger than a Library source can hold.");
      for (const [index, chunk] of chunks.entries()) {
        report("save", (index / chunks.length) * 100, "Saving the transcript");
        if (signal.aborted) fail("worker_lease_lost", "The Mac lost its job lease.", true);
        await deps.api.chunk(lease, index, chunk).catch(() => fail("video_network", "Could not reach Studio to save the transcript.", !relevance, 120));
      }

      // 5. Slides: scene detection + Tesseract with ±15s transcript context. Any failure here leaves a usable transcript (partial).
      const visual = await visualPass({ exec, media, report, withProgress, tools, video: video.url, work, segments, lease, api: deps.api, signal, scriptsDir: deps.scriptsDir, payload, read })
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
  exec: (c: string, a: string[], t: number, m?: number, e?: boolean, x?: Record<string, string>) => Promise<{ stdout: string; stderr: string }>; tools: VideoTools; video: string; work: string; segments: TranscriptSegment[]; lease: VideoLease; api: VideoDeviceApi;
  media: () => Promise<string>; report: (phase: VideoPhase, percent?: number, detail?: string) => void;
  withProgress: <T>(run: (progressFile: string) => Promise<T>) => Promise<T>;
  signal: AbortSignal; scriptsDir: string; payload: z.infer<typeof payloadSchema>; read: typeof readFile;
}): Promise<number> {
  const { exec, tools, work, signal } = input;
  if (!tools.paths.ffmpeg || !tools.paths.ffprobe || !tools.paths.tesseract || !tools.paths.python) throw new Error("missing_visual_tools");
  const videoPath = await input.media();
  input.report("slides_scan", 0, "Looking for slide changes");
  const framesDir = join(work, "frames"); await mkdir(framesDir, { recursive: true });
  const resultFile = join(work, "frames.json");
  await input.withProgress(progressFile => exec(tools.paths.python!, ["-I", resolve(input.scriptsDir, "extract-frames.py"), videoPath, framesDir, resultFile], 20 * 60_000, 64 * 1024, true, { STUDIO_PROGRESS_FILE: progressFile }));
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
    input.report("slides_save", (i / declared.length) * 100, `Saving slides (${Math.min(i + VIDEO_LIMITS.framesPerCall, declared.length)} of ${declared.length})`);
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
