import { chromium } from "playwright";
import { tmpdir } from "node:os";
import { z } from "zod";
import { readSourceDetailsMeta, SOURCE_DETAILS_LIMIT, type SourceDetailsBatch, type SourceDetailsMetadata } from "../source-details-policy";
import { canonicalYoutubeVideo } from "../video-transcription-policy";
import { StudioJobError, type StudioJobHandler } from "../worker/handlers";
import { parseYoutubeSourceMeta } from "../youtube-source-meta";
import type { DeviceCredentials } from "./config";
import { deviceCall } from "./http-queue";
import { CompanionProcessError, runNativeProcess, type ProcessRunner } from "./process";
import type { VideoLease } from "./video-api";
import { baseYtDlp, classifyYtDlpFailure, type createYoutubePacing } from "./video-transcribe";
import type { VideoTools } from "./video-tools";
import { collectYoutubeComments } from "./youtube-comments";

type Collection = Pick<Awaited<ReturnType<typeof collectYoutubeComments>>, "status" | "reason" | "unresolved_reply_threads">;
export function createSourceDetailsHandler(deps: {
  tools: () => Promise<VideoTools>;
  chrome: () => Promise<string | null>;
  enabled: () => boolean;
  pacing: ReturnType<typeof createYoutubePacing>;
  save: (lease: VideoLease, batch: SourceDetailsBatch) => Promise<boolean>;
  run?: ProcessRunner;
  collect?: typeof collectInChrome;
}): StudioJobHandler {
  return async (job, context) => {
    const video = canonicalYoutubeVideo(job.payload.url);
    if (!video || video.url !== job.payload.url) throw new StudioJobError("invalid_job_payload", "This YouTube source is invalid.", false);
    if (!deps.enabled()) throw new StudioJobError("local_policy", "Mac processing is paused. Try again once it resumes.", false);
    const tools = await deps.tools();
    const chrome = await deps.chrome();
    if (!tools.paths.ytDlp || !chrome) throw new StudioJobError("source_details_tools", "Fetch details needs Chrome and yt-dlp on your paired Mac.", false);

    const session = { counted: false };
    const signal = context.signal;
    const lease = { jobId: job.id, workerId: context.workerId, leaseToken: job.lease_token };
    const save = async (batch: SourceDetailsBatch) => {
      signal.throwIfAborted();
      const accepted = await deps.save(lease, batch).catch(() => {
        throw new StudioJobError("source_details_save_failed", "Studio could not save the latest batch. Earlier saved details and comments are still available.", false);
      });
      if (!accepted) throw new StudioJobError("worker_lease_lost", "Your Mac lost the job lease.", false);
    };
    const stopForLimit = (kind: "rate_limited" | "bot_check") => {
      deps.pacing.block(kind);
      return new StudioJobError("source_details_limited", "YouTube limited access from your Mac. Try again in 30 minutes. Any saved details and comments are still available.", false);
    };

    let metadataError: string | undefined;
    let meta: SourceDetailsMetadata | null = null;
    let limitWarning: StudioJobError | undefined;
    try {
      const { stdout, stderr } = await deps.pacing.pace(() => (deps.run ?? runNativeProcess)({
        command: tools.paths.ytDlp!, args: [...baseYtDlp(tools), "--retries", "0", "--extractor-retries", "0", "--skip-download", "--dump-single-json", "--", video.url],
        cwd: tmpdir(), signal, timeoutMs: 90_000, maxOutputBytes: 4_194_304,
      }), session);
      const failure = classifyYtDlpFailure(stderr);
      if (failure === "rate_limited" || failure === "bot_check") limitWarning = stopForLimit(failure);
      const json = JSON.parse(stdout) as Record<string, unknown>;
      meta = readSourceDetailsMeta({ ...parseYoutubeSourceMeta(json), description: json.description, channelUrl: json.channel_url ?? json.uploader_url });
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof StudioJobError) {
        if (error.code === "video_paced" || error.code === "video_rate_limited") {
          throw new StudioJobError(error.code, `YouTube is on a cooldown for this Mac. Try Fetch details again in about ${Math.max(1, Math.ceil((error.retryAfterSeconds ?? 60) / 60))} minutes.`, false);
        }
        throw error;
      }
      if (error instanceof CompanionProcessError) {
        const failure = classifyYtDlpFailure(error.stderr);
        if (failure === "rate_limited" || failure === "bot_check") throw stopForLimit(failure);
      }
      metadataError = "YouTube did not return video details.";
    }

    if (meta) await save({ meta });
    if (limitWarning) throw limitWarning;
    const result: Collection = meta?.commentCount === 0 ? { status: "reached_end", reason: "YouTube reports no comments for this video.", unresolved_reply_threads: 0 }
      : await deps.pacing.pace(() => (deps.collect ?? collectInChrome)(chrome, video, signal, rows => save({ rows }), stopForLimit), session);
    const reason = [metadataError, result.reason].filter(Boolean).join(" ").slice(0, 300);
    await save({ outcome: metadataError && result.status === "reached_end" ? "interrupted" : result.status, ...(reason ? { reason } : {}), unresolved: result.unresolved_reply_threads });
    return { sourceDetailsDone: true };
  };
}

async function collectInChrome(
  executablePath: string, video: { url: string; videoId: string }, signal: AbortSignal,
  rows: NonNullable<Parameters<typeof collectYoutubeComments>[5]>["rows"],
  stopForLimit: (kind: "rate_limited" | "bot_check") => StudioJobError,
): Promise<Collection> {
  // Use a temporary browser context. The saved YouTube profile remains available for related-video search.
  const browser = await chromium.launch({ executablePath, headless: true, timeout: 20_000 }).catch(() => {
    throw new StudioJobError("source_details_browser", "Chrome could not start on your Mac. Try Fetch details again.", false);
  });
  const timeout = AbortSignal.timeout(8 * 60_000);
  const controller = new AbortController();
  const combined = AbortSignal.any([timeout, signal, controller.signal]);
  const close = () => { void browser.close().catch(() => undefined); };
  combined.addEventListener("abort", close, { once: true });
  let limitError: StudioJobError | undefined;
  try {
    combined.throwIfAborted();
    const page = await browser.newPage({ locale: "en-US", viewport: { width: 1280, height: 900 } });
    await page.route(/^https:\/\/(?:[^/]+\.)?googlevideo\.com\//, route => route.abort());
    page.on("response", response => {
      const url = new URL(response.url());
      if (url.hostname === "www.youtube.com" && response.status() === 429 && (url.pathname === "/watch" || url.pathname.startsWith("/youtubei/"))) {
        limitError ??= stopForLimit("rate_limited");
        controller.abort();
      }
    });
    await page.goto(video.url + "&hl=en", { waitUntil: "domcontentloaded", timeout: 25_000 });
    const result = await collectYoutubeComments(page, video.videoId, SOURCE_DETAILS_LIMIT, undefined, false, { rows, signal: combined });
    if (result.reason?.includes("browser verification")) throw stopForLimit("bot_check");
    return result;
  } catch (error) {
    if (limitError) throw limitError;
    signal.throwIfAborted();
    if (error instanceof StudioJobError) throw error;
    if (timeout.aborted) return { status: "limited", reason: "Stopped after 8 minutes. Any saved comments and replies are still available.", unresolved_reply_threads: 0 };
    throw new StudioJobError("source_details_browser", "YouTube’s comments page could not be read. Any saved details and comments are still available.", false);
  } finally {
    combined.removeEventListener("abort", close);
    await browser.close().catch(() => undefined);
  }
}

export const sourceDetailsWriter = (credentials: DeviceCredentials) => (lease: VideoLease, batch: SourceDetailsBatch) =>
  deviceCall(credentials.origin, credentials.token, "source_details_batch", { ...lease, ...batch }, z.boolean());
