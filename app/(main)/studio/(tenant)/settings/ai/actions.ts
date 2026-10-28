"use server";
import { revalidatePath } from "next/cache";
import { readMonthlyBudget, readOpenAiKey } from "@/lib/studio/ai-settings-policy";
import { removeStudioOpenAiKey, saveStudioAiBudget, saveStudioOpenAiKey, StudioAiSettingsError } from "@/lib/studio/ai-settings";

type State = { error?: string; saved?: string };
const failure = (error: unknown, fallback: string): State => ({ error: error instanceof StudioAiSettingsError ? error.message : fallback });

export async function saveOpenAiKeyAction(locationId: string, _previous: State, form: FormData): Promise<State> {
  let key: string;
  try { key = readOpenAiKey(form.get("apiKey")); } catch (error) { return { error: (error as Error).message }; }
  try { await saveStudioOpenAiKey(locationId, key); }
  catch (error) { return failure(error, "Could not save the key. Check your access and try again."); }
  revalidatePath(`/studio/settings/ai`);
  return { saved: "Key verified and saved." };
}

export async function removeOpenAiKeyAction(locationId: string, _previous: State): Promise<State> {
  try { await removeStudioOpenAiKey(locationId); }
  catch (error) { return failure(error, "Could not remove the key. Try again."); }
  revalidatePath(`/studio/settings/ai`);
  return { saved: "Key removed. Hosted AI processing is paused." };
}

export async function saveBudgetAction(locationId: string, _previous: State, form: FormData): Promise<State> {
  let micros: number;
  try { micros = readMonthlyBudget(form.get("monthlyBudget")); } catch (error) { return { error: (error as Error).message }; }
  try { await saveStudioAiBudget(locationId, micros); }
  catch (error) { return failure(error, "Could not save the budget. Check your access and try again."); }
  revalidatePath(`/studio/settings/ai`);
  return { saved: "Budget saved." };
}
