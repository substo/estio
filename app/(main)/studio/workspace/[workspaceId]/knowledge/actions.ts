"use server";

import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getStudioWorkspaceAccess } from "@/lib/studio/access";
import { reviewStudioKnowledgeInsight } from "@/lib/studio/knowledge";
import { isKnowledgeId, maySubmitKnowledgeReview, readKnowledgeReviewDraft } from "@/lib/studio/knowledge-policy";
import { StudioRestError } from "@/lib/studio/rest";

export type KnowledgeReviewActionState = { error?: string };

export async function submitKnowledgeReviewAction(
  workspaceId: string,
  insightId: string,
  expectedVersion: number,
  _previous: KnowledgeReviewActionState,
  form: FormData,
): Promise<KnowledgeReviewActionState> {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || !isKnowledgeId(insightId)) notFound();
  if (!maySubmitKnowledgeReview({ hasWorkspaceAccess: true, isImpersonating: Boolean((await auth()).actor) })) {
    return { error: "Review decisions are unavailable during impersonation. Return to your own account to review this finding." };
  }
  let draft;
  try { draft = readKnowledgeReviewDraft(form); }
  catch (error) { return { error: error instanceof Error ? error.message : "Check your review decision." }; }
  try {
    await reviewStudioKnowledgeInsight(workspaceId, insightId, expectedVersion, draft.action, draft.reason);
  } catch (error) {
    if (error instanceof StudioRestError && error.code === "40001") {
      return { error: "This finding changed in another tab. Your note is still here. Copy it before reloading the latest decision." };
    }
    if (error instanceof StudioRestError && error.code === "22023") {
      return { error: "That decision is no longer valid for the current status. Your note is still here; reload the finding before retrying." };
    }
    if (error instanceof StudioRestError && error.code === "P0002") {
      return { error: "This finding is no longer available. Reload the page." };
    }
    if (error instanceof StudioRestError && error.code === "42501") {
      return { error: "You no longer have permission to review this finding." };
    }
    console.error("[studio-knowledge] Review failed", error instanceof StudioRestError
      ? { status: error.status, code: error.code }
      : { type: "unavailable" });
    return { error: "Studio could not save this review. Your note is still here; try again." };
  }
  revalidatePath(`/studio/workspace/${workspaceId}/knowledge`);
  revalidatePath(`/studio/workspace/${workspaceId}/knowledge/${insightId}`);
  redirect(`/studio/workspace/${workspaceId}/knowledge/${insightId}`);
}
