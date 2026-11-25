import "server-only";
import { Prisma } from "@prisma/client";
import type { StudioAccess } from "./access";
import { studioDb } from "./studio-db";

/** The Library page has already authorized this source in the caller's Location. */
export async function getKnowledgeSourceCitation(access: StudioAccess, sourceId: string, evidenceId: string) {
  return studioDb.one<{ quote: string; onScreen: boolean }>(Prisma.sql`
    SELECT e.payload->>'quote' AS quote, coalesce(e.payload->>'evidence_type'='ocr',false) AS "onScreen"
    FROM studio.studio_knowledge_evidence e
    JOIN studio.studio_knowledge_insights i ON i.location_id=e.location_id AND i.id=e.insight_id AND i.source_id=e.source_id
    WHERE e.location_id=${access.locationId} AND e.source_id=${sourceId}::uuid AND e.id=${evidenceId}::uuid
      AND char_length(btrim(e.payload->>'quote')) BETWEEN 1 AND 2000`);
}
