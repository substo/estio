import "server-only";
import { getStudioAccess } from "./access";
import { StudioCommandError } from "./command-error";
import { StudioDbError } from "./db";
import { studioDb } from "./studio-db";
import { videoLoopCodeReason, videoLoopMessages, type VideoLoopState } from "./video-assembly-policy";

const uuid = /^[0-9a-f-]{36}$/i;
type Result = { ok: true; jobId: string; reused?: boolean } | { ok: false; message: string };
async function run(locationId: string, fn: string, recordId: string, extra: Record<string, unknown> = {}): Promise<Result> {
  const access = await getStudioAccess(locationId);
  if (!access) throw new StudioCommandError("Studio access denied.", 403);
  if (!uuid.test(recordId)) return { ok: false, message: videoLoopMessages.edit_no_content };
  try {
    const r = await studioDb.call<{ jobId: string; reused?: boolean }>(fn, { p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_record_id: recordId, ...extra });
    return { ok: true, jobId: r.jobId, reused: r.reused };
  } catch (error) {
    const reason = error instanceof StudioDbError && error.code ? videoLoopCodeReason[error.code] : undefined;
    if (reason) return { ok: false, message: videoLoopMessages[reason] };
    throw error;
  }
}
/** Explicit owner action. Goes to the requester's own Mac; never a hosted or paid fallback. */
export const requestVideoEdit = (locationId: string, recordId: string, instruction: string) => run(locationId, "studio_request_video_edit", recordId, { p_instruction: instruction });
/** Stops whatever is being made or changed for this piece. Returns how many jobs were stopped. */
export async function stopVideoWork(locationId: string, recordId: string): Promise<{ ok: true; stopped: number } | { ok: false; message: string }> {
  const access = await getStudioAccess(locationId);
  if (!access) throw new StudioCommandError("Studio access denied.", 403);
  if (!uuid.test(recordId)) return { ok: false, message: videoLoopMessages.edit_no_content };
  try {
    const r = await studioDb.call<{ stopped: number }>("studio_stop_video", { p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_record_id: recordId });
    return { ok: true, stopped: Number(r.stopped) || 0 };
  } catch (error) {
    const reason = error instanceof StudioDbError && error.code ? videoLoopCodeReason[error.code] : undefined;
    if (reason) return { ok: false, message: videoLoopMessages[reason] };
    throw error;
  }
}
export const requestOpenEditor = (locationId: string, recordId: string) => run(locationId, "studio_request_open_editor", recordId);

export async function getVideoLoopState(locationId: string, recordId: string): Promise<VideoLoopState | null> {
  const access = await getStudioAccess(locationId);
  if (!access || !uuid.test(recordId)) return null;
  return studioDb.call<VideoLoopState>("studio_video_loop_state", { p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_record_id: recordId }).catch(() => null);
}
