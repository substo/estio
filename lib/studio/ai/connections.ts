import { IMAGE_MODELS, IMAGE_PLATFORMS, type ImagePlatformId } from "../images/catalog";

/**
 * The one list of AI connections: every platform whose API key a Location can enter, what it can do (its capabilities), and the
 * models it offers for each. Keys are entered once, on the Connections page. The owner decides what each connected platform is used
 * for (purposes) and which of its models are allowed; the Voice, Music and sound effects, and Images pages then only offer what is
 * connected and allowed. Pure data and rules: no keys, no network.
 */
export const CAPABILITIES = ["text", "voice", "music", "effects", "images"] as const;
export type Capability = typeof CAPABILITIES[number];
export const CAPABILITY_LABELS: Record<Capability, string> = { text: "Text and reasoning", voice: "Voice", music: "Music", effects: "Sound effects", images: "Images" };

export const CONNECTION_IDS = ["openai", "google", "fal", "elevenlabs", "fish", "replicate", "bfl", "ideogram", "stability"] as const;
export type ConnectionId = typeof CONNECTION_IDS[number];

export interface ConnectionModel { id: string; label: string; capability: Capability; note?: string }
export interface ConnectionPlatform {
  id: ConnectionId; label: string; keyUrl: string; billing: string;
  supports: Capability[]; models: ConnectionModel[];
}

const imageModels = (platform: ImagePlatformId): ConnectionModel[] =>
  IMAGE_MODELS.filter(m => m.endpoints.some(e => e.platform === platform)).map(m => ({ id: m.id, label: m.label, capability: "images" as const, note: m.strength }));
const image = (id: ImagePlatformId) => ({ label: IMAGE_PLATFORMS[id].label, keyUrl: IMAGE_PLATFORMS[id].keyUrl, billing: IMAGE_PLATFORMS[id].billing });

export const CONNECTIONS: Record<ConnectionId, ConnectionPlatform> = {
  openai: { id: "openai", ...image("openai"), billing: "Per use, by model. Text and reasoning, and GPT Image.", supports: ["text", "images"],
    models: [{ id: "text", label: "Text models (chosen under Text and reasoning)", capability: "text" }, ...imageModels("openai")] },
  google: { id: "google", ...image("google"), billing: "Per use, by model. Text and reasoning, and Gemini image.", supports: ["text", "images"],
    models: [{ id: "text", label: "Text models (chosen under Text and reasoning)", capability: "text" }, ...imageModels("google")] },
  fal: { id: "fal", ...image("fal"), billing: "Pay as you go, per output. One key reaches many image models and makes music and sound effects.", supports: ["music", "effects", "images"],
    models: [{ id: "stable-audio-3-small-music", label: "Stable Audio 3 Small (music)", capability: "music", note: "About $0.02 per clip" }, { id: "stable-audio-3-small-sfx", label: "Stable Audio 3 Small (sound effects)", capability: "effects", note: "About $0.02 per clip" }, ...imageModels("fal")] },
  elevenlabs: { id: "elevenlabs", label: "ElevenLabs", keyUrl: "https://elevenlabs.io/app/settings/api-keys", billing: "Credits by plan. Free plans do not include music or sound effects.", supports: ["voice", "music", "effects"],
    models: [{ id: "eleven_v3", label: "Eleven v3 (expressive voice)", capability: "voice", note: "Audio tags such as [excited] steer delivery" }, { id: "elevenlabs-music", label: "Music", capability: "music" }, { id: "elevenlabs-sfx", label: "Sound effects", capability: "effects" }] },
  fish: { id: "fish", label: "Fish Audio", keyUrl: "https://fish.audio/go-api/api-keys", billing: "Pay as you go. Creating cloned voices through the API needs a paid plan.", supports: ["voice"],
    models: [{ id: "fish-s2", label: "Fish S2 (voice)", capability: "voice" }] },
  replicate: { id: "replicate", ...image("replicate"), supports: ["images"], models: imageModels("replicate") },
  bfl: { id: "bfl", ...image("bfl"), supports: ["images"], models: imageModels("bfl") },
  ideogram: { id: "ideogram", ...image("ideogram"), supports: ["images"], models: imageModels("ideogram") },
  stability: { id: "stability", ...image("stability"), supports: ["images"], models: imageModels("stability") },
};

/** What the owner saved for one platform. Empty means the defaults: used for everything it supports, every model allowed. */
export interface ConnectionPrefs { purposes?: Capability[]; disabledModels?: string[] }
export type ConnectionPrefsMap = Partial<Record<ConnectionId, ConnectionPrefs>>;

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/:-]{0,100}$/;
export function readConnectionPrefs(value: unknown): ConnectionPrefsMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: ConnectionPrefsMap = {};
  for (const id of CONNECTION_IDS) {
    const raw = (value as Record<string, unknown>)[id];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>, supports = CONNECTIONS[id].supports, known = new Set(CONNECTIONS[id].models.map(m => m.id));
    const prefs: ConnectionPrefs = {};
    if (Array.isArray(r.purposes)) prefs.purposes = CAPABILITIES.filter(c => supports.includes(c) && (r.purposes as unknown[]).includes(c));
    if (Array.isArray(r.disabledModels)) prefs.disabledModels = [...new Set((r.disabledModels as unknown[]).filter((m): m is string => typeof m === "string" && MODEL_ID.test(m) && known.has(m)))];
    if (prefs.purposes || prefs.disabledModels?.length) out[id] = prefs;
  }
  return out;
}

export const purposesOf = (id: ConnectionId, prefs: ConnectionPrefsMap): Capability[] => prefs[id]?.purposes ?? CONNECTIONS[id].supports;
export const usedFor = (id: ConnectionId, capability: Capability, prefs: ConnectionPrefsMap) => purposesOf(id, prefs).includes(capability);
export const modelAllowed = (id: ConnectionId, modelId: string, prefs: ConnectionPrefsMap) => !(prefs[id]?.disabledModels ?? []).includes(modelId);

/** What can be offered for a capability: platforms that are connected, used for it, with the models still allowed. */
export interface Offer { platform: ConnectionId; model: ConnectionModel }
export function offersFor(capability: Capability, connected: Partial<Record<ConnectionId, boolean>>, prefs: ConnectionPrefsMap): Offer[] {
  return CONNECTION_IDS.flatMap(id => connected[id] && usedFor(id, capability, prefs)
    ? CONNECTIONS[id].models.filter(m => m.capability === capability && modelAllowed(id, m.id, prefs)).map(model => ({ platform: id, model })) : []);
}
/** Platforms that could serve a capability at all, with whether each is connected and switched on for it (for the status rows on each type's page). */
export function platformsFor(capability: Capability, connected: Partial<Record<ConnectionId, boolean>>, prefs: ConnectionPrefsMap) {
  return CONNECTION_IDS.filter(id => CONNECTIONS[id].supports.includes(capability)).map(id => ({ id, connected: Boolean(connected[id]), enabled: usedFor(id, capability, prefs) }));
}
