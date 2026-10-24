import "server-only";
import { requireOwnStudioCommandWorkspace } from "./paid-workspace";
import { studioRest } from "./rest";
import { StudioRestError } from "./rest-client";
import { StudioCommandError } from "./command-error";
import { isKnowledgeId } from "./knowledge-policy";
import type { readKnowledgeCommand } from "./knowledge-command-policy";
export async function executeStudioKnowledgeCommand(workspaceId: string, insightId: string, command: ReturnType<typeof readKnowledgeCommand>) {
  const access = await requireOwnStudioCommandWorkspace(workspaceId);
  if (!isKnowledgeId(insightId)) throw new StudioCommandError("Invalid finding.");
  try { return await studioRest("rpc/studio_mutate_knowledge_insight", { method: "POST", body: JSON.stringify({
    p_workspace: access.workspace.id, p_brand: access.brand, p_user: access.userId, p_insight: insightId,
    p_request: command.requestId, p_version: command.version, p_action: command.action, p_statement: command.statement,
    p_topic: command.topic, p_reason: command.reason,
  }) }); } catch (error) {
    if (error instanceof StudioRestError && error.code === "P0002") throw new StudioCommandError("This finding is no longer available.", 404);
    if (error instanceof StudioRestError && error.code === "22023") throw new StudioCommandError("Check the statement, current status and approval topic. If imported names are ambiguous, choose an existing topic.");
    if (error instanceof StudioRestError && error.code === "23505") throw new StudioCommandError("This request was reused or an identical finding already exists for this source. Copy your draft and reload before continuing.", 409);
    throw error;
  }
}
export async function findStudioKnowledgeTopics(workspaceId: string, query: string) {
  const access = await requireOwnStudioCommandWorkspace(workspaceId);
  if (query.length > 120 || /[\x00-\x1f\x7f]/.test(query)) throw new StudioCommandError("Search up to 120 characters.");
  const rows = await studioRest<Array<{ id: string; name: string }>>("rpc/studio_find_knowledge_topics", { method: "POST", body: JSON.stringify({
    p_workspace: access.workspace.id, p_brand: access.brand, p_user: access.userId, p_query: query.trim(),
  }) });
  return { topics: rows.slice(0, 100), hasMore: rows.length > 100 };
}
