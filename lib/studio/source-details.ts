import "server-only";
import { Prisma } from "@prisma/client";
import { getStudioAccess, type StudioAccess } from "./access";
import { StudioCommandError } from "./command-error";
import { StudioDbError } from "./db";
import { readSourceDetailsMeta, readSourceDetailsOutcome, readSourceDetailsRows, type SourceDetailsState } from "./source-details-policy";
import { studioDb } from "./studio-db";
import { canonicalYoutubeVideo } from "./video-transcription-policy";

async function source(locationId: string, recordId: string) {
  const access = await getStudioAccess(locationId);
  if (!access) throw new StudioCommandError("Studio access denied.", 403);
  const record = await studioDb.one<{ source_url: string | null }>(Prisma.sql`
    select source_url from studio.studio_records where location_id=${access.locationId}
     and id=${recordId}::uuid and kind='reference' and not archived`);
  const video = canonicalYoutubeVideo(record?.source_url);
  if (!record?.source_url || !video) throw new StudioCommandError("This YouTube source is unavailable.", 404);
  return { access, sourceUrl: record.source_url, video };
}

export async function readSourceDetails(access: StudioAccess, recordId: string, sourceUrl: string): Promise<SourceDetailsState> {
  const data = await studioDb.one<{ status: SourceDetailsState["status"]; error: string | null; result: Record<string, unknown> | null; meta: unknown; rows: unknown }>(Prisma.sql`
    with matching as not materialized (
      select status, last_error_message, lease_expires_at, result, created_at, id
      from studio.studio_jobs where location_id=${access.locationId} and kind='studio.source_details'
       and payload->>'recordId'=${recordId} and payload->>'sourceUrl'=${sourceUrl}
    ), latest as (
      select * from matching order by created_at desc,id desc limit 1
    )
    select case when status='running' and lease_expires_at<=clock_timestamp() then 'failed' else status end as status,
      case when status='running' and lease_expires_at<=clock_timestamp() then 'The Mac stopped before finishing.'
           when status in ('failed','cancelled') then last_error_message end as error,
      result - 'meta' as result,
      (select result->'meta' from matching where result ? 'meta' order by created_at desc,id desc limit 1) as meta,
      (select jsonb_agg(c.data order by c.position) from studio.studio_source_details_comments c where c.job_id=
        case when result->>'outcome'='reached_end' then latest.id else
          (select id from matching where result ? 'comments' order by created_at desc,id desc limit 1) end
      ) as rows from latest`);
  const rows = readSourceDetailsRows(data?.rows) ?? [];
  const latest = data?.result;
  // Count only rows from this run, even when displaying a previous fetch while the Mac gets started.
  const fetchedComments = typeof latest?.comments === "number" ? latest.comments : 0;
  const fetchedReplies = typeof latest?.replies === "number" ? latest.replies : 0;
  return {
    status: data?.status ?? "idle", error: data?.error ?? null, meta: readSourceDetailsMeta(data?.meta), rows,
    fetchedComments, fetchedReplies, outcome: readSourceDetailsOutcome(latest?.outcome),
    reason: typeof latest?.reason === "string" ? latest.reason : null,
  };
}

export async function getSourceDetails(locationId: string, recordId: string) {
  const { access, sourceUrl } = await source(locationId, recordId);
  return readSourceDetails(access, recordId, sourceUrl);
}

export async function requestSourceDetails(locationId: string, recordId: string, requestId: string) {
  const { access, sourceUrl, video } = await source(locationId, recordId);
  try {
    await studioDb.call("studio_request_source_details", {
      p_location_id: access.locationId, p_app: access.app, p_user: access.userId, p_record_id: recordId,
      p_source_url: sourceUrl, p_url: video.url, p_request_id: requestId,
    });
  } catch (error) {
    const code = error instanceof StudioDbError ? error.code : undefined;
    if (code === "SD001") throw new StudioCommandError("Fetch details needs an updated paired Mac with processing on, Chrome and yt-dlp installed.", 409);
    if (code === "42501") throw new StudioCommandError("A Studio admin can fetch details on their paired Mac.", 403);
    if (code === "P0002") throw new StudioCommandError("This YouTube source changed. Reload and try again.", 404);
    throw error;
  }
  return readSourceDetails(access, recordId, sourceUrl);
}
