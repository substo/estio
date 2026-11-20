"use server";
import { revalidatePath } from "next/cache";
import { readGeminiKey, readMonthlyBudget, readOpenAiKey, type LocationAiKeyProvider } from "@/lib/studio/ai-settings-policy";
import { removeStudioAiKey, saveStudioAiBudget, saveStudioAiKey, StudioAiSettingsError } from "@/lib/studio/ai-settings";

type State = { error?: string; saved?: string };
const failure = (error: unknown, fallback: string): State => ({ error: error instanceof StudioAiSettingsError ? error.message : fallback });

export async function saveAiKeyAction(locationId: string, provider: LocationAiKeyProvider, _previous: State, form: FormData): Promise<State> {
  if (provider !== "openai" && provider !== "gemini") return { error: "Unsupported provider." };
  let key: string;
  try { key = (provider === "gemini" ? readGeminiKey : readOpenAiKey)(form.get("apiKey")); } catch (error) { return { error: (error as Error).message }; }
  try { await saveStudioAiKey(locationId, provider, key); }
  catch (error) { return failure(error, "Could not save the key. Check your access and try again."); }
  revalidatePath("/settings/ai");
  return { saved: "Key verified and saved." };
}

export async function removeAiKeyAction(locationId: string, provider: LocationAiKeyProvider, _previous: State): Promise<State> {
  if (provider !== "openai" && provider !== "gemini") return { error: "Unsupported provider." };
  try { await removeStudioAiKey(locationId, provider); }
  catch (error) { return failure(error, "Could not remove the key. Try again."); }
  revalidatePath("/settings/ai");
  return { saved: "Key removed." };
}

export async function saveBudgetAction(locationId: string, _previous: State, form: FormData): Promise<State> {
  let micros: number;
  try { micros = readMonthlyBudget(form.get("monthlyBudget")); } catch (error) { return { error: (error as Error).message }; }
  try { await saveStudioAiBudget(locationId, micros); }
  catch (error) { return failure(error, "Could not save the budget. Check your access and try again."); }
  revalidatePath("/settings/ai");
  return { saved: "Budget saved." };
}
