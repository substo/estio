import "server-only";
import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { getStudioAccess } from "./access";
import { StudioCommandError } from "./command-error";
import { StudioDbError } from "./db";
import { studioDb } from "./studio-db";
import { deviceOnline } from "./devices-policy";
import { listVoices } from "./voices/service";
import { renderNarration } from "./voices/service";
import { isHostedProvider } from "./voices/policy";
import { VoiceSettingsError } from "./voices/keys";
import { parseScript } from "./video-assembly/script";
import { videoAssemblyCodeReason, videoAssemblyMessages, type NarrationView, type VideoAssemblyOptions, type VideoAssemblyView, type VideoAssemblyJobStatus } from "./video-assembly-policy";

/** Explicit user action only. Never paid, never another account's Mac; a missing or not-ready Mac is reported, not thrown. */
export async function requestVideoAssembly(locationId: string, recordId: string, options: VideoAssemblyOptions): Promise<{ ok: true; jobId: string; reused: boolean; narrating?: boolean } | { ok: false; message: string }> {
  const access = await getStudioAccess(locationId);
  if (!access) throw new StudioCommandError("Studio access denied.", 403);
  try {
    const { voiceId, ...base } = options;
    const sqlOptions: Record<string, unknown> = { ...base };
    if (options.voiceover) {
      if (!voiceId) return { ok: false, message: videoAssemblyMessages.no_voice };
      const voice = (await listVoices(access.locationId)).find(v => v.id === voiceId);
      if (!voice) return { ok: false, message: videoAssemblyMessages.no_voice };
      const active = await studioDb.rows<{ id: string }>(Prisma.sql`select id from studio.studio_jobs where location_id = ${access.locationId} and kind = 'studio.video_assemble' and payload->>'recordId' = ${recordId} and status in ('queued','running') limit 1`);
      if (active[0]) return { ok: true, jobId: active[0].id, reused: true };   // never render (and pay for) narration twice
      if (isHostedProvider(voice.provider)) {
        const script = (await studioDb.rows<{ script: string | null }>(Prisma.sql`select payload->>'script' as script from studio.studio_records where location_id = ${access.locationId} and id = ${recordId}::uuid and kind = 'content'`))[0]?.script ?? "";
        if (!script.trim()) return { ok: false, message: videoAssemblyMessages.no_script };
        // Rendering six beats takes minutes: record the run, answer the click at once, and finish in the background (progress is on the page).
        const begun = await studioDb.call<{ runId: string; reused: boolean }>("studio_begin_narration_run", { p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_record_id: recordId, p_beats: parseScript(script).length });
        if (begun.reused) return { ok: true, jobId: begun.runId, reused: true };
        const actor = { locationId: access.locationId, app: access.app, userId: access.userId };
        after(() => narrateThenAssemble(actor, recordId, voice, voiceId, script, sqlOptions, begun.runId));
        return { ok: true, jobId: begun.runId, reused: false, narrating: true };
      } else sqlOptions.voice = { voiceId };
    }
    const r = await studioDb.call<{ jobId: string; reused: boolean }>("studio_request_video_assembly", {
      p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_record_id: recordId, p_options: sqlOptions });
    return { ok: true, jobId: r.jobId, reused: r.reused };
  } catch (error) {
    const reason = error instanceof StudioDbError && error.code ? videoAssemblyCodeReason[error.code] : undefined;
    if (reason) return { ok: false, message: videoAssemblyMessages[reason] };
    throw error;
  }
}

type Actor = { locationId: string; app: "estio" | "substo"; userId: string };
/** The background half of a hosted-voice request: render each beat with the Location's key, then queue the Mac job with the finished narration. Failures are recorded for the page, never thrown. */
async function narrateThenAssemble(actor: Actor, recordId: string, voice: Parameters<typeof renderNarration>[2], voiceId: string, script: string, sqlOptions: Record<string, unknown>, runId: string) {
  const finish = (ok: boolean, message: string | null, jobId: string | null) => studioDb.call("studio_finish_narration_run", { p_location_id: actor.locationId, p_run_id: runId, p_ok: ok, p_message: message, p_job_id: jobId });
  try {
    const narration = await renderNarration(actor.locationId, recordId, voice, script, { access: actor,
      onBeat: done => studioDb.call("studio_narration_progress", { p_location_id: actor.locationId, p_run_id: runId, p_done: done }).then(() => {}, () => {}) });
    const r = await studioDb.call<{ jobId: string }>("studio_request_video_assembly", { p_location_id: actor.locationId, p_actor_app: actor.app, p_clerk_user_id: actor.userId, p_record_id: recordId,
      p_options: { ...sqlOptions, voice: { voiceId, uploadIds: narration.uploadIds } } });
    await finish(true, null, r.jobId);
  } catch (error) {
    const reason = error instanceof StudioDbError && error.code ? videoAssemblyCodeReason[error.code] : undefined;
    const message = error instanceof VoiceSettingsError ? error.message : reason ? videoAssemblyMessages[reason] : videoAssemblyMessages.narration_not_ready;
    await finish(false, message, null).catch(() => {});
  }
}

export async function getVideoAssemblyStatus(locationId: string, recordId: string): Promise<{ view: VideoAssemblyView | null; macOnline: boolean | null; narration: NarrationView | null }> {
  const access = await getStudioAccess(locationId);
  if (!access || !/^[0-9a-f-]{36}$/i.test(recordId)) return { view: null, macOnline: null, narration: null };
  const narration = await studioDb.call<NarrationView | null>("studio_narration_state", { p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_record_id: recordId }).catch(() => null);
  const job = (await studioDb.rows<{ id: string; status: VideoAssemblyJobStatus; last_error_message: string | null; result: { assembly?: { summary?: string } } | null; created_at: string; device_id: string | null }>(Prisma.sql`
    select id, status, last_error_message, result, created_at, device_id from studio.studio_jobs
    where location_id = ${access.locationId} and kind = 'studio.video_assemble' and payload->>'recordId' = ${recordId} order by created_at desc limit 1`))[0];
  if (!job) return { view: null, macOnline: null, narration };
  let macOnline: boolean | null = null;
  if (job.device_id && job.status === "queued") {
    const d = await studioDb.one<{ seen_at: string | null; report: Record<string, unknown> }>(Prisma.sql`select seen_at, report from studio.studio_devices where location_id = ${access.locationId} and id = ${job.device_id}::uuid`);
    macOnline = d ? deviceOnline(d.seen_at, d.report) : null;
  }
  return { view: { jobId: job.id, status: job.status, message: job.last_error_message, summary: job.result?.assembly?.summary ?? null, createdAt: job.created_at }, macOnline, narration };
}
