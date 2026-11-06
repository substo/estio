import "server-only";
import { libraryImportTarget, safeLibraryThumbnailUrl } from "./library-import-metadata";
import { getStudioAccess } from "./access";
import { getStudioRecordRelations } from "./record-relations";
import { Prisma } from "@prisma/client";
import { studioDb } from "./studio-db";
import type { LibraryPlatform } from "./library-presentation";
import type { LibraryDraft, LibraryKind } from "./library-policy";

export interface StudioLibrarySummary {
  id: string; kind: LibraryKind; title: string; version: number; updated_at: string;
  payload: Record<string, unknown>; source_url: string | null; summary: string | null; approved: boolean; archived: boolean;
}
export interface StudioLibraryRecord extends StudioLibrarySummary { payload: Record<string, unknown>; }

export async function listStudioLibrary(locationId: string, page = 0, filters: { kind?: LibraryKind; platform?: LibraryPlatform } = {}) {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  const safePage = Number.isSafeInteger(page) && page >= 0 && page <= 100_000 ? page : 0;
  const platform = Prisma.sql`case
      when lower(trim(payload->>'platform')) = 'twitter' then 'x'
      when lower(trim(payload->>'platform')) in ('youtube','instagram','tiktok','facebook','linkedin','x','other') then lower(trim(payload->>'platform'))
      when lower(coalesce(nullif(source_url,''),payload->>'url',payload->>'sourceUrl',payload->>'source_url','')) ~ '^https?://([^/@]+[.])?(youtube[.]com|youtu[.]be)([:/]|$)' then 'youtube'
      when lower(coalesce(nullif(source_url,''),payload->>'url',payload->>'sourceUrl',payload->>'source_url','')) ~ '^https?://([^/@]+[.])?(twitter[.]com|x[.]com)([:/]|$)' then 'x'
      when lower(coalesce(nullif(source_url,''),payload->>'url',payload->>'sourceUrl',payload->>'source_url','')) ~ '^https?://([^/@]+[.])?(facebook[.]com|fb[.]watch)([:/]|$)' then 'facebook'
      else coalesce(substring(lower(coalesce(nullif(source_url,''),payload->>'url',payload->>'sourceUrl',payload->>'source_url','')) from '^https?://(?:[^/@]+[.])?(instagram|tiktok|linkedin)[.]com(?:[:/]|$)'), 'other') end`;
  const rows = await studioDb.rows<StudioLibrarySummary>(Prisma.sql`
    select id, kind, title, version, updated_at, source_url, summary, approved, archived, payload from studio.studio_records
    where location_id = ${access.locationId} and kind in ('reference', 'channel')
    ${filters.kind ? Prisma.sql`and kind = ${filters.kind}` : Prisma.empty}
    ${filters.platform ? Prisma.sql`and (${platform}) = ${filters.platform}` : Prisma.empty}
    order by updated_at desc, id asc limit 51 offset ${safePage * 50}`);
  return { access, records: rows.slice(0, 50).map(exposeLibraryMetadata), hasNext: rows.length > 50, page: safePage };
}

export async function getStudioLibraryRecord(locationId: string, recordId: string) {
  const access = await getStudioAccess(locationId);
  if (!access || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recordId)) return null;
  const record = await studioDb.one<StudioLibraryRecord>(Prisma.sql`
    select id, kind, title, version, updated_at, source_url, summary, approved, archived, payload from studio.studio_records
    where location_id = ${access.locationId} and id = ${recordId}::uuid and kind in ('reference', 'channel')`);
  if (!record) return null;
  const { links, files, uploads } = await getStudioRecordRelations(access, recordId, true);
  return { access, record: exposeLibraryMetadata(record), links, files, uploads };
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

/** Read-only aliases and known YouTube image fallback; never rewrites legacy evidence. */
function exposeLibraryMetadata<T extends StudioLibrarySummary>(record: T): T {
  const payload = { ...record.payload };
  for (const key of ['thumbnailUrl','thumbnail_url','thumbnail','imageUrl','image_url','avatarUrl','avatar_url']) {
    if (key in payload) payload[key] = safeLibraryThumbnailUrl(payload[key]);
  }
  const thumbnail = payload.thumbnailUrl || payload.thumbnail_url || payload.thumbnail || payload.imageUrl;
  payload.thumbnailUrl = safeLibraryThumbnailUrl(thumbnail);
  payload.channelName ||= payload.channelTitle || payload.channel_name || payload.authorName || '';
  payload.description ||= payload.sourceDescription || '';
  payload.summaryStatus ||= record.summary ? 'legacy_unverified' : 'not_generated';
  try {
    const target = libraryImportTarget(String(record.source_url || payload.url || payload.sourceUrl || ''));
    payload.platform ||= target.platform;
    payload.format ||= target.kind === 'channel' ? 'channel' : target.format;
    if (!payload.thumbnailUrl && target.videoId) payload.thumbnailUrl = `https://i.ytimg.com/vi/${target.videoId}/hqdefault.jpg`;
  } catch { /* Historical sources remain readable when they cannot be imported. */ }
  return { ...record, payload };
}
