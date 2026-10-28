import "server-only";
import { requireOwnStudioCommandLocation } from "./paid-workspace";
import { studioDb } from "./studio-db";
import { StudioDbError } from "./db";
import { StudioCommandError } from "./command-error";
import { isKnowledgeId } from "./knowledge-policy";
import type { readKnowledgeCommand } from "./knowledge-command-policy";
export async function executeStudioKnowledgeCommand(locationId: string, insightId: string, command: ReturnType<typeof readKnowledgeCommand>) {
  const access = await requireOwnStudioCommandLocation(locationId);
  if (!isKnowledgeId(insightId)) throw new StudioCommandError("Invalid finding.");
  try { return await studioDb.call("studio_mutate_knowledge_insight", {
    p_location: access.locationId, p_app: access.app, p_user: access.userId, p_insight: insightId,
    p_request: command.requestId, p_version: command.version, p_action: command.action, p_statement: command.statement,
    p_topic: command.topic, p_reason: command.reason,
  }); } catch (error) {
    if (error instanceof StudioDbError && error.code === "P0002") throw new StudioCommandError("This finding is no longer available.", 404);
    if (error instanceof StudioDbError && error.code === "22023") throw new StudioCommandError("Check the statement, current status and approval topic. If imported names are ambiguous, choose an existing topic.");
    if (error instanceof StudioDbError && error.code === "23505") throw new StudioCommandError("This request was reused or an identical finding already exists for this source. Copy your draft and reload before continuing.", 409);
    throw error;
  }
}
export async function findStudioKnowledgeTopics(locationId: string, query: string) {
  const access = await requireOwnStudioCommandLocation(locationId);
  if (query.length > 120 || /[\x00-\x1f\x7f]/.test(query)) throw new StudioCommandError("Search up to 120 characters.");
  const rows = await studioDb.call<Array<{ id: string; name: string }>>("studio_find_knowledge_topics", {
    p_location: access.locationId, p_app: access.app, p_user: access.userId, p_query: query.trim(),
  });
  return { topics: rows.slice(0, 100), hasMore: rows.length > 100 };
}
