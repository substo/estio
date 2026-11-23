import "server-only";
import { Prisma } from "@prisma/client";
import { getStudioAccess } from "./access";
import { StudioCommandError } from "./command-error";
import { StudioDbError } from "./db";
import { studioDb } from "./studio-db";
import { deviceOnline } from "./devices-policy";
import { videoAssemblyCodeReason, videoAssemblyMessages, type VideoAssemblyOptions, type VideoAssemblyView, type VideoAssemblyJobStatus } from "./video-assembly-policy";

/** Explicit user action only. Never paid, never another account's Mac; a missing or not-ready Mac is reported, not thrown. */
export async function requestVideoAssembly(locationId: string, recordId: string, options: VideoAssemblyOptions): Promise<{ ok: true; jobId: string; reused: boolean } | { ok: false; message: string }> {
  const access = await getStudioAccess(locationId);
  if (!access) throw new StudioCommandError("Studio access denied.", 403);
  try {
    const r = await studioDb.call<{ jobId: string; reused: boolean }>("studio_request_video_assembly", {
      p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_record_id: recordId, p_options: options });
    return { ok: true, jobId: r.jobId, reused: r.reused };
  } catch (error) {
    const reason = error instanceof StudioDbError && error.code ? videoAssemblyCodeReason[error.code] : undefined;
    if (reason) return { ok: false, message: videoAssemblyMessages[reason] };
    throw error;
  }
}

export async function getVideoAssemblyStatus(locationId: string, recordId: string): Promise<{ view: VideoAssemblyView | null; macOnline: boolean | null }> {
  const access = await getStudioAccess(locationId);
  if (!access || !/^[0-9a-f-]{36}$/i.test(recordId)) return { view: null, macOnline: null };
  const job = (await studioDb.rows<{ id: string; status: VideoAssemblyJobStatus; last_error_message: string | null; result: { assembly?: { summary?: string } } | null; created_at: string; device_id: string | null }>(Prisma.sql`
    select id, status, last_error_message, result, created_at, device_id from studio.studio_jobs
    where location_id = ${access.locationId} and kind = 'studio.video_assemble' and payload->>'recordId' = ${recordId} order by created_at desc limit 1`))[0];
  if (!job) return { view: null, macOnline: null };
  let macOnline: boolean | null = null;
  if (job.device_id && job.status === "queued") {
    const d = await studioDb.one<{ seen_at: string | null; report: Record<string, unknown> }>(Prisma.sql`select seen_at, report from studio.studio_devices where location_id = ${access.locationId} and id = ${job.device_id}::uuid`);
    macOnline = d ? deviceOnline(d.seen_at, d.report) : null;
  }
  return { view: { jobId: job.id, status: job.status, message: job.last_error_message, summary: job.result?.assembly?.summary ?? null, createdAt: job.created_at }, macOnline };
}
