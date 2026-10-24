import "server-only";
import { requireOwnStudioCommandWorkspace } from "./paid-workspace";
import { getStudioWorkspaceAccess } from "./access";
import { queryPath, studioRest } from "./rest";
import { type readIdeaReviewRequest, type IdeaSnapshot, type IdeaReviewResult } from "./idea-review-policy";
export async function enqueueStudioIdeaReview(workspaceId: string, command: ReturnType<typeof readIdeaReviewRequest>) {
  const access = await requireOwnStudioCommandWorkspace(workspaceId);
  return studioRest<{ reviewId: string; jobId: string }>("rpc/studio_enqueue_idea_review", { method: "POST", body: JSON.stringify({
    p_workspace_id: access.workspace.id, p_actor_brand: access.brand, p_clerk_user_id: access.userId, p_request_id: command.requestId,
    p_selection: command.ideas, p_focus: command.focus, p_confirm_paid: command.confirmPaid }) });
}
export interface StudioTextRun<T, S = IdeaSnapshot> {
  id: string; job_id: string; model: string; prompt_version: string; snapshot: S; result: T | null;
  created_at: string; completed_at: string | null; stale_at_completion: boolean | null;
}
export async function getStudioTextRun<T>(workspaceId: string, reviewId: string, workflow: "idea_review" | "script_brief") {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || !/^[0-9a-f-]{36}$/i.test(reviewId)) return null;
  const [review] = await studioRest<StudioTextRun<T>[]>(queryPath("studio_idea_reviews", { select: "id,job_id,model,prompt_version,snapshot,result,created_at,completed_at,stale_at_completion",
    workspace_id: `eq.${access.workspace.id}`, workflow: `eq.${workflow}`, id: `eq.${reviewId}`, limit: "1" }));
  if (!review) return null;
  const snapshots = review.snapshot.ideas.flatMap(i => [i, ...i.sources]);
  const [jobs, records] = await Promise.all([
    studioRest<Array<{ status: string; last_error_message: string | null }>>(queryPath("studio_jobs", { select: "status,last_error_message", workspace_id: `eq.${access.workspace.id}`, id: `eq.${review.job_id}`, limit: "1" })),
    studioRest<Array<{ id: string; version: number }>>(queryPath("studio_records", { select: "id,version", workspace_id: `eq.${access.workspace.id}`, id: `in.(${[...new Set(snapshots.map(s => s.id))].join(",")})`, limit: "25" })),
  ]);
  const stale = !!review.stale_at_completion || snapshots.some(s => !records.some(r => r.id === s.id && Number(r.version) === Number(s.version)));
  return { access, review, job: jobs[0], stale };
}
export async function listStudioTextRuns(workspaceId: string, workflow: "idea_review" | "script_brief" | "knowledge_extract") {
  const access = await getStudioWorkspaceAccess(workspaceId); if (!access) return null;
  const reviews = await studioRest<Array<{ id: string; created_at: string; completed_at: string | null }>>(queryPath("studio_idea_reviews", {
    select: "id,created_at,completed_at", workflow: `eq.${workflow}`, workspace_id: `eq.${access.workspace.id}`, order: "created_at.desc,id.asc", limit: "20" }));
  return { reviews };
}

export type StudioIdeaReview = StudioTextRun<IdeaReviewResult>;
export const getStudioIdeaReview = (workspaceId: string, reviewId: string) => getStudioTextRun<IdeaReviewResult>(workspaceId, reviewId, "idea_review");
export const listStudioIdeaReviews = (workspaceId: string) => listStudioTextRuns(workspaceId, "idea_review");
