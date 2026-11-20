import "server-only";
import { Prisma } from "@prisma/client";
import { studioDb } from "./studio-db";
import { getStudioAccess } from "./access";
import { relatedAnchor } from "./youtube-bookmark";
import { relatedTraceSchema, type RelatedTrace } from "./related-search-policy";

export interface RelatedRunView { id: string; createdAt: string; route: string; mode: string; trace: RelatedTrace }
/** The reasoning log of Related-video runs for one source or idea: queries, prompts, model, scores. Members of the Location only. */
export async function listRelatedRuns(locationId: string, anchorId: string) {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  const anchor = await relatedAnchor(studioDb, access.locationId, anchorId).catch(() => null);
  if (!anchor) return null;
  const rows = await studioDb.rows<{ id: string; created_at: string; route: string; mode: string; trace: unknown }>(Prisma.sql`
    select id, created_at, route, mode, trace from studio.studio_related_runs where location_id = ${access.locationId} and anchor_id = ${anchor.id}::uuid order by created_at desc limit 30`);
  const runs = rows.flatMap((row): RelatedRunView[] => { const trace = relatedTraceSchema.safeParse(row.trace); return trace.success ? [{ id: row.id, createdAt: row.created_at, route: row.route, mode: row.mode, trace: trace.data }] : []; });
  return { anchor: { id: anchor.id, title: anchor.title, kind: anchor.kind }, runs };
}
