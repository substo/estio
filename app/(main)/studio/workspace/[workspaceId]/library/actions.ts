"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getStudioWorkspaceAccess } from "@/lib/studio/access";
import { readLibraryDraft } from "@/lib/studio/library-policy";
import { saveStudioLibraryRecord } from "@/lib/studio/library";
import { StudioRestError } from "@/lib/studio/rest";

export async function saveLibraryAction(
  workspaceId: string, recordId: string, version: number,
  _previous: { error?: string }, form: FormData,
): Promise<{ error?: string }> {
  if (!await getStudioWorkspaceAccess(workspaceId)) notFound();
  let draft;
  try { draft = readLibraryDraft(form); }
  catch (error) { return { error: error instanceof Error ? error.message : "Check the record fields." }; }
  try { await saveStudioLibraryRecord(workspaceId, recordId, draft, version); }
  catch (error) {
    if (error instanceof StudioRestError && error.code === "40001") {
      return { error: "This record changed in another tab. Keep your draft, reload the latest record, and review the changes before saving." };
    }
    if (error instanceof StudioRestError && error.code === "23505") return { error: "This record already exists. Reload its latest version." };
    console.error("[studio-library] Save failed", error instanceof StudioRestError ? { status: error.status, code: error.code } : { type: "unavailable" });
    return { error: "Studio could not save this record. Your draft is still here; try again." };
  }
  revalidatePath(`/studio/workspace/${workspaceId}/library`);
  redirect(`/studio/workspace/${workspaceId}/library/${recordId}`);
}
