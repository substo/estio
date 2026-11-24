import "server-only";
import { Prisma } from "@prisma/client";
import { StudioCommandError } from "./command-error";
import { createStudioR2Store, readStudioR2Config, type StudioR2Store } from "./media-r2";
import { studioDb } from "./studio-db";
import { EXPORT_PRESIGN_SECONDS, runExportOperation } from "./video-assembly-export";

export interface AssemblyDownload { name: string; url: string; byteSize: number }
export interface SoundDownload extends AssemblyDownload { role: "music" | "sfx" }
/** Music and effect files the server made for this piece in the last two days (see renderVideoSounds). Newest of each role. */
export const SOUND_WINDOW_HOURS = 48;

/** Footage links are minted at claim time (never stored in the job): each is a short-lived private R2 read for exactly one object of this Location. */
export async function withAssemblyDownloads(jobs: unknown, store?: Pick<StudioR2Store, "presignWorkerRead">): Promise<unknown> {
  if (!Array.isArray(jobs)) return jobs;
  const config = readStudioR2Config();
  const r2 = store ?? (config ? createStudioR2Store(config) : null);
  return Promise.all(jobs.map(async job => {
    if (!job || job.kind !== "studio.video_assemble") return job;
    if (!r2) throw new StudioCommandError("Media storage is not configured.", 503);
    const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
    const ids = ((job.payload?.media ?? []) as Array<{ uploadId?: string }>).map(m => m.uploadId).filter(uuid);
    const voiceIds = ((job.payload?.voice?.uploadIds ?? []) as unknown[]).filter(uuid);
    const link = async (wanted: string[]) => {
      const rows = wanted.length ? await studioDb.rows<{ id: string; original_filename: string; object_key: string; byte_size: string }>(Prisma.sql`
        select u.id, u.original_filename, m.object_key, u.byte_size::text as byte_size from studio.studio_uploads u
        join studio.studio_media_objects m on m.id = u.media_object_id and m.location_id = u.location_id
        where u.location_id = ${job.location_id} and u.record_id = ${job.payload.recordId}::uuid and u.id = any(${wanted}::uuid[]) and u.status = 'uploaded'`) : [];
      const byId = new Map(rows.map(r => [r.id, r]));
      return Promise.all(wanted.flatMap(id => byId.has(id) ? [byId.get(id)!] : []).map(async row => ({ name: row.original_filename, byteSize: Number(row.byte_size), url: await r2.presignWorkerRead(row.object_key, EXPORT_PRESIGN_SECONDS) })));
    };
    const downloads: AssemblyDownload[] = await link(ids);
    const voiceDownloads: AssemblyDownload[] = await link(voiceIds);   // beat order = uploadIds order
    const soundRows = job.payload?.options?.music === true && uuid(job.payload?.recordId) ? await studioDb.rows<{ id: string; original_filename: string }>(Prisma.sql`
      select id, original_filename from studio.studio_uploads where location_id = ${job.location_id} and record_id = ${job.payload.recordId}::uuid and status = 'uploaded'
        and original_filename like 'Narration sound-%' and created_at > now() - make_interval(hours => ${SOUND_WINDOW_HOURS}) order by created_at desc`) : [];
    const newest = (role: "music" | "sfx") => soundRows.find(r => r.original_filename.startsWith(`Narration sound-${role} `))?.id;
    const wanted = (["music", "sfx"] as const).flatMap(role => { const id = newest(role); return id ? [{ role, id }] : []; });
    const linked = await link(wanted.map(w => w.id));
    // Same order as `wanted`, minus any whose file is not there any more.
    const soundDownloads: SoundDownload[] = linked.flatMap(d => { const role = wanted.find(w => d.name.startsWith(`Narration sound-${w.role} `))?.role; return role ? [{ ...d, role }] : []; });
    return { ...job, payload: { ...job.payload, downloads, voiceDownloads, ...(soundDownloads.length ? { soundDownloads } : {}) } };
  }));
}

export async function executeExportOperation(operation: "video_export_reserve" | "video_export_verify", call: (observed?: unknown) => Promise<unknown>) {
  const config = readStudioR2Config();
  if (!config) throw new StudioCommandError("Media storage is not configured.", 503);
  return runExportOperation(operation, call, createStudioR2Store(config));
}
