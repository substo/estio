"use server";
import { revalidatePath } from "next/cache";
import { readMonthlyBudget, readOpenAiKey } from "@/lib/studio/ai-settings-policy";
import { removeStudioOpenAiKey, saveStudioAiBudget, saveStudioOpenAiKey, StudioAiSettingsError } from "@/lib/studio/ai-settings";

type State = { error?: string; saved?: string };
const failure = (error: unknown, fallback: string): State => ({ error: error instanceof StudioAiSettingsError ? error.message : fallback });

export async function saveOpenAiKeyAction(workspaceId: string, _previous: State, form: FormData): Promise<State> {
  let key: string;
  try { key = readOpenAiKey(form.get("apiKey")); } catch (error) { return { error: (error as Error).message }; }
  try { await saveStudioOpenAiKey(workspaceId, key); }
  catch (error) { return failure(error, "Could not save the key. Check your access and try again."); }
  revalidatePath(`/studio/workspace/${workspaceId}/settings/ai`);
  return { saved: "Key verified and saved." };
}

export async function removeOpenAiKeyAction(workspaceId: string, _previous: State): Promise<State> {
  try { await removeStudioOpenAiKey(workspaceId); }
  catch (error) { return failure(error, "Could not remove the key. Try again."); }
  revalidatePath(`/studio/workspace/${workspaceId}/settings/ai`);
  return { saved: "Key removed. Hosted AI processing is paused." };
}

export async function saveBudgetAction(workspaceId: string, _previous: State, form: FormData): Promise<State> {
  let micros: number;
  try { micros = readMonthlyBudget(form.get("monthlyBudget")); } catch (error) { return { error: (error as Error).message }; }
  try { await saveStudioAiBudget(workspaceId, micros); }
  catch (error) { return failure(error, "Could not save the budget. Check your access and try again."); }
  revalidatePath(`/studio/workspace/${workspaceId}/settings/ai`);
  return { saved: "Budget saved." };
}
