import "server-only";
import { Prisma } from "@prisma/client";
import type { StudioAccess } from "./access";
import { studioDb } from "./studio-db";
import { type TranscriptSegment } from "./video-transcription-policy";
import { matchTimedSourceQuote } from "./script-source-quotes";

/** The Library page has already authorized this source in the caller's Location. */
export async function getKnowledgeSourceCitation(access: StudioAccess, sourceId: string, evidenceId: string) {
  return studioDb.one<{ quote: string; onScreen: boolean }>(Prisma.sql`
    SELECT e.payload->>'quote' AS quote, coalesce(e.payload->>'evidence_type'='ocr',false) AS "onScreen"
    FROM studio.studio_knowledge_evidence e
    JOIN studio.studio_knowledge_insights i ON i.location_id=e.location_id AND i.id=e.insight_id AND i.source_id=e.source_id
    WHERE e.location_id=${access.locationId} AND e.source_id=${sourceId}::uuid AND e.id=${evidenceId}::uuid
      AND char_length(btrim(e.payload->>'quote')) BETWEEN 1 AND 2000`);
}


/** Read only the authorized source's original evidence metadata. A verified frame link refers to a private stored object. */
export async function getSourceClipMetadata(access: StudioAccess, sourceId: string, evidenceId: string | null) {
  return studioDb.one<{ title: string; url: string | null; sourceUrl: string | null; at: unknown; until: unknown; onScreen: boolean; frame: boolean }>(Prisma.sql`
    select r.title, coalesce(e.payload->>'source_url',r.source_url,r.payload->>'url') as url, r.source_url as "sourceUrl",
      e.payload->'start_sec' as at, e.payload->'end_sec' as until,
      coalesce(e.payload->>'evidence_type'='ocr',false) as "onScreen",
      exists(select 1 from studio.studio_knowledge_media_links m where m.location_id=r.location_id
        and m.ref_kind='evidence' and m.ref_id=e.id and m.status='verified') as frame
    from studio.studio_records r
    left join studio.studio_knowledge_evidence e on e.location_id=r.location_id and e.source_id=r.id and e.id=${evidenceId}::uuid
      and (e.payload->>'source_version' is null or e.payload->>'source_version'=r.version::text)
    where r.location_id=${access.locationId} and r.id=${sourceId}::uuid and r.kind='reference' and not r.archived`);
}

/** Read the completed transcript already scoped to this Location, source and video. */
export async function getVerifiedQuoteTiming(access: StudioAccess, transcriptionId: string, quote: string) {
  const chunks = await studioDb.rows<{ segments: TranscriptSegment[] }>(Prisma.sql`
    select segments from studio.studio_video_transcript_chunks
    where location_id=${access.locationId} and transcription_id=${transcriptionId}::uuid
    order by chunk_index`);
  return matchTimedSourceQuote(quote, chunks.flatMap(chunk => chunk.segments));
}
