import "server-only";
import { Prisma } from "@prisma/client";
import type { StudioAccess } from "./access";
import { studioDb } from "./studio-db";
import { runAgentToolOn, type AgentToolData } from "./agent-tool-core";
import type { AgentObservation, AgentToolCall } from "./agent-policy";

type SourceRow = { id: string; title: string; text: string; version: number };

/** Sources this draft is linked to are the only ones the tools may read (same authority as the snapshot). */
async function linkedSources(access: StudioAccess, recordId: string) {
  return studioDb.rows<SourceRow>(Prisma.sql`
    SELECT s.id,s.title,s.version,
      left(btrim(coalesce(nullif(btrim(s.payload->>'transcript'),''),s.payload->>'description',s.payload->>'sourceDescription','')),200000) AS text
    FROM studio.studio_record_links l JOIN studio.studio_records s ON s.location_id=l.location_id AND s.id=l.target_id
    WHERE l.location_id=${access.locationId} AND l.source_id=${recordId}::uuid AND s.kind='reference' AND NOT s.archived
    ORDER BY s.id LIMIT 5`);
}

/** Authority and data access for one turn: every query is bound to the caller's Location and the draft's own links. */
export async function agentToolData(access: StudioAccess, recordId: string, stageText: (stage: string) => string): Promise<AgentToolData> {
  const sources = await linkedSources(access, recordId);
  const ids = sources.map(s => s.id);
  return {
    sources,
    stageText,
    async findings(sourceId, limit) {
      if (!ids.length || (sourceId && !ids.includes(sourceId))) return [];
      const rows = await studioDb.rows<{ evidence_id: string; statement: string; quote: string; start: string | null; source_id: string; title: string }>(Prisma.sql`
        SELECT e.id::text AS evidence_id,left(i.statement,300) AS statement,e.payload->>'quote' AS quote,e.payload->>'start_sec' AS start,s.id AS source_id,s.title
        FROM studio.studio_knowledge_insights i JOIN studio.studio_records s ON s.location_id=i.location_id AND s.id=i.source_id
        JOIN studio.studio_knowledge_evidence e ON e.location_id=i.location_id AND e.insight_id=i.id AND e.source_id=s.id
        WHERE i.location_id=${access.locationId} AND i.status='approved' AND NOT s.archived
          AND s.id=ANY(${ids}::uuid[]) AND (${sourceId}::uuid IS NULL OR s.id=${sourceId}::uuid)
          AND e.payload->>'source_version'=s.version::text AND e.payload->>'evidence_type' IN ('speech','ocr','text')
          AND char_length(btrim(e.payload->>'quote')) BETWEEN 1 AND 450
        ORDER BY i.id,e.id LIMIT ${limit}`);
      return rows.map(r => ({ evidenceId: r.evidence_id, statement: r.statement, quote: r.quote, start: r.start === null ? null : Number(r.start), sourceId: r.source_id, title: r.title }));
    },
    async knowledge(patterns, limit) {
      if (!patterns.length) return [];
      const rows = await studioDb.rows<{ evidence_id: string; statement: string; quote: string; start: string | null; source_id: string; title: string }>(Prisma.sql`
        SELECT e.id::text AS evidence_id,left(i.statement,300) AS statement,e.payload->>'quote' AS quote,e.payload->>'start_sec' AS start,s.id AS source_id,left(s.title,160) AS title
        FROM studio.studio_knowledge_insights i JOIN studio.studio_records s ON s.location_id=i.location_id AND s.id=i.source_id AND s.kind='reference' AND NOT s.archived
        JOIN studio.studio_knowledge_evidence e ON e.location_id=i.location_id AND e.insight_id=i.id AND e.source_id=s.id
        WHERE i.location_id=${access.locationId} AND i.status='approved'
          AND e.payload->>'source_version'=s.version::text AND e.payload->>'evidence_type' IN ('speech','ocr','text')
          AND char_length(btrim(e.payload->>'quote')) BETWEEN 1 AND 450
          AND lower(i.statement||' '||(e.payload->>'quote')||' '||s.title) LIKE ANY(${patterns}::text[])
        ORDER BY s.updated_at DESC,i.id,e.id LIMIT ${limit}`);
      return rows.map(r => ({ evidenceId: r.evidence_id, statement: r.statement, quote: r.quote, start: r.start === null ? null : Number(r.start), sourceId: r.source_id, title: r.title }));
    },
    async library(limit) {
      return studioDb.rows<{ id: string; title: string; description: string }>(Prisma.sql`
        SELECT id,left(title,160) AS title,left(coalesce(payload->>'description',payload->>'sourceDescription',''),160) AS description
        FROM studio.studio_records WHERE location_id=${access.locationId} AND kind='reference' AND NOT archived AND id<>ALL(${ids}::uuid[])
        ORDER BY updated_at DESC,id LIMIT ${limit}`);
    },
  };
}

export async function runAgentTool(access: StudioAccess, recordId: string, call: AgentToolCall, stageText: (stage: string) => string): Promise<AgentObservation> {
  return runAgentToolOn(await agentToolData(access, recordId, stageText), call);
}
