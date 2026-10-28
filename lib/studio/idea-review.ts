import "server-only";
import { requireOwnStudioCommandLocation } from "./paid-workspace";
import { getStudioAccess } from "./access";
import { Prisma } from "@prisma/client";
import { studioDb } from "./studio-db";
import { type readIdeaReviewRequest, type IdeaSnapshot, type IdeaReviewResult } from "./idea-review-policy";
export async function enqueueStudioIdeaReview(locationId: string, command: ReturnType<typeof readIdeaReviewRequest>) {
  const access = await requireOwnStudioCommandLocation(locationId);
  return studioDb.call<{ reviewId: string; jobId: string }>("studio_enqueue_idea_review", {
    p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_request_id: command.requestId,
    p_selection: command.ideas, p_focus: command.focus, p_confirm_paid: command.confirmPaid });
}
export interface StudioTextRun<T, S = IdeaSnapshot> {
  id: string; job_id: string; model: string; prompt_version: string; snapshot: S; result: T | null;
  created_at: string; completed_at: string | null; stale_at_completion: boolean | null;
}
export async function getStudioTextRun<T>(locationId: string, reviewId: string, workflow: "idea_review" | "script_brief") {
  const access = await getStudioAccess(locationId);
  if (!access || !/^[0-9a-f-]{36}$/i.test(reviewId)) return null;
  const review = await studioDb.one<StudioTextRun<T>>(Prisma.sql`
    select id,job_id,model,prompt_version,snapshot,result,created_at,completed_at,stale_at_completion
    from studio.studio_idea_reviews where location_id=${access.locationId} and workflow=${workflow} and id=${reviewId}::uuid`);
  if (!review) return null;
  const snapshots = review.snapshot.ideas.flatMap(i => [i, ...i.sources]);
  const [jobs, records] = await Promise.all([
    studioDb.rows<{ status: string; last_error_message: string | null }>(Prisma.sql`
      select status,last_error_message from studio.studio_jobs where location_id=${access.locationId} and id=${review.job_id}::uuid limit 1`),
    studioDb.rows<{ id: string; version: number }>(Prisma.sql`
      select id,version from studio.studio_records where location_id=${access.locationId}
      and id=any(${[...new Set(snapshots.map(s => s.id))]}::uuid[]) limit 25`),
  ]);
  const stale = !!review.stale_at_completion || snapshots.some(s => !records.some(r => r.id === s.id && Number(r.version) === Number(s.version)));
  return { access, review, job: jobs[0], stale };
}
export async function listStudioTextRuns(locationId: string, workflow: "idea_review" | "script_brief" | "knowledge_extract") {
  const access = await getStudioAccess(locationId); if (!access) return null;
  const reviews = await studioDb.rows<{ id: string; created_at: string; completed_at: string | null }>(Prisma.sql`
    select id,created_at,completed_at from studio.studio_idea_reviews
    where workflow=${workflow} and location_id=${access.locationId} order by created_at desc,id asc limit 20`);
  return { reviews };
}

export type StudioIdeaReview = StudioTextRun<IdeaReviewResult>;
export const getStudioIdeaReview = (locationId: string, reviewId: string) => getStudioTextRun<IdeaReviewResult>(locationId, reviewId, "idea_review");
export const listStudioIdeaReviews = (locationId: string) => listStudioTextRuns(locationId, "idea_review");
