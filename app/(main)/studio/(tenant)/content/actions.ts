"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getStudioAccess } from "@/lib/studio/access";
import { readContentDraft } from "@/lib/studio/content-policy";
import { saveStudioContentRecord } from "@/lib/studio/content";
import { StudioRestError } from "@/lib/studio/rest";

export async function saveContentAction(
  locationId: string, recordId: string, version: number,
  _previous: { error?: string }, form: FormData,
): Promise<{ error?: string }> {
  if (!await getStudioAccess(locationId)) notFound();
  let draft;
  try { draft = readContentDraft(form); }
  catch (error) { return { error: error instanceof Error ? error.message : "Check the content fields." }; }
  try { await saveStudioContentRecord(locationId, recordId, draft, version); }
  catch (error) {
    if (error instanceof StudioRestError && error.code === "40001") return { error: "This piece changed in another tab. Keep your draft, reload the latest piece, and review its changes before saving." };
    if (error instanceof StudioRestError && error.code === "23505") return { error: "This piece already exists. Reload its latest version." };
    console.error("[studio-content] Save failed", error instanceof StudioRestError ? { status: error.status, code: error.code } : { type: "unavailable" });
    return { error: "Studio could not save this piece. Your draft is still here; try again." };
  }
  revalidatePath(`/studio/content`);
  redirect(`/studio/content/${recordId}`);
}
