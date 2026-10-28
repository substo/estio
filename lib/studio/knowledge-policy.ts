import { Prisma } from "@prisma/client";
export type KnowledgeStatus = "pending" | "approved" | "rejected" | "all";
export type KnowledgeReviewAction = "approve" | "reject" | "reopen";

export function availableKnowledgeReviewActions(status: Exclude<KnowledgeStatus, "all">): KnowledgeReviewAction[] {
  return status === "pending" ? ["approve", "reject"] : ["reopen"];
}

export function maySubmitKnowledgeReview(context: { hasLocationAccess: boolean; isImpersonating: boolean }): boolean {
  return context.hasLocationAccess && !context.isImpersonating;
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

/** One list page (51 rows: the 51st tells whether there is a next page), for an authorized Location. */
export function knowledgeListQuery(locationId: string, status: KnowledgeStatus, topicId: string | null, page: number): Prisma.Sql {
  return Prisma.sql`select id, source_id, topic_id, status, statement, payload->>'kind' as kind, payload->>'suggested_topic' as suggested_topic
    from studio.studio_knowledge_insights where location_id = ${locationId}${status === "all" ? Prisma.empty : Prisma.sql` and status = ${status}`}${topicId ? Prisma.sql` and topic_id = ${topicId}::uuid` : Prisma.empty}
    order by id asc limit 51 offset ${page * 50}`;
}
