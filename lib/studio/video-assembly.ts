import "server-only";
import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { getStudioAccess } from "./access";
import { StudioCommandError } from "./command-error";
import { StudioDbError } from "./db";
import { studioDb } from "./studio-db";
import { deviceOnline } from "./devices-policy";
import { getGenerationSources, getSoundProviderChoices } from "./voices/sources-store";
import type { GenerationSources } from "./voices/sources";
import { estimateVideoSeconds, listVoices, renderNarration, renderVideoSounds, type VideoSounds } from "./voices/service";
import { pickHostedSound, type HostedSoundProvider, type SoundKeys, type SoundProviderChoices } from "./voices/sound-providers";
import { soundKeyAvailability } from "./voices/sound-keys";
import { reusableBeatAudio, rememberRenderedBlockAudio } from "./script-audio";
import { isHostedProvider } from "./voices/policy";
import { VoiceSettingsError } from "./voices/keys";
import { MAX_SOURCE_QUOTES, SOURCE_QUOTE_PREFIX } from "./script-source-quotes";
import { parseScript, parseScriptTimeline } from "./video-assembly/script";
import { videoAssemblyCodeReason, videoAssemblyMessages, type NarrationView, type VideoAssemblyOptions, type VideoAssemblyView, type VideoAssemblyJobStatus } from "./video-assembly-policy";

/** Explicit user action only. Never paid, never another account's Mac; a missing or not-ready Mac is reported, not thrown. */
export async function requestVideoAssembly(locationId: string, recordId: string, options: VideoAssemblyOptions): Promise<{ ok: true; jobId: string; reused: boolean; narrating?: boolean } | { ok: false; message: string }> {
  const access = await getStudioAccess(locationId);
  if (!access) throw new StudioCommandError("Studio access denied.", 403);
  try {
    const row = await studioDb.one<{ payload: Record<string, unknown> }>(Prisma.sql`
      select payload from studio.studio_records where location_id = ${access.locationId} and id = ${recordId}::uuid and kind = 'content'`);
    const script = typeof row?.payload.script === "string" ? row.payload.script : "";
    if (script.includes(SOURCE_QUOTE_PREFIX)) {
      const { beats, quotes } = parseScriptTimeline(script);
      if (!beats.length) return { ok: false, message: "Add a spoken script alongside the source clips." };
      if (quotes.length > MAX_SOURCE_QUOTES) return { ok: false, message: `Use at most ${MAX_SOURCE_QUOTES} source clips in one script.` };
      if (quotes.length > 0) {
        const mac = await studioDb.one<{ source_clips: string | null }>(Prisma.sql`
          select report#>>'{videoAssembly,sourceClips}' as source_clips
          from studio.studio_devices
          where location_id = ${access.locationId} and app = ${access.app} and created_by = ${access.userId}
            and revoked_at is null and processing_enabled and 'studio.video_assemble'=any(allowed_kinds)
            and report->'handlers' ? 'studio.video_assemble' and report#>>'{videoAssembly,ready}'='true'
          order by seen_at desc nulls last limit 1`);
        if (mac?.source_clips !== "1") return { ok: false, message: "Update and restart the video companion on your paired Mac to make a video with source clips." };
        const available = await studioDb.rows<{ id: string; content_type: string }>(Prisma.sql`
          select id, content_type from studio.studio_uploads
          where location_id = ${access.locationId} and record_id = ${recordId}::uuid and status = 'uploaded' and deleted_at is null
            and media_object_id is not null and (content_type like 'audio/%' or content_type like 'video/%')
            and original_filename !~ '^Edited video ' order by created_at limit 40`);
        if (quotes.some(quote => !available.some(asset => asset.id === quote.asset && asset.content_type.startsWith("video/")))) {
          return { ok: false, message: "One of the source clips is missing its video. Open the block and choose an available upload." };
        }
      }
    }
    const { voiceId, ...base } = options;
    const sqlOptions: Record<string, unknown> = { ...base };
    let voice: Awaited<ReturnType<typeof listVoices>>[number] | undefined;
    if (options.voiceover) {
      if (!voiceId) return { ok: false, message: videoAssemblyMessages.no_voice };
      voice = (await listVoices(access.locationId)).find(v => v.id === voiceId);
      if (!voice) return { ok: false, message: videoAssemblyMessages.no_voice };
    }
    const hostedVoice = voice && isHostedProvider(voice.provider) ? voice : undefined;
    if (voice && !hostedVoice) sqlOptions.voice = { voiceId };
    // Music and the whoosh are made on this Mac unless the Location chose a hosted provider for that kind (Settings -> AI -> Music and sound effects).
    // Only then does the server render them, with the Location's own ElevenLabs key, which takes a while: same background path as hosted narration.
    const sources = options.music ? await getGenerationSources(access.locationId).catch(() => ({} as GenerationSources)) : {};
    const wantsHosted = options.music && (sources.music === "hosted" || sources.effects === "hosted");
    const choices: SoundProviderChoices = wantsHosted ? await getSoundProviderChoices(access.locationId).catch(() => ({})) : {};
    const keys: SoundKeys = wantsHosted ? await soundKeyAvailability(access.locationId).catch(() => ({ fal: false, elevenlabs: false })) : { fal: false, elevenlabs: false };
    const picked = { music: sources.music === "hosted" ? pickHostedSound(choices.music, keys) : null, sfx: sources.effects === "hosted" ? pickHostedSound(choices.effects, keys) : null };
    const sound = picked.music || picked.sfx ? picked : null;
    if (hostedVoice || sound) {
      const active = await studioDb.rows<{ id: string }>(Prisma.sql`select id from studio.studio_jobs where location_id = ${access.locationId} and kind = 'studio.video_assemble' and payload->>'recordId' = ${recordId} and status in ('queued','running') limit 1`);
      if (active[0]) return { ok: true, jobId: active[0].id, reused: true };   // never render (and pay for) narration or sound twice
      if (!script.trim()) return { ok: false, message: videoAssemblyMessages.no_script };
      // Rendering takes minutes: record the run, answer the click at once, and finish in the background (progress is on the page).
      const begun = await studioDb.call<{ runId: string; reused: boolean }>("studio_begin_narration_run", { p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_record_id: recordId, p_beats: parseScript(script).length });
      if (begun.reused) return { ok: true, jobId: begun.runId, reused: true };
      const actor = { locationId: access.locationId, app: access.app, userId: access.userId };
      const { reuse } = hostedVoice ? await reusableBeatAudio(access.locationId, recordId, row?.payload ?? {}, hostedVoice.id, parseScript(script).length).catch(() => ({ reuse: new Map<number, string>() })) : { reuse: new Map<number, string>() };   // clips already fresh for this text and voice are never paid for twice
      after(() => narrateThenAssemble(actor, recordId, hostedVoice, voiceId, script, sqlOptions, begun.runId, reuse, sound));
      return { ok: true, jobId: begun.runId, reused: false, narrating: true };
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
async function narrateThenAssemble(actor: Actor, recordId: string, voice: Parameters<typeof renderNarration>[2] | undefined, voiceId: string | undefined, script: string, sqlOptions: Record<string, unknown>, runId: string, reuse: ReadonlyMap<number, string> = new Map(), sound: { music: HostedSoundProvider | null; sfx: HostedSoundProvider | null } | null = null) {
  const finish = (ok: boolean, message: string | null, jobId: string | null) => studioDb.call("studio_finish_narration_run", { p_location_id: actor.locationId, p_run_id: runId, p_ok: ok, p_message: message, p_job_id: jobId });
  try {
    const narration = voice ? await renderNarration(actor.locationId, recordId, voice, script, { access: actor, reuse,
      onBeat: done => studioDb.call("studio_narration_progress", { p_location_id: actor.locationId, p_run_id: runId, p_done: done }).then(() => {}, () => {}) }) : null;
    // A failed or skipped sound never stops the video: the Mac job simply gets no sound files and the brief says so.
    const sounds: VideoSounds | null = sound ? await renderVideoSounds(actor, recordId, { music: sound.music, sfx: sound.sfx, seconds: estimateVideoSeconds(script) }).catch((): VideoSounds | null => ({ music: null, sfx: null, skipped: "Music and sound effects could not be generated." })) : null;
    const r = await studioDb.call<{ jobId: string }>("studio_request_video_assembly", { p_location_id: actor.locationId, p_actor_app: actor.app, p_clerk_user_id: actor.userId, p_record_id: recordId,
      p_options: narration && voice ? { ...sqlOptions, voice: { voiceId, uploadIds: narration.uploadIds } } : sqlOptions });
    await finish(true, sounds?.skipped ? `Made with the Mac's own music and effects instead: ${sounds.skipped}` : null, r.jobId);
    if (narration && voice) await rememberRenderedBlockAudio(actor, recordId, voice.id, new Map(parseScript(script).map(b => [b.index, b.narration])), narration.rendered);
  } catch (error) {
    const reason = error instanceof StudioDbError && error.code ? videoAssemblyCodeReason[error.code] : undefined;
    const message = error instanceof VoiceSettingsError ? error.message : reason ? videoAssemblyMessages[reason] : videoAssemblyMessages.narration_not_ready;
    await finish(false, message, null).catch(() => {});
  }
}

export async function getVideoAssemblyStatus(locationId: string, recordId: string): Promise<{ view: VideoAssemblyView | null; macOnline: boolean | null; narration: NarrationView | null }> {
  const access = await getStudioAccess(locationId);
  if (!access || !/^[0-9a-f-]{36}$/i.test(recordId)) return { view: null, macOnline: null, narration: null };
  await studioDb.call("studio_timeout_stuck_video_jobs", { p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_record_id: recordId }).catch(() => 0);
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

/** What the requester's own Mac reports about video tools, in the shape the status chip needs. Never reads another account's device. */
export async function getMacVideoStatus(locationId: string): Promise<import("./workspace/mac-status").MacStatusInput> {
  const none = { hasDevice: false, processing: false, paused: false, online: false, assemblyReady: null, missing: [] as string[] };
  const access = await getStudioAccess(locationId);
  if (!access) return none;
  const d = await studioDb.one<{ seen_at: string | null; report: Record<string, unknown>; processing_enabled: boolean; paused: boolean }>(Prisma.sql`
    select seen_at, report, processing_enabled, paused from studio.studio_devices
    where location_id = ${access.locationId} and created_by = ${access.userId} and revoked_at is null order by seen_at desc nulls last limit 1`).catch(() => null);
  if (!d) return none;
  const va = (d.report?.videoAssembly ?? null) as { ready?: unknown; missing?: unknown } | null;
  return { hasDevice: true, processing: d.processing_enabled, paused: d.paused, online: deviceOnline(d.seen_at, d.report ?? {}),
    assemblyReady: va && typeof va.ready === "boolean" ? va.ready : null,
    missing: Array.isArray(va?.missing) ? (va!.missing as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 6) : [] };
}
