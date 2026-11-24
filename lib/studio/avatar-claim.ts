import { avatarFileName, avatarObjectKey } from "./avatar-policy";

const SIGNED_SECONDS = 3600;
export interface AvatarDownload { name: string; url: string; byteSize: number; contentType: string }
type Store = { presignWorkerRead(key: string, seconds?: number): Promise<string> };
type Job = { kind?: unknown; location_id?: unknown; created_by_clerk_user_id?: unknown; payload?: Record<string, unknown> } & Record<string, unknown>;

/** Claim time: give a video job's own Mac a short-lived private link to the photo of the person who made the video, if they saved one. Never stored in the job, never for anyone else. */
export async function attachStoryboardAvatar(jobs: unknown[], store: Store | null, lookup: (locationId: string, userId: string) => Promise<{ contentType: string; byteSize: number } | null>): Promise<unknown[]> {
  return Promise.all(jobs.map(async raw => {
    const job = raw as Job;
    if (!store || job?.kind !== "studio.video_assemble" || typeof job.created_by_clerk_user_id !== "string" || typeof job.location_id !== "string") return raw;
    try {
      const meta = await lookup(job.location_id, job.created_by_clerk_user_id);
      if (!meta) return raw;
      const avatar: AvatarDownload = { name: avatarFileName(meta.contentType), contentType: meta.contentType, byteSize: meta.byteSize, url: await store.presignWorkerRead(avatarObjectKey(job.location_id, job.created_by_clerk_user_id), SIGNED_SECONDS) };
      return { ...job, payload: { ...job.payload, avatar } };
    } catch { return raw; }   // the picture is a nicety: a lookup failure never blocks the video
  }));
}
