"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getStudioAccess } from "@/lib/studio/access";
import { readContentDraft } from "@/lib/studio/content-policy";
import { createStudioSourceIdea, saveStudioContentRecord } from "@/lib/studio/content";
import { StudioRestError } from "@/lib/studio/rest";
import { StudioCommandError } from "@/lib/studio/command-error";
import { readScriptTemplateSelection } from "@/lib/studio/script-template-policy";

export async function saveContentAction(
  locationId: string, recordId: string, version: number,
  _previous: { error?: string }, form: FormData,
): Promise<{ error?: string }> {
  if (!await getStudioAccess(locationId)) notFound();
  let draft;
  let templateVersionId;
  try { draft = readContentDraft(form); templateVersionId = readScriptTemplateSelection(form); }
  catch (error) { return { error: error instanceof Error ? error.message : "Check the content fields." }; }
  try { await saveStudioContentRecord(locationId, recordId, draft, version, templateVersionId); }
  catch (error) {
    if (error instanceof StudioRestError && error.code === "40001") return { error: "This piece changed in another tab. Keep your draft, reload the latest piece, and review its changes before saving." };
    if (error instanceof StudioRestError && error.code === "23505") return { error: "This piece already exists. Reload its latest version." };
    if (error instanceof StudioCommandError) return { error: error.message };
    if (templateVersionId !== undefined && error instanceof StudioRestError && error.code === "22023") return { error: "Choose an approved template in this Location for active content, or continue without a template." };
    console.error("[studio-content] Save failed", error instanceof StudioRestError ? { status: error.status, code: error.code } : { type: "unavailable" });
    return { error: "Studio could not save this piece. Your draft is still here; try again." };
  }
  revalidatePath(`/studio/content`);
  redirect(`/studio/content/${recordId}`);
}

export async function createSourceIdeaAction(locationId: string, sourceId: string, ideaId: string, draftReviewId: string | undefined,
  _previous: { error?: string }, form: FormData): Promise<{ error?: string }> {
  try {
    await createStudioSourceIdea(locationId, sourceId, ideaId, String(form.get("title") || ""), String(form.get("summary") || ""), draftReviewId);
  } catch {
    return { error: "Could not create this idea with its source. Your draft is still here. Check that the source is active and use your own account, then retry." };
  }
  revalidatePath("/studio/content");
  revalidatePath(`/studio/library/${sourceId}`);
  redirect(`/studio/content/${ideaId}`);
}
