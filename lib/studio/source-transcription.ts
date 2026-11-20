import "server-only";
import { getStudioAccess } from "./access";
import { studioDb } from "./studio-db";

export type SourceTranscriptionStatus = "queued" | "running" | "no_device" | "unsupported" | "has_transcript";
/**
 * Ask the requesting account's paired Mac to transcribe a saved YouTube source. A person pasting, saving or retrying uses
 * `user` (always transcribes). `discovery` is for approved-channel finds: the Mac first scores relevance and only a high
 * score proceeds on its own. Offline Macs keep the request queued; there is never a paid or hosted fallback.
 */
export async function requestSourceTranscription(locationId: string, recordId: string, trigger: "user" | "discovery" = "user") {
  const access = await getStudioAccess(locationId);
  if (!access) throw new Error("Studio access denied.");
  return studioDb.call<{ status: SourceTranscriptionStatus; jobId?: string }>("studio_request_source_transcription", {
    p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_record_id: recordId, p_trigger: trigger });
}
