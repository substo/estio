"use server";

import { revalidatePath } from "next/cache";
import { getStudioAccess } from "@/lib/studio/access";
import { getStudioLibraryRecord, saveStudioLibraryRecord } from "@/lib/studio/library";
import { replaceSourceNotes, saveSourceNote, type SourceNoteResult } from "@/lib/studio/source-note-service";
import { StudioRestError } from "@/lib/studio/rest";

/** Explicit save only: the user chose Save to My notes for this source. */
const deps = {
  hasAccess: async (id: string) => Boolean(await getStudioAccess(id)),
  getSource: async (id: string, source: string) => (await getStudioLibraryRecord(id, source))?.record ?? null,
  save: saveStudioLibraryRecord,
  isConflict: (error: unknown) => error instanceof StudioRestError && error.code === "40001",
};
export async function saveSourceNoteAction(locationId: string, recordId: string, note: string): Promise<SourceNoteResult> {
  const result = await saveSourceNote(deps, locationId, recordId, String(note));
  if (result.ok) revalidatePath(`/studio/library/${recordId}`);
  return result;
}

/** The user reviewed the shown change (or edited the notes directly) and chose Apply. */
export async function replaceSourceNotesAction(locationId: string, recordId: string, text: string, expectedVersion: number): Promise<SourceNoteResult> {
  const result = await replaceSourceNotes(deps, locationId, recordId, String(text), Number(expectedVersion));
  if (result.ok) revalidatePath(`/studio/library/${recordId}`);
  return result;
}
