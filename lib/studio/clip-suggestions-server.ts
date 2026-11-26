import "server-only";
import { Prisma } from "@prisma/client";
import { StudioCommandError } from "./command-error";
import { addSuggestedClip, defaultCredit, suggestClips, type ClipSource, type ClipSuggestion, type TimedSegment } from "./clip-suggestions";
import { getStudioContentRecord, saveStudioContentRecord } from "./content";
import { blocksDoc, blocksToScript, reconcileBlocks } from "./script-blocks";
import { studioDb } from "./studio-db";

/** The piece's uploaded videos that have a finished transcript, with its timed lines. */
async function clipSources(locationId: string, recordId: string): Promise<ClipSource[]> {
  const uploads = await studioDb.rows<{ id: string; original_filename: string }>(Prisma.sql`select id, original_filename from studio.studio_uploads where location_id = ${locationId} and record_id = ${recordId}::uuid and status = 'uploaded' and content_type like 'video/%' order by created_at desc limit 12`);
  if (!uploads.length) return [];
  const chunks = await studioDb.rows<{ upload_id: string; segments: unknown }>(Prisma.sql`select upload_id, segments from studio.studio_transcript_chunks where location_id = ${locationId} and upload_id = any(${uploads.map(u => u.id)}::uuid[]) order by upload_id, chunk_index`);
  return uploads.map(u => {
    const segments: TimedSegment[] = [];
    for (const c of chunks.filter(x => x.upload_id === u.id)) for (const s of Array.isArray(c.segments) ? c.segments as Array<Record<string, unknown>> : [])
      if (typeof s?.start === "number" && typeof s?.end === "number" && typeof s?.text === "string") segments.push({ start: s.start, end: s.end, text: s.text });
    return { uploadId: u.id, name: u.original_filename, segments };
  }).filter(s => s.segments.length);
}

/** Moments in the piece's own uploaded videos that support lines of the saved script. Empty when there is no transcribed video yet. */
export async function getClipSuggestions(locationId: string, recordId: string): Promise<{ suggestions: ClipSuggestion[]; videos: number }> {
  const found = await getStudioContentRecord(locationId, recordId);
  if (!found || found.record.archived) return { suggestions: [], videos: 0 };
  const sources = await clipSources(locationId, recordId);
  return { suggestions: suggestClips(reconcileBlocks(found.record.payload), sources), videos: sources.length };
}

/** Approve one suggestion: it is added to the script as a source clip block, which Make video then places. The upload and its times are checked against this piece's own transcribed video, not taken from the page. */
export async function approveClipSuggestion(locationId: string, recordId: string, pick: { blockId: string; uploadId: string; start: number; end: number }) {
  const found = await getStudioContentRecord(locationId, recordId);
  if (!found || found.record.archived) throw new StudioCommandError("This piece could not be found.", 404);
  const sources = await clipSources(locationId, recordId);
  const source = sources.find(s => s.uploadId === pick.uploadId);
  const last = Math.max(0, ...(source?.segments.map(s => s.end) ?? [0]));
  if (!source || !(pick.start >= 0) || !(pick.end <= last + 1)) throw new StudioCommandError("That clip is not in this piece's uploaded video.");
  const blocks = addSuggestedClip(reconcileBlocks(found.record.payload), { ...pick, credit: defaultCredit(source.name) });
  if (!blocks) throw new StudioCommandError("The clip could not be added. Check the line it belongs to, or remove a source clip first.");
  await saveStudioContentRecord(locationId, recordId, { kind: "content", title: found.record.title, payload: { title: found.record.title, scriptBlocks: blocksDoc(blocks), script: blocksToScript(blocks) } }, found.record.version);
}
