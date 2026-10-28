import "server-only";

import { auth } from "@clerk/nextjs/server";
import { getStudioAccess } from "./access";
import { Prisma } from "@prisma/client";
import { isKnowledgeId, knowledgeListQuery, maySubmitKnowledgeReview, type KnowledgeReviewAction, type KnowledgeStatus } from "./knowledge-policy";
import { studioDb } from "./studio-db";

type KnowledgePayload = Record<string, unknown>;

export interface KnowledgeInsightSummary {
  id: string;
  source_id: string;
  topic_id: string | null;
  status: "pending" | "approved" | "rejected";
  statement: string;
  kind: string | null;
  suggested_topic: string | null;
}

export interface KnowledgeInsight extends Omit<KnowledgeInsightSummary, "kind" | "suggested_topic"> {
  version: number;
  payload: KnowledgePayload;
}

export interface KnowledgeReviewResult {
  locationId: string;
  insightId: string;
  reviewId: string;
  previousStatus: "pending" | "approved" | "rejected";
  status: "pending" | "approved" | "rejected";
  version: number;
  at: string;
}

export interface KnowledgeSource {
  id: string;
  total_units: number;
  covered_units: number;
  payload: KnowledgePayload;
}

export interface KnowledgeTopic { id: string; payload: KnowledgePayload; }
export interface KnowledgeEvidence { id: string; source_id: string; payload: KnowledgePayload; }
export interface KnowledgeReview { id: string; payload: KnowledgePayload; }
export interface KnowledgeSourceUnit { id: string; transcription_id: string; unit_index: number; payload: KnowledgePayload; }
export interface KnowledgeLibraryRecord { id: string; kind: string; title: string; }

async function labelsForPage(locationId: string, rows: KnowledgeInsightSummary[]) {
  const sourceIds = [...new Set(rows.map((row) => row.source_id))];
  const topicIds = [...new Set(rows.map((row) => row.topic_id).filter((id): id is string => Boolean(id)))];
  const [sources, topics] = await Promise.all([
    sourceIds.length ? studioDb.rows<{ id: string; title: string | null }>(Prisma.sql`
      select id, payload->>'title' as title from studio.studio_knowledge_sources where location_id = ${locationId} and id = any(${sourceIds}::uuid[])`) : Promise.resolve([]),
    topicIds.length ? studioDb.rows<{ id: string; name: string | null }>(Prisma.sql`
      select id, payload->>'name' as name from studio.studio_knowledge_topics where location_id = ${locationId} and id = any(${topicIds}::uuid[])`) : Promise.resolve([]),
  ]);
  return {
    sourceNames: new Map(sources.map((source) => [source.id, source.title || source.id])),
    topicNames: new Map(topics.map((topic) => [topic.id, topic.name || topic.id])),
  };
}

/** Both apps resolve their own authority before any Studio query. */
export async function listStudioKnowledge(locationId: string, status: KnowledgeStatus, topicId: string | null, page: number) {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  const rows = await studioDb.rows<KnowledgeInsightSummary>(knowledgeListQuery(access.locationId, status, topicId, page));
  const insights = rows.slice(0, 50);
  const labels = await labelsForPage(access.locationId, insights);
  return { access, insights, ...labels, hasNext: rows.length > 50, page, status, topicId };
}

/** A page of exact evidence, imported review events, and source units. */
export async function getStudioKnowledgeInsight(locationId: string, insightId: string, pages: { evidence: number; reviews: number; units: number }) {
  const access = await getStudioAccess(locationId);
  if (!access || !isKnowledgeId(insightId)) return null;
  const location = access.locationId;
  const insight = await studioDb.one<KnowledgeInsight>(Prisma.sql`
    select id, source_id, topic_id, status, statement, version, payload from studio.studio_knowledge_insights
    where location_id = ${location} and id = ${insightId}::uuid`);
  if (!insight) return null;
  // One page of each list: 51 rows tell whether there is a next page.
  const [source, topic, record, evidenceRows, reviewRows, unitRows] = await Promise.all([
    studioDb.one<KnowledgeSource>(Prisma.sql`
      select id, total_units, covered_units, payload from studio.studio_knowledge_sources where location_id = ${location} and id = ${insight.source_id}::uuid`),
    insight.topic_id ? studioDb.one<KnowledgeTopic>(Prisma.sql`
      select id, payload from studio.studio_knowledge_topics where location_id = ${location} and id = ${insight.topic_id}::uuid`) : Promise.resolve(null),
    studioDb.one<KnowledgeLibraryRecord>(Prisma.sql`
      select id, kind, title from studio.studio_records where location_id = ${location} and id = ${insight.source_id}::uuid`),
    studioDb.rows<KnowledgeEvidence>(Prisma.sql`
      select id, source_id, payload from studio.studio_knowledge_evidence where location_id = ${location} and insight_id = ${insight.id}::uuid
      order by id asc limit 51 offset ${pages.evidence * 50}`),
    // Imported review IDs are random UUIDs; event time orders the history.
    studioDb.rows<KnowledgeReview>(Prisma.sql`
      select id, payload from studio.studio_knowledge_reviews where location_id = ${location} and insight_id = ${insight.id}::uuid
      order by payload->>'at' asc, id asc limit 51 offset ${pages.reviews * 50}`),
    studioDb.rows<KnowledgeSourceUnit>(Prisma.sql`
      select id, transcription_id, unit_index, payload from studio.studio_knowledge_source_units where location_id = ${location} and source_id = ${insight.source_id}::uuid
      order by unit_index asc, id asc limit 51 offset ${pages.units * 50}`),
  ]);
  // Verified frame links for the rows on this page only (at most 51 + 51 ids).
  const frameLinks = async (refKind: "evidence" | "unit", ids: string[]) => ids.length ? studioDb.rows<{ ref_id: string }>(Prisma.sql`
    select ref_id from studio.studio_knowledge_media_links
    where location_id = ${location} and ref_kind = ${refKind} and status = 'verified' and ref_id = any(${ids}::uuid[])`) : [];
  const [evidenceFrames, unitFrames] = await Promise.all([frameLinks("evidence", evidenceRows.map(row => row.id)), frameLinks("unit", unitRows.map(row => row.id))]);
  return {
    access, insight, source, topic, record,
    verifiedFrames: { evidence: new Set(evidenceFrames.map(row => row.ref_id)), unit: new Set(unitFrames.map(row => row.ref_id)) },
    evidence: evidenceRows.slice(0, 50), hasMoreEvidence: evidenceRows.length > 50,
    reviews: reviewRows.slice(0, 50), hasMoreReviews: reviewRows.length > 50,
    units: unitRows.slice(0, 50), hasMoreUnits: unitRows.length > 50, pages,
  };
}

/** Resolve current host authority and actor immediately before the audited RPC. */
export async function reviewStudioKnowledgeInsight(
  locationId: string,
  insightId: string,
  expectedVersion: number,
  action: KnowledgeReviewAction,
  reason: string,
): Promise<KnowledgeReviewResult> {
  const access = await getStudioAccess(locationId);
  const isImpersonating = Boolean((await auth()).actor);
  if (!maySubmitKnowledgeReview({ hasLocationAccess: Boolean(access), isImpersonating }) || !access) {
    throw new Error("Knowledge review access is unavailable.");
  }
  if (!isKnowledgeId(insightId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error("Invalid knowledge review request.");
  }
  return studioDb.call<KnowledgeReviewResult>("studio_review_knowledge_insight", {
    p_location_id: access.locationId,
    p_insight_id: insightId,
    p_action: action,
    p_expected_version: expectedVersion,
    p_actor_app: access.app,
    p_clerk_user_id: access.userId,
    p_reason: reason || null,
  });
}
