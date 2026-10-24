import "server-only";

import { auth } from "@clerk/nextjs/server";
import { getStudioWorkspaceAccess } from "./access";
import { isKnowledgeId, knowledgeDetailPageQuery, knowledgeListQuery, knowledgeReviewPageQuery, maySubmitKnowledgeReview, type KnowledgeReviewAction, type KnowledgeStatus } from "./knowledge-policy";
import { queryPath, studioRest } from "./rest";

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
  workspaceId: string;
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

async function labelsForPage(workspaceId: string, rows: KnowledgeInsightSummary[]) {
  const sourceIds = [...new Set(rows.map((row) => row.source_id))];
  const topicIds = [...new Set(rows.map((row) => row.topic_id).filter((id): id is string => Boolean(id)))];
  const [sources, topics] = await Promise.all([
    sourceIds.length ? studioRest<Array<{ id: string; title: string | null }>>(queryPath("studio_knowledge_sources", {
      select: "id,title:payload->>title", workspace_id: `eq.${workspaceId}`, id: `in.(${sourceIds.join(",")})`,
    })) : Promise.resolve([]),
    topicIds.length ? studioRest<Array<{ id: string; name: string | null }>>(queryPath("studio_knowledge_topics", {
      select: "id,name:payload->>name", workspace_id: `eq.${workspaceId}`, id: `in.(${topicIds.join(",")})`,
    })) : Promise.resolve([]),
  ]);
  return {
    sourceNames: new Map(sources.map((source) => [source.id, source.title || source.id])),
    topicNames: new Map(topics.map((topic) => [topic.id, topic.name || topic.id])),
  };
}

/** Both brands resolve their own authority before any service-role query. */
export async function listStudioKnowledge(workspaceId: string, status: KnowledgeStatus, topicId: string | null, page: number) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access) return null;
  const rows = await studioRest<KnowledgeInsightSummary[]>(queryPath("studio_knowledge_insights",
    knowledgeListQuery(access.workspace.id, status, topicId, page)));
  const insights = rows.slice(0, 50);
  const labels = await labelsForPage(access.workspace.id, insights);
  return { access, insights, ...labels, hasNext: rows.length > 50, page, status, topicId };
}

/** A page of exact evidence, imported review events, and source units. */
export async function getStudioKnowledgeInsight(workspaceId: string, insightId: string, pages: { evidence: number; reviews: number; units: number }) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || !isKnowledgeId(insightId)) return null;
  const workspace = access.workspace.id;
  const insightRows = await studioRest<KnowledgeInsight[]>(queryPath("studio_knowledge_insights", {
    select: "id,source_id,topic_id,status,statement,version,payload", workspace_id: `eq.${workspace}`, id: `eq.${insightId}`, limit: "1",
  }));
  const insight = insightRows[0];
  if (!insight) return null;
  const [sourceRows, topicRows, recordRows, evidenceRows, reviewRows, unitRows] = await Promise.all([
    studioRest<KnowledgeSource[]>(queryPath("studio_knowledge_sources", {
      select: "id,total_units,covered_units,payload", workspace_id: `eq.${workspace}`, id: `eq.${insight.source_id}`, limit: "1",
    })),
    insight.topic_id ? studioRest<KnowledgeTopic[]>(queryPath("studio_knowledge_topics", {
      select: "id,payload", workspace_id: `eq.${workspace}`, id: `eq.${insight.topic_id}`, limit: "1",
    })) : Promise.resolve([]),
    studioRest<KnowledgeLibraryRecord[]>(queryPath("studio_records", {
      select: "id,kind,title", workspace_id: `eq.${workspace}`, id: `eq.${insight.source_id}`, limit: "1",
    })),
    studioRest<KnowledgeEvidence[]>(queryPath("studio_knowledge_evidence", knowledgeDetailPageQuery(
      workspace, "insight_id", insight.id, pages.evidence, "id,source_id,payload"))),
    studioRest<KnowledgeReview[]>(queryPath("studio_knowledge_reviews", knowledgeReviewPageQuery(
      workspace, insight.id, pages.reviews))),
    studioRest<KnowledgeSourceUnit[]>(queryPath("studio_knowledge_source_units", {
      ...knowledgeDetailPageQuery(workspace, "source_id", insight.source_id, pages.units, "id,transcription_id,unit_index,payload"),
      order: "unit_index.asc,id.asc",
    })),
  ]);
  // Verified frame links for the rows on this page only (at most 51 + 51 ids).
  const frameLinks = async (refKind: "evidence" | "unit", ids: string[]) => ids.length ? studioRest<Array<{ ref_id: string }>>(queryPath("studio_knowledge_media_links", {
    select: "ref_id", workspace_id: `eq.${workspace}`, ref_kind: `eq.${refKind}`, status: "eq.verified", ref_id: `in.(${ids.join(",")})`,
  })) : [];
  const [evidenceFrames, unitFrames] = await Promise.all([frameLinks("evidence", evidenceRows.map(row => row.id)), frameLinks("unit", unitRows.map(row => row.id))]);
  return {
    access, insight, source: sourceRows[0] ?? null, topic: topicRows[0] ?? null, record: recordRows[0] ?? null,
    verifiedFrames: { evidence: new Set(evidenceFrames.map(row => row.ref_id)), unit: new Set(unitFrames.map(row => row.ref_id)) },
    evidence: evidenceRows.slice(0, 50), hasMoreEvidence: evidenceRows.length > 50,
    reviews: reviewRows.slice(0, 50), hasMoreReviews: reviewRows.length > 50,
    units: unitRows.slice(0, 50), hasMoreUnits: unitRows.length > 50, pages,
  };
}

/** Resolve current host authority and actor immediately before the audited RPC. */
export async function reviewStudioKnowledgeInsight(
  workspaceId: string,
  insightId: string,
  expectedVersion: number,
  action: KnowledgeReviewAction,
  reason: string,
): Promise<KnowledgeReviewResult> {
  const access = await getStudioWorkspaceAccess(workspaceId);
  const isImpersonating = Boolean((await auth()).actor);
  if (!maySubmitKnowledgeReview({ hasWorkspaceAccess: Boolean(access), isImpersonating }) || !access) {
    throw new Error("Knowledge review access is unavailable.");
  }
  if (!isKnowledgeId(insightId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error("Invalid knowledge review request.");
  }
  return studioRest<KnowledgeReviewResult>("rpc/studio_review_knowledge_insight", {
    method: "POST",
    body: JSON.stringify({
      p_workspace_id: access.workspace.id,
      p_insight_id: insightId,
      p_action: action,
      p_expected_version: expectedVersion,
      p_actor_brand: access.brand,
      p_clerk_user_id: access.userId,
      p_reason: reason || null,
    }),
  });
}
