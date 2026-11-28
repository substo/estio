import "server-only";
import { Prisma } from "@prisma/client";
import { getStudioAccess } from "./access";
import { StudioCommandError } from "./command-error";
import { StudioDbError } from "./db";
import { studioDb } from "./studio-db";
import { HIGHLIGHT_KINDS, type HighlightKind, type SourceHighlight } from "./source-highlights";

export async function getSourceHighlights(locationId: string, recordId: string): Promise<SourceHighlight[]> {
  const access = await getStudioAccess(locationId);
  if (!access) return [];
  const rows = await studioDb.rows<{ kind: HighlightKind; item_key: string; excerpt: string; at_seconds: number | null }>(Prisma.sql`
    select kind,item_key,excerpt,at_seconds from studio.studio_source_highlights where location_id=${access.locationId} and record_id=${recordId}::uuid order by created_at limit 100`);
  return rows.map(r => ({ kind: r.kind, key: r.item_key, excerpt: r.excerpt, at: r.at_seconds }));
}

export async function toggleSourceHighlight(locationId: string, command: { recordId: string; kind: HighlightKind; key: string; excerpt: string; at: number | null }): Promise<{ highlighted: boolean }> {
  const access = await getStudioAccess(locationId);
  if (!access) throw new StudioCommandError("Studio access denied.", 403);
  try {
    const highlighted = await studioDb.call<boolean>("studio_toggle_source_highlight", { p_location_id: access.locationId, p_clerk_user_id: access.userId, p_record_id: command.recordId,
      p_kind: command.kind, p_key: command.key, p_excerpt: command.excerpt, p_at: command.at });
    return { highlighted };
  } catch (error) {
    if (error instanceof StudioDbError && error.code === "P0002") throw new StudioCommandError("This source is unavailable.", 404);
    if (error instanceof StudioDbError && error.code === "22023") throw new StudioCommandError("A source can hold up to 100 highlights. Remove one first.", 409);
    throw error;
  }
}
export const validHighlightKind = (kind: unknown): kind is HighlightKind => typeof kind === "string" && (HIGHLIGHT_KINDS as readonly string[]).includes(kind);

/** Why the last summary attempt failed, in the words the Mac or server recorded. */
export async function getSummaryFailure(locationId: string, recordId: string): Promise<string | null> {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  const row = await studioDb.one<{ message: string | null; code: string | null }>(Prisma.sql`
    select j.last_error_message as message,j.last_error_code as code from studio.studio_library_summary_requests r join studio.studio_jobs j on j.id=r.job_id
    where r.location_id=${access.locationId} and r.record_id=${recordId}::uuid`);
  return row?.message ?? (row?.code ? `The summary could not be made (${row.code.replace(/_/g, " ")}).` : null);
}

/** Highlights for the agent's context; empty when the source has none or access is missing. */
export const highlightsForAgent = (locationId: string, sourceId: string | null) => sourceId ? getSourceHighlights(locationId, sourceId).catch(() => []) : Promise.resolve([]);
