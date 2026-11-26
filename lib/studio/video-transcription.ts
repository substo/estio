import "server-only";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { getStudioAccess } from "./access";
import { studioDb } from "./studio-db";
import { StudioDbError } from "./db";
import { StudioCommandError } from "./command-error";
import { createStudioR2Store, readStudioR2Config } from "./media-r2";
import { deviceOnline } from "./devices-policy";
import { canonicalYoutubeVideo } from "./video-transcription-policy";
import { runVideoFrameOperation } from "./video-frames";

export type VideoOrigin = "paste" | "search" | "suggestion";
export type VideoNotQueuedReason = "no_mac" | "processing_off" | "transcription_off" | "tools_missing" | "companion_outdated" | "no_authority";
export const videoNotQueuedMessages: Record<VideoNotQueuedReason, string> = {
  no_mac: "Pair a Mac in Setup to transcribe videos. Nothing was sent to a paid service.",
  processing_off: "Turn Mac processing on in Setup to transcribe videos.",
  transcription_off: "Turn on Video transcription in your Mac's Setup, then transcribe again.",
  tools_missing: "Your Mac is missing transcription tools. Follow the Mac Setup guide, then transcribe again.",
  companion_outdated: "Update the Studio companion on your Mac (it does not support video transcription yet).",
  no_authority: "Only a Business admin with a paired Mac can run Mac transcription.",
};
const codeReason: Record<string, VideoNotQueuedReason> = { VT001: "no_mac", VT002: "transcription_off", VT003: "tools_missing", VT004: "companion_outdated", "42501": "no_authority" };
export type VideoQueueResult =
  | { status: "queued" | "reused" | "skipped" | "skipped_existing"; transcriptionId?: string; jobId?: string }
  | { status: "not_queued"; reason: VideoNotQueuedReason; message: string };

/** Mac transcription for an explicit user action (pasted link, chosen search result, or confirming a suggestion).
 * Never gated, never paid, never another Account's Mac. A missing/not-ready Mac is reported, not thrown, so callers can keep their own result. */
export async function enqueueVideoTranscription(locationId: string, command: { recordId: string; origin: VideoOrigin; requestKey: string }): Promise<VideoQueueResult> {
  const access = await getStudioAccess(locationId);
  if (!access) throw new StudioCommandError("Studio access denied.", 403);
  try {
    const r = await studioDb.call<{ status: string; transcriptionId?: string; jobId?: string; reused?: boolean }>("studio_enqueue_video_transcription", {
      p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_command: command });
    const status = r.reused && r.status === "queued" ? "reused" : r.status;
    return { status: status as "queued", ...(r.transcriptionId ? { transcriptionId: r.transcriptionId } : {}), ...(r.jobId ? { jobId: r.jobId } : {}) };
  } catch (error) {
    const reason = error instanceof StudioDbError && error.code ? codeReason[error.code] : undefined;
    if (reason) return { status: "not_queued", reason, message: videoNotQueuedMessages[reason] };
    throw error;
  }
}
export const videoRequestKey = (prefix: string, ...parts: string[]) => `${prefix}:${createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 40)}`;

/** Find reusable timings first, then any open or failed attempt for this source/video. */
export async function getCitationTranscription(locationId: string, recordId: string, videoId: string) {
  return studioDb.one<{ id: string; status: "ready" | "partial" | "queued" | "running" | "failed" | "cancelled" }>(Prisma.sql`
    select id, status from studio.studio_video_transcriptions
    where location_id=${locationId} and record_id=${recordId}::uuid and video_id=${videoId}
      and status in ('ready','partial','queued','running','failed','cancelled')
    order by case when status in ('ready','partial') then 0 when status in ('queued','running') then 1 else 2 end,
      created_at desc, id desc limit 1`);
}

export async function ensureCitationTranscription(locationId: string, recordId: string, retry: boolean): Promise<VideoQueueResult> {
  const access = await getStudioAccess(locationId);
  if (!access) throw new StudioCommandError("Studio access denied.", 403);
  const source = await studioDb.one<{ source_url: string | null }>(Prisma.sql`
    select source_url from studio.studio_records
    where location_id=${access.locationId} and id=${recordId}::uuid and kind='reference' and not archived`);
  const youtube = canonicalYoutubeVideo(source?.source_url);
  if (!youtube) throw new StudioCommandError("The YouTube source is unavailable.", 404);
  const prior = await getCitationTranscription(access.locationId, recordId, youtube.videoId);
  if (prior?.status === "ready" || prior?.status === "partial") return { status: "skipped_existing" };
  if (prior && (prior.status === "queued" || prior.status === "running" || !retry)) return { status: "reused", transcriptionId: prior.id };
  return enqueueVideoTranscription(access.locationId, {
    recordId, origin: "suggestion", requestKey: videoRequestKey("clip-timing", recordId, youtube.videoId, prior?.id ?? "first"),
  });
}

export interface VideoTranscriptionView {
  id: string; status: "suggested" | "queued" | "running" | "ready" | "partial" | "failed" | "cancelled" | "skipped";
  origin: string; gated: boolean; relevance: { relevant: boolean; score: number; reason: string; matches: string[]; band: string } | null;
  method: string | null; language: string | null; duration_seconds: number | null; segment_count: number; transcript_chars: number; transcript_applied: boolean;
  visual_status: "pending" | "ready" | "failed" | "skipped"; visual_error: string | null; frame_count: number; error_code: string | null; error_message: string | null;
  created_at: string; updated_at: string; completed_at: string | null; device_id: string | null;
}
export interface VideoFrameView { frame_index: number; time_seconds: number; scene_start: number; scene_end: number; ocr_text: string; audio_context: string; selection: string; status: string }
export interface VideoStatus {
  latest: VideoTranscriptionView | null; history: VideoTranscriptionView[]; frames: VideoFrameView[];
  /** Why a queued job is waiting, so the owner sees a clear status instead of silence. */
  waiting: null | "mac_offline" | "mac_paused" | "processing_off" | "tools_missing";
  mac: { name: string; online: boolean; lastSeenAt: string | null } | null;
}
/** Read model for the Library source page. Scoped by the caller's active Location. */
export async function getVideoStatus(locationId: string, recordId: string): Promise<VideoStatus | null> {
  const access = await getStudioAccess(locationId);
  if (!access || !/^[0-9a-f-]{36}$/i.test(recordId)) return null;
  const history = await studioDb.rows<VideoTranscriptionView>(Prisma.sql`
    select id,status,origin,gated,relevance,method,language,duration_seconds,segment_count,transcript_chars,transcript_applied,visual_status,visual_error,frame_count,error_code,error_message,created_at,updated_at,completed_at,device_id
    from studio.studio_video_transcriptions where location_id=${access.locationId} and record_id=${recordId}::uuid order by created_at desc limit 5`);
  const latest = history[0] ?? null;
  if (!latest) return { latest: null, history: [], frames: [], waiting: null, mac: null };
  const frames = latest.frame_count > 0 ? await studioDb.rows<VideoFrameView>(Prisma.sql`
    select frame_index,time_seconds,scene_start,scene_end,ocr_text,audio_context,selection,status from studio.studio_video_frames
    where location_id=${access.locationId} and transcription_id=${latest.id}::uuid and status='verified' order by time_seconds,frame_index limit 200`) : [];
  let waiting: VideoStatus["waiting"] = null; let mac: VideoStatus["mac"] = null;
  if (latest.device_id && (latest.status === "queued" || latest.status === "running")) {
    const d = await studioDb.one<{ name: string; seen_at: string | null; report: Record<string, unknown>; paused: boolean; processing_enabled: boolean }>(Prisma.sql`
      select name,seen_at,report,paused,processing_enabled from studio.studio_devices where location_id=${access.locationId} and id=${latest.device_id}::uuid and app=${access.app}`);
    if (d) {
      const online = deviceOnline(d.seen_at, d.report);
      mac = { name: d.name, online, lastSeenAt: d.seen_at };
      if (latest.status === "queued") waiting = !online ? "mac_offline" : d.paused ? "mac_paused" : !d.processing_enabled ? "processing_off"
        : (d.report as { video?: { ready?: boolean } }).video?.ready === false || latest.error_code === "video_tools_missing" ? "tools_missing" : null;
    }
  }
  return { latest, history, frames, waiting, mac };
}

/** Device operations that need R2: the SQL function owns identity, lease and validation; this adds signed uploads and server-side byte checks. */
export async function executeVideoFrameOperation(operation: "video_frames_reserve" | "video_frames_verify", call: (observed?: unknown) => Promise<unknown>) {
  const config = readStudioR2Config();
  if (!config) throw new StudioCommandError("Media storage is not configured.", 503);
  return runVideoFrameOperation(operation, call, createStudioR2Store(config));
}
