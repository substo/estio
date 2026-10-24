import "server-only";
import { requireOwnStudioCommandWorkspace } from "./paid-workspace";
import { getStudioTextRun } from "./idea-review";
import { queryPath, studioRest } from "./rest";
import type { readScriptBriefRequest, readScriptBriefApply, ScriptBriefResult } from "./script-brief-policy";
export async function enqueueStudioScriptBrief(workspaceId: string, command: ReturnType<typeof readScriptBriefRequest>) {
  const access = await requireOwnStudioCommandWorkspace(workspaceId);
  return studioRest<{ reviewId: string; jobId: string }>("rpc/studio_enqueue_script_brief", { method: "POST", body: JSON.stringify({
    p_workspace_id: access.workspace.id, p_actor_brand: access.brand, p_clerk_user_id: access.userId, p_request_id: command.requestId,
    p_selection: command.ideas, p_focus: command.focus, p_confirm_paid: command.confirmPaid }) });
}
export async function applyStudioScriptBrief(workspaceId: string, command: ReturnType<typeof readScriptBriefApply>) {
  const access = await requireOwnStudioCommandWorkspace(workspaceId);
  return studioRest("rpc/studio_apply_script_brief", { method: "POST", body: JSON.stringify({ p_workspace_id: access.workspace.id,
    p_actor_brand: access.brand, p_clerk_user_id: access.userId, p_review_id: command.reviewId, p_request_id: command.requestId,
    p_expected_version: command.expectedVersion, p_confirm_replace: command.confirmReplace }) });
}
export async function getStudioScriptBrief(workspaceId: string, reviewId: string) {
  const data = await getStudioTextRun<ScriptBriefResult>(workspaceId, reviewId, "script_brief"); if (!data) return null;
  const [application] = await studioRest<Array<{ record_id: string; record_version: number; actor_clerk_user_id: string; created_at: string }>>(queryPath("studio_script_brief_applications", {
    select: "record_id,record_version,actor_clerk_user_id,created_at", workspace_id: `eq.${data.access.workspace.id}`, review_id: `eq.${reviewId}`, limit: "1" }));
  return { ...data, application: application ?? null };
}
