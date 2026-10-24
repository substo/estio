import "server-only";
import { getPlatformProfile } from "../platform/profile";
import { getStudioWorkspaceAccess } from "./access";
import { queryPath, studioRest } from "./rest";
import { canReviewTranscription, ReconciliationError, type ReconciliationCommand } from "./transcription-reconciliation-policy";

async function requireManager(workspaceId: string) {
  const [profile, access] = await Promise.all([getPlatformProfile(), getStudioWorkspaceAccess(workspaceId)]);
  if (!profile || !access || !canReviewTranscription(profile, access)) {
    throw new ReconciliationError("Only a workspace AI manager, signed in as themselves, can review paid attempts.", 403);
  }
  return access;
}

export async function reviewStudioTranscription(workspaceId: string, command: ReconciliationCommand) {
  const access = await requireManager(workspaceId);
  return studioRest("rpc/studio_review_ai_attempt", { method: "POST", body: JSON.stringify({
    p_workspace_id: access.workspace.id, p_actor_brand: access.brand, p_clerk_user_id: access.userId,
    p_attempt_id: command.attemptId, p_request_id: command.requestId, p_expected_version: command.expectedVersion,
    p_action: command.action, p_evidence: command.evidence, p_cost_micros: command.costMicros, p_confirm_paid: command.confirmPaid }) });
}

export interface ReviewedTranscriptionAttempt {
  id: string; job_id: string; operation: string; idea_review_id: string | null; upload_id: string | null; chunk_index: number | null; duration_seconds: number | null; status: string;
  review_version: number; billing_outcome: "no_charge" | "billed" | null; replacement_authorized: boolean;
  created_at: string; usage_id: string;
}
export interface TranscriptionReviewEvent {
  id: string; attempt_id: string; actor_clerk_user_id: string; action: string; evidence: string;
  cost_micros: number | null; created_at: string; version: number;
}

export async function listStudioTranscriptionReviews(workspaceId: string, page: number) {
  let access;
  try { access = await requireManager(workspaceId); }
  catch (error) { if (error instanceof ReconciliationError) return null; throw error; }
  const workspace = access.workspace.id;
  const rows = await studioRest<ReviewedTranscriptionAttempt[]>(queryPath("studio_ai_attempts", {
    select: "id,job_id,operation,idea_review_id,upload_id,chunk_index,duration_seconds,status,review_version,billing_outcome,replacement_authorized,created_at,usage_id",
    workspace_id: `eq.${workspace}`, status: "in.(started,uncertain)", order: "created_at.desc,id.asc", limit: "26", offset: String(page * 25) }));
  const attempts = rows.slice(0, 25);
  if (!attempts.length) return { attempts, events: [], usage: [], hasMore: false };
  const [events, usage] = await Promise.all([
    studioRest<TranscriptionReviewEvent[]>(queryPath("studio_ai_attempt_reviews", {
      select: "id,attempt_id,actor_clerk_user_id,action,evidence,cost_micros,created_at,version", workspace_id: `eq.${workspace}`,
      attempt_id: `in.(${attempts.map(a => a.id).join(",")})`, order: "created_at.asc,id.asc", limit: "100" })),
    studioRest<Array<{ id: string; status: string; reserved_micros: number; cost_micros: number | null; usage_month: string }>>(queryPath("studio_ai_usage", {
      select: "id,status,reserved_micros,cost_micros,usage_month", workspace_id: `eq.${workspace}`,
      id: `in.(${attempts.map(a => a.usage_id).join(",")})`, limit: "25" })),
  ]);
  return { attempts, events, usage, hasMore: rows.length > 25 };
}
