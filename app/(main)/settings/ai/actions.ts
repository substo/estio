"use server";
import { VoiceSettingsError } from "@/lib/studio/voices/keys";
import { StudioAiSettingsError } from "@/lib/studio/ai-settings";
import { CONNECTION_IDS, CONNECTIONS, CAPABILITIES, type Capability, type ConnectionId } from "@/lib/studio/ai/connections";
import { checkConnection, removeConnectionKey, saveConnectionKey, setConnectionPrefs } from "@/lib/studio/ai/connections-store";
import { setGenerationSource, setSoundProviderChoice } from "@/lib/studio/voices/sources-store";
import { isHostedSoundProvider, type SoundKind } from "@/lib/studio/voices/sound-providers";
import { GENERATION_KINDS, type GenerationKind, type SourceChoice } from "@/lib/studio/voices/sources";
import { IMAGE_PLATFORM_IDS, type ImagePlatformId } from "@/lib/studio/images/catalog";
import { discoverImageModels, setImageChoices, testImageModel, type ImageTestResult } from "@/lib/studio/images/keys";
import { testSound } from "@/lib/studio/ai/sound-test";

type State = { error?: string; notice?: string };
const failure = (e: unknown, fallback: string): State => ({ error: e instanceof VoiceSettingsError || e instanceof StudioAiSettingsError ? e.message : fallback });

// Provider keys and where each kind of AI output is made live under Settings → AI, one page per type.
export async function setGenerationSourceAction(locationId: string, kind: GenerationKind, choice: SourceChoice | "auto", _p: State): Promise<State> {
  if (!GENERATION_KINDS.includes(kind) || !["local", "hosted", "auto"].includes(choice)) return { error: "Unknown choice." };
  try { await setGenerationSource(locationId, kind, choice === "auto" ? null : choice); } catch (e) { return failure(e, "Could not save this choice."); }
  return { notice: "Saved." };
}

export async function setSoundProviderAction(locationId: string, kind: SoundKind, provider: string, _p: State): Promise<State> {
  if ((kind !== "music" && kind !== "effects") || (provider !== "auto" && !isHostedSoundProvider(provider))) return { error: "Unknown choice." };
  try { await setSoundProviderChoice(locationId, kind, provider === "auto" ? null : provider as "fal" | "elevenlabs"); } catch (e) { return failure(e, "Could not save this choice."); }
  return { notice: "Saved." };
}
const platformOf = (value: unknown): ImagePlatformId | null => (IMAGE_PLATFORM_IDS as readonly unknown[]).includes(value) ? value as ImagePlatformId : null;
const ENDPOINT = /^[a-z0-9][a-z0-9._/:-]{1,120}$/i;
type ChoiceInput = { model: string; platform: string; endpoint?: string | null } | null;
const toChoice = (c: ChoiceInput) => c && platformOf(c.platform) ? { model: c.model, platform: platformOf(c.platform)!, ...(c.endpoint && ENDPOINT.test(c.endpoint) ? { endpoint: c.endpoint } : {}) } : null;
/** Saved in the background while the page already shows the change. */
export async function setImageChoicesAction(locationId: string, primary: ChoiceInput, fallback: ChoiceInput): Promise<State> {
  try { await setImageChoices(locationId, toChoice(primary), toChoice(fallback)); } catch (e) { return failure(e, "Could not save this choice."); }
  return {};
}
export async function testImageAction(locationId: string, platform: string, model: string, endpoint: string | null): Promise<ImageTestResult> {
  const id = platformOf(platform);
  if (!id) return { ok: false, message: "Unknown platform.", ms: 0 };
  try { const out = await testImageModel(locationId, id, model, endpoint && ENDPOINT.test(endpoint) ? endpoint : undefined); return out; }
  catch (e) { return { ok: false, message: e instanceof VoiceSettingsError ? e.message : "The test could not run.", ms: 0 }; }
}
export async function discoverImageModelsAction(locationId: string, platform: string): Promise<string[]> {
  if (platform !== "openai" && platform !== "google") return [];
  return discoverImageModels(locationId, platform).catch(() => []);
}

// ---- Connections: every platform's key, what it is used for, and which of its models are allowed --------------------------------------------
const connectionOf = (value: unknown): ConnectionId | null => (CONNECTION_IDS as readonly unknown[]).includes(value) ? value as ConnectionId : null;
export async function saveConnectionKeyAction(locationId: string, platform: string, _p: State, form: FormData): Promise<State> {
  const id = connectionOf(platform); if (!id) return { error: "Unknown platform." };
  try { await saveConnectionKey(locationId, id, String(form.get("apiKey") ?? "")); } catch (e) { return failure(e, "Could not save the key. Check your access and try again."); }
  return { notice: "Key verified and saved." };
}
export async function removeConnectionKeyAction(locationId: string, platform: string): Promise<State> {
  const id = connectionOf(platform); if (!id) return { error: "Unknown platform." };
  try { await removeConnectionKey(locationId, id); } catch (e) { return failure(e, "Could not remove the key. Try again."); }
  return { notice: "Key removed." };
}
export async function checkConnectionAction(locationId: string, platform: string): Promise<State> {
  const id = connectionOf(platform); if (!id) return { error: "Unknown platform." };
  try {
    const r = await checkConnection(locationId, id);
    return r === "valid" ? { notice: `${CONNECTIONS[id].label} accepted the key just now.` } : r === "invalid" ? { error: `${CONNECTIONS[id].label} no longer accepts this key. Replace it.` } : r === "missing" ? { error: "There is no key to check." } : { error: `Could not reach ${CONNECTIONS[id].label}. Try again shortly.` };
  } catch (e) { return failure(e, "The check could not run."); }
}
/** Saved in the background while the page already shows the change, so it does not re-render the page. */
export async function setConnectionPrefsAction(locationId: string, platform: string, purposes: string[], disabledModels: string[]): Promise<State> {
  const id = connectionOf(platform); if (!id) return { error: "Unknown platform." };
  const caps = CAPABILITIES.filter(c => purposes.includes(c)) as Capability[];
  try { await setConnectionPrefs(locationId, id, { purposes: caps, disabledModels: disabledModels.slice(0, 80) }); } catch (e) { return failure(e, "Could not save this. Try again."); }
  return {};
}

export async function testSoundAction(locationId: string, kind: string, provider: string): Promise<{ ok: boolean; message: string; ms: number; dataUrl?: string }> {
  if ((kind !== "music" && kind !== "effects") || !isHostedSoundProvider(provider)) return { ok: false, message: "Unknown choice.", ms: 0 };
  try { return await testSound(locationId, kind, provider); } catch (e) { return { ok: false, message: e instanceof VoiceSettingsError ? e.message : "The test could not run.", ms: 0 }; }
}
