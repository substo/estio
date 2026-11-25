import "server-only";
import { settingsService } from "@/lib/settings/service";
import { verifyLocationAiKey } from "../ai-settings-policy";
import { removeStudioAiKey, saveStudioAiKey } from "../ai-settings";
import { getImagePlatformStates, locationAiSettingsRef, removeImageKey, resolveImageKey, saveImageKey, writeLocationAiSettings } from "../images/keys";
import { verifyImageKey } from "../images/clients";
import { removeFalKey, saveFalKey } from "../voices/sound-keys";
import { verifyFalKey, readFalKey } from "../voices/fal-client";
import { getVoiceKeySummary, removeVoiceKey, requireVoiceManager, resolveVoiceKey, saveVoiceKey, VoiceSettingsError } from "../voices/keys";
import { verifyVoiceKey } from "../voices/clients";
import { CONNECTION_IDS, CONNECTIONS, readConnectionPrefs, type Capability, type ConnectionId, type ConnectionPrefs, type ConnectionPrefsMap } from "./connections";

const PREFS = "studioAiConnections";
export interface ConnectionState { id: ConnectionId; /** Last characters of the key, never the key. Null when not connected. */ hint: string | null; prefs: ConnectionPrefs }
export interface ConnectionsView { canManage: boolean; states: ConnectionState[]; prefs: ConnectionPrefsMap }

/** Every platform in one list: connected or not, and what it is switched on for. One read per source, in parallel. */
export async function getConnections(locationId: string): Promise<ConnectionsView> {
  const [image, voice, doc] = await Promise.all([
    getImagePlatformStates(locationId), getVoiceKeySummary(locationId).catch(() => null),
    settingsService.getDocument<Record<string, unknown>>(locationAiSettingsRef(locationId)).catch(() => null),
  ]);
  const prefs = readConnectionPrefs(doc?.payload?.[PREFS]);
  const hints: Partial<Record<ConnectionId, string | null>> = Object.fromEntries(image.map(p => [p.id, p.hint]));
  hints.fish = voice?.keys.fish?.keyHint ?? null; hints.elevenlabs = voice?.keys.elevenlabs?.keyHint ?? null;
  return { canManage: voice?.canManage === true, prefs, states: CONNECTION_IDS.map(id => ({ id, hint: hints[id] ?? null, prefs: prefs[id] ?? {} })) };
}
export async function connectedMap(locationId: string): Promise<Partial<Record<ConnectionId, boolean>>> {
  const view = await getConnections(locationId);
  return Object.fromEntries(view.states.map(s => [s.id, Boolean(s.hint)]));
}

/** One place that saves any platform's key, using that platform's own verified save (each checks the key for free first). */
export async function saveConnectionKey(locationId: string, id: ConnectionId, key: string) {
  const clean = key.trim();
  switch (id) {
    case "openai": case "google": return saveStudioAiKey(locationId, id === "google" ? "gemini" : "openai", clean);
    case "fal": return saveFalKey(locationId, readFalKey(clean));
    case "elevenlabs": case "fish": return saveVoiceKey(locationId, id, clean);
    default: return saveImageKey(locationId, id, clean);
  }
}
export async function removeConnectionKey(locationId: string, id: ConnectionId) {
  switch (id) {
    case "openai": case "google": return removeStudioAiKey(locationId, id === "google" ? "gemini" : "openai");
    case "fal": return removeFalKey(locationId);
    case "elevenlabs": case "fish": return removeVoiceKey(locationId, id);
    default: return removeImageKey(locationId, id);
  }
}

/** The free check, run on demand against the stored key: still accepted? */
export async function checkConnection(locationId: string, id: ConnectionId): Promise<"valid" | "invalid" | "unavailable" | "missing"> {
  await requireVoiceManager(locationId);
  const key = id === "elevenlabs" || id === "fish" ? await resolveVoiceKey(locationId, id) : await resolveImageKey(locationId, id);
  if (!key) return "missing";
  if (id === "openai" || id === "google") return verifyLocationAiKey(id === "google" ? "gemini" : "openai", key);
  if (id === "fal") return verifyFalKey(key);
  if (id === "elevenlabs" || id === "fish") return verifyVoiceKey(id, key);
  return verifyImageKey(id, key);
}

/** What a connected platform is used for and which of its models are allowed. Unknown purposes and models are dropped. */
export async function setConnectionPrefs(locationId: string, id: ConnectionId, next: { purposes?: Capability[]; disabledModels?: string[] }) {
  if (!CONNECTIONS[id]) throw new VoiceSettingsError("Unknown platform.");
  await writeLocationAiSettings(locationId, payload => {
    const all = readConnectionPrefs(payload[PREFS]);
    const clean = readConnectionPrefs({ [id]: next })[id];
    if (clean) all[id] = clean; else delete all[id];
    payload[PREFS] = all;
  });
}
