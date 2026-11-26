import "server-only";
import { auth } from "@clerk/nextjs/server";
import { getStudioAccess } from "./access";
import { characterSheetKey } from "./character-profile";
import { StudioCommandError } from "./command-error";
import { StudioDbError } from "./db";
import { createStudioR2Store, readStudioR2Config } from "./media-r2";
import { studioDb } from "./studio-db";

const messages: Record<string, string> = {
  UT001: "That video could not be found.",
  UT011: "Pair a Mac in Setup to transcribe your videos. Nothing was sent to a paid service.", UT012: "Turn Mac processing on in Setup to transcribe your videos.",
  UT013: "Your Mac is not ready to transcribe: install the transcription tools in Setup, then try again.", UT014: "Update the Studio companion on your Mac (it cannot transcribe videos yet).",
};
const uuid = /^[0-9a-f-]{36}$/i;
export const LOCAL_TRANSCRIPT_MODEL = "parakeet-local";
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export interface UploadTranscriptState { uploadId: string; transcribed: boolean; jobId: string | null; status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | null; error: string | null }

/** The timed lines the Mac wrote: anything that is not a plain {start,end,text} is dropped. */
export function readTranscriptFile(value: unknown): { segments: Array<{ start: number; end: number; text: string }>; language: string | null; duration: number } | null {
  const v = value as { segments?: unknown; language?: unknown } | null;
  if (!v || !Array.isArray(v.segments)) return null;
  const segments = v.segments.flatMap(s => {
    const o = s as Partial<{ start: unknown; end: unknown; text: unknown }>;
    return typeof o?.start === "number" && typeof o.end === "number" && typeof o.text === "string" && Number.isFinite(o.start) && Number.isFinite(o.end) && o.start >= 0 && o.end >= o.start && o.text.trim()
      ? [{ start: Math.round(o.start * 100) / 100, end: Math.round(o.end * 100) / 100, text: o.text.trim().slice(0, 400) }] : [];
  }).slice(0, 6000);
  if (!segments.length) return null;
  const language = typeof v.language === "string" && /^[a-z]{2,12}$/.test(v.language) ? v.language : null;
  return { segments, language, duration: Math.max(...segments.map(s => s.end)) };
}

/** Ask the signed-in user's own Mac to transcribe one uploaded video, offline. */
export async function requestUploadTranscript(locationId: string, uploadId: string): Promise<{ status: string }> {
  const access = await getStudioAccess(locationId);
  if (!access || (await auth()).actor) throw new StudioCommandError("Transcripts can only be requested from your own account.", 403);
  if (!uuid.test(uploadId)) throw new StudioCommandError("That video could not be found.");
  try {
    return await studioDb.call<{ status: string }>("studio_request_upload_transcript", { p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_upload_id: uploadId });
  } catch (error) {
    const text = error instanceof StudioDbError && error.code ? messages[error.code] : undefined;
    if (text) throw new StudioCommandError(text);
    throw error;
  }
}

/** State for these uploads. A finished job whose lines are not stored yet is read from the Mac's private file once and stored; a bad or missing file leaves the video untranscribed, never half-saved. */
export async function getUploadTranscriptStates(locationId: string, uploadIds: string[]): Promise<UploadTranscriptState[]> {
  const access = await getStudioAccess(locationId);
  const ids = uploadIds.filter(id => uuid.test(id)).slice(0, 50);
  if (!access || !ids.length) return [];
  const rows = await studioDb.call<Array<{ uploadId: string; transcribed: boolean; jobId: string | null; status: UploadTranscriptState["status"]; error: string | null }>>("studio_upload_transcript_state", { p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_upload_ids: ids }).catch(() => []);
  const config = readStudioR2Config(), store = config ? createStudioR2Store(config) : null;
  return Promise.all(rows.map(async r => {
    let transcribed = r.transcribed;
    if (!transcribed && store && r.status === "succeeded" && r.jobId && uuid.test(r.jobId)) {
      try {
        const link = await store.presignWorkerRead(characterSheetKey(access.locationId, access.userId, r.jobId, "transcript.json"), 120);
        const res = await fetch(link, { redirect: "error", signal: AbortSignal.timeout(20_000) });
        const bytes = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
        const file = bytes && bytes.length <= MAX_FILE_BYTES ? readTranscriptFile(JSON.parse(bytes.toString("utf8"))) : null;
        if (file) {
          await studioDb.call("studio_save_local_upload_transcript", { p_location_id: access.locationId, p_upload_id: r.uploadId, p_model: LOCAL_TRANSCRIPT_MODEL, p_language: file.language, p_duration_seconds: file.duration, p_text: file.segments.map(s => s.text).join(" "), p_segments: file.segments });
          transcribed = true;
        }
      } catch { /* left untranscribed: the person can run it again */ }
    }
    return { uploadId: r.uploadId, transcribed, jobId: r.jobId, status: r.status, error: r.error };
  }));
}
