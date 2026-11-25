"use server";
import { revalidatePath } from "next/cache";
import { VoiceSettingsError } from "@/lib/studio/voices/keys";
import { setGenerationSource, setSoundProviderChoice } from "@/lib/studio/voices/sources-store";
import { removeFalKey, saveFalKey } from "@/lib/studio/voices/sound-keys";
import { readFalKey } from "@/lib/studio/voices/fal-client";
import { isHostedSoundProvider, type SoundKind } from "@/lib/studio/voices/sound-providers";
import { GENERATION_KINDS, type GenerationKind, type SourceChoice } from "@/lib/studio/voices/sources";
import { IMAGE_PLATFORM_IDS, type ImagePlatformId } from "@/lib/studio/images/catalog";
import { discoverImageModels, removeImageKey, saveImageKey, setImageChoice, testImageModel, type ImageTestResult } from "@/lib/studio/images/keys";

type State = { error?: string; notice?: string };
const failure = (e: unknown, fallback: string): State => ({ error: e instanceof VoiceSettingsError ? e.message : fallback });

// Provider keys and where each kind of AI output is made live under Settings → AI, one page per type.
export async function setGenerationSourceAction(locationId: string, kind: GenerationKind, choice: SourceChoice | "auto", _p: State): Promise<State> {
  if (!GENERATION_KINDS.includes(kind) || !["local", "hosted", "auto"].includes(choice)) return { error: "Unknown choice." };
  try { await setGenerationSource(locationId, kind, choice === "auto" ? null : choice); } catch (e) { return failure(e, "Could not save this choice."); }
  revalidatePath("/settings/ai/audio"); return { notice: "Saved." };
}

export async function setSoundProviderAction(locationId: string, kind: SoundKind, provider: string, _p: State): Promise<State> {
  if ((kind !== "music" && kind !== "effects") || (provider !== "auto" && !isHostedSoundProvider(provider))) return { error: "Unknown choice." };
  try { await setSoundProviderChoice(locationId, kind, provider === "auto" ? null : provider as "fal" | "elevenlabs"); } catch (e) { return failure(e, "Could not save this choice."); }
  revalidatePath("/settings/ai/audio"); return { notice: "Saved." };
}
export async function saveFalKeyAction(locationId: string, _p: State, form: FormData): Promise<State> {
  let key: string;
  try { key = readFalKey(form.get("apiKey")); } catch (e) { return { error: (e as Error).message }; }
  try { await saveFalKey(locationId, key); } catch (e) { return failure(e, "Could not save the key. Check your access and try again."); }
  revalidatePath("/settings/ai/audio"); return { notice: "Key verified and saved." };
}
export async function removeFalKeyAction(locationId: string, _p: State): Promise<State> {
  try { await removeFalKey(locationId); } catch (e) { return failure(e, "Could not remove the key. Try again."); }
  revalidatePath("/settings/ai/audio"); return { notice: "Key removed." };
}


const platformOf = (value: unknown): ImagePlatformId | null => (IMAGE_PLATFORM_IDS as readonly unknown[]).includes(value) ? value as ImagePlatformId : null;
const ENDPOINT = /^[a-z0-9][a-z0-9._/:-]{1,120}$/i;
export async function saveImageKeyAction(locationId: string, platform: string, _p: State, form: FormData): Promise<State> {
  const id = platformOf(platform); if (!id) return { error: "Unknown platform." };
  try { await saveImageKey(locationId, id, String(form.get("apiKey") ?? "")); } catch (e) { return failure(e, "Could not save the key. Check your access and try again."); }
  revalidatePath("/settings/ai/images"); return { notice: "Key saved." };
}
export async function removeImageKeyAction(locationId: string, platform: string, _p: State): Promise<State> {
  const id = platformOf(platform); if (!id) return { error: "Unknown platform." };
  try { await removeImageKey(locationId, id); } catch (e) { return failure(e, "Could not remove the key. Try again."); }
  revalidatePath("/settings/ai/images"); return { notice: "Key removed." };
}
export async function setImageChoiceAction(locationId: string, model: string | null, platform: string | null, endpoint: string | null): Promise<State> {
  try {
    if (!model || !platform) await setImageChoice(locationId, null);
    else { const id = platformOf(platform); if (!id) return { error: "Unknown platform." }; await setImageChoice(locationId, { model, platform: id, ...(endpoint && ENDPOINT.test(endpoint) ? { endpoint } : {}) }); }
  } catch (e) { return failure(e, "Could not save this choice."); }
  revalidatePath("/settings/ai/images"); return { notice: "Saved." };
}
export async function testImageAction(locationId: string, platform: string, model: string, endpoint: string | null): Promise<ImageTestResult> {
  const id = platformOf(platform);
  if (!id) return { ok: false, message: "Unknown platform.", ms: 0 };
  try { const out = await testImageModel(locationId, id, model, endpoint && ENDPOINT.test(endpoint) ? endpoint : undefined); revalidatePath("/settings/ai/images"); return out; }
  catch (e) { return { ok: false, message: e instanceof VoiceSettingsError ? e.message : "The test could not run.", ms: 0 }; }
}
export async function discoverImageModelsAction(locationId: string, platform: string): Promise<string[]> {
  if (platform !== "openai" && platform !== "google") return [];
  return discoverImageModels(locationId, platform).catch(() => []);
}
