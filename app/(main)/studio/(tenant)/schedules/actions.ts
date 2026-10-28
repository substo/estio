"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { readScheduleDraft } from "@/lib/studio/schedule-policy";
import { saveStudioSchedule } from "@/lib/studio/schedules";
import { StudioRestError } from "@/lib/studio/rest";

export async function saveScheduleAction(locationId: string, id: string, version: number,
  _previous: { error?: string }, form: FormData): Promise<{ error?: string }> {
  let draft;
  try { draft = readScheduleDraft(form); }
  catch (error) { return { error: error instanceof Error ? error.message : "Check the schedule fields." }; }
  try { await saveStudioSchedule(locationId, id, version, draft); }
  catch (error) {
    if (error instanceof StudioRestError && error.code === "40001") {
      return { error: "This schedule changed or was already saved. Copy your changes before reloading." };
    }
    return { error: "Could not save this draft. Check your workspace access and try again using your own account." };
  }
  revalidatePath(`/studio/schedules`);
  redirect(`/studio/schedules`);
}
