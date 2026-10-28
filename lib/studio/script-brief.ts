import "server-only";
import { requireOwnStudioCommandLocation } from "./paid-workspace";
import { getStudioTextRun } from "./idea-review";
import { Prisma } from "@prisma/client";
import { studioDb } from "./studio-db";
import type { readScriptBriefRequest, readScriptBriefApply, ScriptBriefResult } from "./script-brief-policy";
export async function enqueueStudioScriptBrief(locationId: string, command: ReturnType<typeof readScriptBriefRequest>) {
  const access = await requireOwnStudioCommandLocation(locationId);
  return studioDb.call<{ reviewId: string; jobId: string }>("studio_enqueue_script_brief", {
    p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_request_id: command.requestId,
    p_selection: command.ideas, p_focus: command.focus, p_confirm_paid: command.confirmPaid });
}
export async function applyStudioScriptBrief(locationId: string, command: ReturnType<typeof readScriptBriefApply>) {
  const access = await requireOwnStudioCommandLocation(locationId);
  return studioDb.call("studio_apply_script_brief", { p_location_id: access.locationId,
    p_actor_app: access.app, p_clerk_user_id: access.userId, p_review_id: command.reviewId, p_request_id: command.requestId,
    p_expected_version: command.expectedVersion, p_confirm_replace: command.confirmReplace });
}
export async function getStudioScriptBrief(locationId: string, reviewId: string) {
  const data = await getStudioTextRun<ScriptBriefResult>(locationId, reviewId, "script_brief"); if (!data) return null;
  const application = await studioDb.one<{ record_id: string; record_version: number; actor_clerk_user_id: string; created_at: string }>(Prisma.sql`
    select record_id,record_version,actor_clerk_user_id,created_at from studio.studio_script_brief_applications
    where location_id=${data.access.locationId} and review_id=${reviewId}::uuid`);
  return { ...data, application: application ?? null };
}
