export type KnowledgeStatus = "pending" | "approved" | "rejected" | "all";
export type KnowledgeReviewAction = "approve" | "reject" | "reopen";

export function availableKnowledgeReviewActions(status: Exclude<KnowledgeStatus, "all">): KnowledgeReviewAction[] {
  return status === "pending" ? ["approve", "reject"] : ["reopen"];
}

export function maySubmitKnowledgeReview(context: { hasWorkspaceAccess: boolean; isImpersonating: boolean }): boolean {
  return context.hasWorkspaceAccess && !context.isImpersonating;
}

/** Keep the review note exact; only constrain its size and the submitted action. */
export function readKnowledgeReviewDraft(form: FormData): { action: KnowledgeReviewAction; reason: string } {
  const action = form.get("action");
  const reason = form.get("reason");
  if (action !== "approve" && action !== "reject" && action !== "reopen") {
    throw new Error("Choose a review decision.");
  }
  if (reason !== null && typeof reason !== "string") throw new Error("Review note must be text.");
  if (reason && reason.length > 2000) throw new Error("Review note must be 2,000 characters or fewer.");
  return { action, reason: reason ?? "" };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isKnowledgeId(value: string): boolean {
  return uuid.test(value);
}

export function knowledgePage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,4})$/.test(value)) return 0;
  const page = Number(value);
  return page <= 100_000 ? page : 0;
}

export function knowledgeStatus(value: string | string[] | undefined): KnowledgeStatus {
  return value === "approved" || value === "rejected" || value === "all" ? value : "pending";
}

export function knowledgeTopic(value: string | string[] | undefined): string | null {
  return typeof value === "string" && isKnowledgeId(value) ? value.toLowerCase() : null;
}

export function knowledgeListQuery(workspaceId: string, status: KnowledgeStatus, topicId: string | null, page: number): Record<string, string> {
  return {
    select: "id,source_id,topic_id,status,statement,kind:payload->>kind,suggested_topic:payload->>suggested_topic",
    workspace_id: `eq.${workspaceId}`,
    ...(status === "all" ? {} : { status: `eq.${status}` }),
    ...(topicId ? { topic_id: `eq.${topicId}` } : {}),
    order: "id.asc", limit: "51", offset: String(page * 50),
  };
}

export function knowledgeDetailPageQuery(workspaceId: string, field: "insight_id" | "source_id", id: string, page: number, select: string): Record<string, string> {
  return { select, workspace_id: `eq.${workspaceId}`, [field]: `eq.${id}`, order: "id.asc", limit: "51", offset: String(page * 50) };
}

/** Imported review IDs are random UUIDs; event time orders the history. */
export function knowledgeReviewPageQuery(workspaceId: string, insightId: string, page: number): Record<string, string> {
  return { ...knowledgeDetailPageQuery(workspaceId, "insight_id", insightId, page, "id,payload"), order: "payload->>at.asc,id.asc" };
}
