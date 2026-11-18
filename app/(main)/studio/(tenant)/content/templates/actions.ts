"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { StudioCommandError } from "@/lib/studio/command-error";
import { StudioDbError } from "@/lib/studio/db";
import { readScriptTemplateDraft } from "@/lib/studio/script-template-policy";
import { approveStudioScriptTemplate, proposeStudioScriptTemplate } from "@/lib/studio/script-templates";

const path = "/studio/content/templates";

function commandError(error: unknown) {
  if (error instanceof StudioCommandError) return error.message;
  if (error instanceof StudioDbError) {
    if (error.status === 409) return "This template has changed. Reload to review its latest version before trying again.";
    if (error.status === 403) return "Your Location role does not allow this action.";
  }
  return "Studio could not save the change. Try again.";
}

export async function proposeScriptTemplateAction(locationId: string, templateId: string, id: string, version: number,
  _state: { error?: string }, form: FormData): Promise<{ error?: string }> {
  let draft;
  try { draft = readScriptTemplateDraft(form); }
  catch (error) { return { error: error instanceof Error ? error.message : "Check the template fields." }; }
  try { await proposeStudioScriptTemplate(locationId, templateId, id, version, draft); }
  catch (error) { return { error: commandError(error) }; }
  revalidatePath(path);
  redirect(`${path}/${templateId}`);
}

export async function approveScriptTemplateAction(locationId: string, templateId: string, id: string):
  Promise<{ error?: string }> {
  try { await approveStudioScriptTemplate(locationId, templateId, id); }
  catch (error) { return { error: commandError(error) }; }
  revalidatePath("/studio/content", "layout");
  redirect(`${path}/${templateId}`);
}
