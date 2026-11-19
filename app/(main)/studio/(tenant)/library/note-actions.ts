"use server";

import { revalidatePath } from "next/cache";
import { getStudioAccess } from "@/lib/studio/access";
import { getStudioLibraryRecord, saveStudioLibraryRecord } from "@/lib/studio/library";
import { saveSourceNote, type SourceNoteResult } from "@/lib/studio/source-note-service";
import { StudioRestError } from "@/lib/studio/rest";

/** Explicit save only: the user chose Save to My notes for this source. */
export async function saveSourceNoteAction(locationId: string, recordId: string, note: string): Promise<SourceNoteResult> {
  const result = await saveSourceNote({
    hasAccess: async id => Boolean(await getStudioAccess(id)),
    getSource: async (id, source) => (await getStudioLibraryRecord(id, source))?.record ?? null,
    save: saveStudioLibraryRecord,
    isConflict: error => error instanceof StudioRestError && error.code === "40001",
  }, locationId, recordId, String(note));
  if (result.ok) revalidatePath(`/studio/library/${recordId}`);
  return result;
}
