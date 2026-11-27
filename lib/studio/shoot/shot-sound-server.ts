import "server-only";
import { Prisma } from "@prisma/client";
import { studioDb } from "../studio-db";
import { getUploadTranscriptStates } from "../upload-transcripts";
import { soundFromTranscript, type ShotSound } from "./shot-sound";

/** What the Shoot page can say about one filmed shot's sound. `plan` is null until the clip has been checked on the creator's Mac. */
export interface ShotSoundState { uploadId: string; plan: ShotSound | null; checking: boolean; failed: boolean }

/**
 * Whether each current take's own sound will be used, from the same rule the Mac applies when it makes the video (speech that matches the line).
 * A finished check with no stored speech means the Mac heard none, so the voiceover plays over that clip.
 */
export async function getShotSoundStates(locationId: string, files: { id: string }[], lines: Map<string, string>): Promise<Record<string, ShotSoundState>> {
  if (!files.length) return {};
  const ids = files.map(f => f.id);
  const states = await getUploadTranscriptStates(locationId, ids).catch(() => []);
  const rows = await studioDb.rows<{ upload_id: string; segments: unknown }>(Prisma.sql`select upload_id, segments from studio.studio_transcripts where location_id = ${locationId} and upload_id = any(${ids}::uuid[])`).catch(() => []);
  const out: Record<string, ShotSoundState> = {};
  for (const f of files) {
    const state = states.find(s => s.uploadId === f.id);
    const text = rows.filter(r => r.upload_id === f.id).flatMap(r => Array.isArray(r.segments) ? r.segments as Array<Record<string, unknown>> : []).map(s => typeof s?.text === "string" ? s.text : "").join(" ").trim();
    const done = Boolean(state?.transcribed) || state?.status === "succeeded";
    out[f.id] = { uploadId: f.id, plan: done || text ? soundFromTranscript(text, lines.get(f.id) ?? "") : null, checking: state?.status === "queued" || state?.status === "running", failed: state?.status === "failed" || state?.status === "cancelled" };
  }
  return out;
}
