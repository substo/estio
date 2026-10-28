import "server-only";
import type { StudioAccess } from "./access";
import { Prisma } from "@prisma/client";
import { studioDb } from "./studio-db";
import { listStudioRecordUploads } from "./uploads";

/** Call only after resolving the record within this authorized Location. */
export async function getStudioRecordRelations(access: StudioAccess, recordId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recordId)) throw new Error("Invalid Studio record identifier.");
  const locationId = access.locationId;
  const links = await studioDb.rows<{ id: string; title: string; kind: string }>(Prisma.sql`
    select r.id, r.title, r.kind from studio.studio_record_links l
    join studio.studio_records r on r.id = l.target_id and r.location_id = l.location_id
    where l.location_id = ${locationId} and l.source_id = ${recordId}::uuid order by r.id asc`);
  const files = await studioDb.rows<{ id: string; payload: Record<string, unknown>; media_object_id: string | null }>(Prisma.sql`
    select id, payload, media_object_id from studio.studio_legacy_files
    where location_id = ${locationId} and record_id = ${recordId}::uuid order by id asc`);
  const uploads = await listStudioRecordUploads(locationId, recordId);
  return { links, files, uploads };
}
