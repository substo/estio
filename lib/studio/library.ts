import "server-only";
import { getStudioAccess } from "./access";
import { getStudioRecordRelations } from "./record-relations";
import { Prisma } from "@prisma/client";
import { studioDb } from "./studio-db";
import type { LibraryDraft, LibraryKind } from "./library-policy";

export interface StudioLibrarySummary {
  id: string; kind: LibraryKind; title: string; version: number; updated_at: string;
  source_url: string | null; summary: string | null; approved: boolean; archived: boolean;
}
export interface StudioLibraryRecord extends StudioLibrarySummary { payload: Record<string, unknown>; }

export async function listStudioLibrary(locationId: string, page = 0) {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  const safePage = Number.isSafeInteger(page) && page >= 0 && page <= 100_000 ? page : 0;
  const rows = await studioDb.rows<StudioLibrarySummary>(Prisma.sql`
    select id, kind, title, version, updated_at, source_url, summary, approved, archived from studio.studio_records
    where location_id = ${access.locationId} and kind in ('reference', 'channel')
    order by updated_at desc, id asc limit 51 offset ${safePage * 50}`);
  return { access, records: rows.slice(0, 50), hasNext: rows.length > 50, page: safePage };
}

export async function getStudioLibraryRecord(locationId: string, recordId: string) {
  const access = await getStudioAccess(locationId);
  if (!access || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recordId)) return null;
  const record = await studioDb.one<StudioLibraryRecord>(Prisma.sql`
    select id, kind, title, version, updated_at, source_url, summary, approved, archived, payload from studio.studio_records
    where location_id = ${access.locationId} and id = ${recordId}::uuid and kind in ('reference', 'channel')`);
  if (!record) return null;
  const { links, files, uploads } = await getStudioRecordRelations(access, recordId);
  return { access, record, links, files, uploads };
}

export async function saveStudioLibraryRecord(locationId: string, recordId: string, draft: LibraryDraft, version: number) {
  const access = await getStudioAccess(locationId);
  if (!access) throw new Error("Studio access denied.");
  if (!Number.isSafeInteger(version) || version < 0 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recordId)) {
    throw new Error("Invalid Studio record request.");
  }
  return studioDb.call<StudioLibraryRecord>("studio_save_record", { p_location_id: access.locationId, p_record_id: recordId,
    p_kind: draft.kind, p_title: draft.title, p_payload_patch: draft.payload,
    p_expected_version: version, p_clerk_user_id: access.userId });
}
