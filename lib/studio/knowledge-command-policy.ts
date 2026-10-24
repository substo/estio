import { StudioCommandError } from "./command-error";
import { isKnowledgeId } from "./knowledge-policy";
export type KnowledgeTopicChoice = { mode: "keep" } | { mode: "existing"; id: string } | { mode: "create"; name: string };
export function readKnowledgeCommand(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StudioCommandError("Invalid knowledge command.");
  const b = value as Record<string, unknown>;
  if (typeof b.requestId !== "string" || !isKnowledgeId(b.requestId) || !["edit", "approve", "reject", "reopen"].includes(String(b.action))
    || !Number.isSafeInteger(b.version) || Number(b.version) < 1 || typeof b.reason !== "string" || b.reason.length > 2000
    || (b.statement !== null && (typeof b.statement !== "string" || !b.statement.trim() || b.statement.length > 4000 || b.statement.includes("\0")))) throw new StudioCommandError("Choose an action, valid statement and a review note up to 2,000 characters.");
  if (b.action === "edit" && typeof b.statement !== "string") throw new StudioCommandError("Enter a changed statement to save an edit.");
  const raw = b.topic;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new StudioCommandError("Choose an approval topic.");
  const t = raw as Record<string, unknown>;
  let topic: KnowledgeTopicChoice;
  if (t.mode === "keep") topic = { mode: "keep" };
  else if (b.action === "approve" && t.mode === "existing" && typeof t.id === "string" && isKnowledgeId(t.id)) topic = { mode: "existing", id: t.id.toLowerCase() };
  else if (b.action === "approve" && t.mode === "create" && typeof t.name === "string" && t.name.trim() && t.name.trim().length <= 120 && !/[\x00-\x1f\x7f]/.test(t.name)) topic = { mode: "create", name: t.name.trim() };
  else throw new StudioCommandError("Choose an existing topic or enter a topic name up to 120 characters. Topic changes apply only when approving.");
  return { requestId: b.requestId.toLowerCase(), action: b.action as "edit" | "approve" | "reject" | "reopen", version: Number(b.version),
    statement: b.statement as string | null, reason: b.reason, topic };
}
