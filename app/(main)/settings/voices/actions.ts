"use server";
import { revalidatePath } from "next/cache";
import { isHostedProvider } from "@/lib/studio/voices/policy";
import { VoiceSettingsError } from "@/lib/studio/voices/keys";
import { setGenerationSource } from "@/lib/studio/voices/sources-store";
import { GENERATION_KINDS, type GenerationKind, type SourceChoice } from "@/lib/studio/voices/sources";
import { deleteVoice, ensureLocalVoices, refreshProviderVoices, setDefaultVoice } from "@/lib/studio/voices/service";

type State = { error?: string; notice?: string };
const failure = (e: unknown, fallback: string): State => ({ error: e instanceof VoiceSettingsError ? e.message : fallback });
const uuid = /^[0-9a-f-]{36}$/i;

export async function refreshVoicesAction(locationId: string, provider: string, _p: State): Promise<State> {
  try {
    if (provider === "local") await ensureLocalVoices(locationId);
    else if (isHostedProvider(provider)) await refreshProviderVoices(locationId, provider);
    else return { error: "Unknown provider." };
  } catch (e) { return failure(e, "Could not refresh voices. Try again."); }
  revalidatePath("/settings/voices"); return { notice: "Voices refreshed." };
}
export async function setDefaultVoiceAction(locationId: string, voiceId: string, _p: State): Promise<State> {
  if (!uuid.test(voiceId)) return { error: "Unknown voice." };
  try { await setDefaultVoice(locationId, voiceId); } catch (e) { return failure(e, "Could not set the default voice."); }
  revalidatePath("/settings/voices"); return { notice: "Default voice set." };
}
export async function deleteVoiceAction(locationId: string, voiceId: string, _p: State): Promise<State> {
  if (!uuid.test(voiceId)) return { error: "Unknown voice." };
  try {
    const r = await deleteVoice(locationId, voiceId);
    revalidatePath("/settings/voices");
    return { notice: r.providerCleanup === "failed" ? "Removed here. The provider copy could not be deleted; remove it in your provider account." : "Voice removed." };
  } catch (e) { return failure(e, "Could not remove the voice."); }
}

export async function setGenerationSourceAction(locationId: string, kind: GenerationKind, choice: SourceChoice | "auto", _p: State): Promise<State> {
  if (!GENERATION_KINDS.includes(kind) || !["local", "hosted", "auto"].includes(choice)) return { error: "Unknown choice." };
  try { await setGenerationSource(locationId, kind, choice === "auto" ? null : choice); } catch (e) { return failure(e, "Could not save this choice."); }
  revalidatePath("/settings/voices"); return { notice: "Saved." };
}
