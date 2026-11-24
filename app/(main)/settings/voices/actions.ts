"use server";
import { revalidatePath } from "next/cache";
import { removeAvatar, setAvatar } from "@/lib/studio/avatar";
import { StudioCommandError } from "@/lib/studio/command-error";
import { isHostedProvider } from "@/lib/studio/voices/policy";
import { VoiceSettingsError } from "@/lib/studio/voices/keys";
import { setGenerationSource, setSoundProviderChoice } from "@/lib/studio/voices/sources-store";
import { removeFalKey, saveFalKey } from "@/lib/studio/voices/sound-keys";
import { readFalKey } from "@/lib/studio/voices/fal-client";
import { isHostedSoundProvider, type SoundKind } from "@/lib/studio/voices/sound-providers";
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

export async function setSoundProviderAction(locationId: string, kind: SoundKind, provider: string, _p: State): Promise<State> {
  if ((kind !== "music" && kind !== "effects") || (provider !== "auto" && !isHostedSoundProvider(provider))) return { error: "Unknown choice." };
  try { await setSoundProviderChoice(locationId, kind, provider === "auto" ? null : provider as "fal" | "elevenlabs"); } catch (e) { return failure(e, "Could not save this choice."); }
  revalidatePath("/settings/voices"); return { notice: "Saved." };
}
export async function saveFalKeyAction(locationId: string, _p: State, form: FormData): Promise<State> {
  let key: string;
  try { key = readFalKey(form.get("apiKey")); } catch (e) { return { error: (e as Error).message }; }
  try { await saveFalKey(locationId, key); } catch (e) { return failure(e, "Could not save the key. Check your access and try again."); }
  revalidatePath("/settings/voices"); return { notice: "Key verified and saved." };
}
export async function removeFalKeyAction(locationId: string, _p: State): Promise<State> {
  try { await removeFalKey(locationId); } catch (e) { return failure(e, "Could not remove the key. Try again."); }
  revalidatePath("/settings/voices"); return { notice: "Key removed." };
}

/** The signed-in user's own storyboard photo. Not a manager setting: every member keeps their own. */
export async function saveAvatarAction(locationId: string, _p: State, form: FormData): Promise<State> {
  const file = form.get("photo");
  if (!(file instanceof File) || !file.size) return { error: "Choose a photo." };
  try { await setAvatar(locationId, file); } catch (e) { return e instanceof StudioCommandError ? { error: e.message } : { error: "Could not save the photo. Try again." }; }
  revalidatePath("/settings/voices"); return { notice: "Photo saved." };
}
export async function removeAvatarAction(locationId: string, _p: State): Promise<State> {
  try { await removeAvatar(locationId); } catch (e) { return e instanceof StudioCommandError ? { error: e.message } : { error: "Could not remove the photo. Try again." }; }
  revalidatePath("/settings/voices"); return { notice: "Photo removed." };
}
