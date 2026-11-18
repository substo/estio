import { Prisma } from "@prisma/client";
import { YoutubeError } from "../google/youtube-api";
import type { StudioDb } from "./db";
import { createRecordLinkService } from "./record-link-service";
import { recordLinkId } from "./record-link-policy";
import { relatedYoutubeSourceId } from "./youtube-related-policy";
import type { openYoutubeSelection } from "./youtube-selection";

type YoutubeSelection = NonNullable<ReturnType<typeof openYoutubeSelection>>;
type YoutubeAuthority = { locationId: string; app: "estio" | "substo"; userId: string };

export function saveYoutubeSelection(store: StudioDb, access: YoutubeAuthority, selection: YoutubeSelection, title: unknown) {
  if (typeof title !== "string" || !title.trim() || title.trim().length > 180) throw new YoutubeError("invalid_title", "Enter a research title, up to 180 characters.");
  return store.call<string>("studio_save_youtube_bookmark", { p_location: access.locationId, p_app: access.app, p_user: access.userId,
    p_record: selection.recordId, p_video: selection.videoId, p_title: title.trim(), p_provenance: selection.provenance });
}

export async function relatedAnchor(store: StudioDb, locationId: string, anchorId: unknown, lock = false) {
  if (typeof anchorId !== "string" || !recordLinkId(anchorId)) throw new YoutubeError("invalid_anchor", "Choose a saved source or idea.");
  const record = await store.one<{ id: string; title: string; version: number; source_url: string | null; topic: string | null }>(Prisma.sql`
    select id, title, version, source_url,
      left(coalesce(nullif(payload->>'aiSummary',''), nullif(payload->>'description',''),
        nullif(payload->>'summary',''), payload->>'transcript'), 2400) as topic
    from studio.studio_records where location_id = ${locationId} and id = ${anchorId}::uuid and not archived
      and (kind = 'reference' or (kind = 'content' and payload->>'stage' = 'idea'))
    ${lock ? Prisma.sql`for no key update` : Prisma.empty}`);
  if (!record) throw new YoutubeError("invalid_anchor", "Choose an active source or idea in this Location.");
  return record;
}

/** Call inside a transaction so a failed link rolls back a new bookmark. */
export async function saveLinkedYoutubeSelection(store: StudioDb, access: YoutubeAuthority, anchorId: string, selection: YoutubeSelection, title: unknown) {
  // Take the same profile and Location locks as ordinary bookmark saves before locking the anchor.
  const recordId = await saveYoutubeSelection(store, access, selection, title);
  const anchor = await relatedAnchor(store, access.locationId, anchorId, true);
  if (recordId === anchor.id || selection.videoId === relatedYoutubeSourceId(anchor.source_url)) {
    throw new YoutubeError("self_reference", "This video is already the starting source.");
  }
  const target = await store.one(Prisma.sql`select id from studio.studio_records
    where location_id = ${access.locationId} and id = ${recordId}::uuid and kind = 'reference' and not archived for share`);
  if (!target) throw new YoutubeError("archived_reference", "This video is archived in the Library. Restore it before linking.");
  const links = createRecordLinkService({ authorize: async () => access, isImpersonating: async () => false, db: store });
  await links.change(access.locationId, anchor.id, recordId, Number(anchor.version), "add");
  return recordId;
}
