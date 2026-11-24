import "server-only";
import { Prisma } from "@prisma/client";
import { StudioCommandError } from "../command-error";
import { createStudioR2Store, readStudioR2Config, type StudioR2Store } from "../media-r2";
import { studioDb } from "../studio-db";
import { isLocalCloneSpeaker } from "./policy";

const REFERENCE_PRESIGN_SECONDS = 3600;
/** The speaker a claimed job wants: a video-assembly job names it in `voice`, a preview job in `speaker`. */
export const jobSpeaker = (job: { kind?: unknown; payload?: Record<string, unknown> }): string | null => {
  const p = job.payload ?? {};
  const voice = p.voice as { engine?: unknown; speaker?: unknown } | undefined;
  const speaker = job.kind === "studio.voice_preview" ? p.speaker : voice?.engine === "local" ? voice.speaker : null;
  return typeof speaker === "string" ? speaker : null;
};

/** For an on-device clone, hand the Mac short-lived links to its own reference recording and transcript. Minted at claim time (never stored in the job), only after the voice row
 *  is confirmed to be an on-device clone of the job's own Location; the object keys are derived from that row, never from the payload. */
export async function withVoiceReferences(jobs: unknown, deps: { store?: Pick<StudioR2Store, "presignWorkerRead">; exists?: (locationId: string, speaker: string) => Promise<boolean> } = {}): Promise<unknown> {
  if (!Array.isArray(jobs)) return jobs;
  const wanted = jobs.some(j => j && (j.kind === "studio.video_assemble" || j.kind === "studio.voice_preview") && isLocalCloneSpeaker(jobSpeaker(j)));
  if (!wanted) return jobs;
  const config = readStudioR2Config();
  const r2 = deps.store ?? (config ? createStudioR2Store(config) : null);
  if (!r2) throw new StudioCommandError("Media storage is not configured.", 503);
  const exists = deps.exists ?? (async (locationId: string, speaker: string) => (await studioDb.rows<{ n: number }>(Prisma.sql`
    select 1 as n from studio.studio_voices where location_id = ${locationId} and provider = 'local' and kind = 'clone' and provider_voice_id = ${speaker} limit 1`)).length > 0);
  return Promise.all(jobs.map(async job => {
    const speaker = job && (job.kind === "studio.video_assemble" || job.kind === "studio.voice_preview") ? jobSpeaker(job) : null;
    if (!isLocalCloneSpeaker(speaker)) return job;
    if (!await exists(job.location_id, speaker)) return job;   // no reference: the Mac reports a clear failure instead of guessing
    const id = speaker.slice("clone-".length), base = `${job.location_id}/voice-refs/${id}`;
    return { ...job, payload: { ...job.payload, voiceReference: { id, audioUrl: await r2.presignWorkerRead(`${base}.wav`, REFERENCE_PRESIGN_SECONDS), textUrl: await r2.presignWorkerRead(`${base}.json`, REFERENCE_PRESIGN_SECONDS) } } };
  }));
}
