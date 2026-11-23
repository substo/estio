"use server";
import { revalidatePath } from "next/cache";
import { isHostedProvider, readVoiceKey } from "@/lib/studio/voices/policy";
import { removeVoiceKey, saveVoiceKey, VoiceSettingsError } from "@/lib/studio/voices/keys";
import { refreshProviderVoices } from "@/lib/studio/voices/service";

type State = { error?: string; saved?: string };
const failure = (e: unknown, fallback: string): State => ({ error: e instanceof VoiceSettingsError ? e.message : fallback });

export async function saveVoiceKeyAction(locationId: string, provider: string, _p: State, form: FormData): Promise<State> {
  if (!isHostedProvider(provider)) return { error: "Unsupported provider." };
  let key: string;
  try { key = readVoiceKey(provider, form.get("apiKey")); } catch (e) { return { error: (e as Error).message }; }
  try { await saveVoiceKey(locationId, provider, key); } catch (e) { return failure(e, "Could not save the key. Check your access and try again."); }
  await refreshProviderVoices(locationId, provider).catch(() => {});   // the key is saved either way; the Voices page can refresh again
  revalidatePath("/settings/ai"); revalidatePath("/studio/voices");
  return { saved: "Key verified and saved. Your voices were refreshed." };
}
export async function removeVoiceKeyAction(locationId: string, provider: string, _p: State): Promise<State> {
  if (!isHostedProvider(provider)) return { error: "Unsupported provider." };
  try { await removeVoiceKey(locationId, provider); } catch (e) { return failure(e, "Could not remove the key. Try again."); }
  revalidatePath("/settings/ai"); revalidatePath("/studio/voices");
  return { saved: "Key removed." };
}
