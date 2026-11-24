/**
 * Every way a Location can get music or sound effects, in one place: what runs it, what it needs, what it costs.
 * The settings card, the Make video dialog and the server renderer all read this file. Prices are list prices seen on the
 * providers' own pages (November 2026); they change, so the UI says "about" and links the provider.
 */
export type SoundKind = "music" | "effects";
export type SoundProviderId = "synth" | "stable-audio-3-small" | "elevenlabs" | "fal";
export type HostedSoundProvider = "elevenlabs" | "fal";

export interface SoundProvider {
  id: SoundProviderId; label: string; kinds: readonly SoundKind[];
  runs: "mac" | "hosted";
  /** nothing = works at once; model = an installed on-device model (with accepted terms); key = the Location's own API key. */
  needs: "nothing" | "model" | "key";
  /** Catalog model id per kind, for on-device models. */
  modelIds?: Partial<Record<SoundKind, string>>;
  price: string; freeTier: string; licence: string;
  /** Where the person reads the provider's own terms and prices. */
  url: string;
}

export const SOUND_PROVIDERS: readonly SoundProvider[] = Object.freeze([
  { id: "synth", label: "Built-in synth (this Mac)", kinds: ["music", "effects"], runs: "mac", needs: "nothing",
    price: "Free", freeTier: "Always free, no setup", licence: "Yours to use", url: "" },
  { id: "stable-audio-3-small", label: "Stable Audio 3 Small (this Mac)", kinds: ["music", "effects"], runs: "mac", needs: "model",
    modelIds: { music: "stable-audio-3-small-music", effects: "stable-audio-3-small-sfx" },
    price: "Free to run (about 3.5 GB per model)", freeTier: "Free", licence: "Stability AI Community Licence + Gemma terms, accepted when you install it", url: "https://stability.ai/community-license-agreement" },
  { id: "fal", label: "fal.ai (Stable Audio 3 Small)", kinds: ["music", "effects"], runs: "hosted", needs: "key",
    price: "About $0.02 per clip (music up to 2 min)", freeTier: "Pay as you go; new accounts may get starter credit", licence: "Stability AI Community Licence applies to the output", url: "https://fal.ai/pricing" },
  { id: "elevenlabs", label: "ElevenLabs", kinds: ["music", "effects"], runs: "hosted", needs: "key",
    price: "Included credits on paid plans; sound effects about $0.12 per minute on the API", freeTier: "Free plan: attribution required and no commercial licence", licence: "Commercial use needs a paid plan", url: "https://elevenlabs.io/pricing/api" },
] satisfies SoundProvider[]);

export const soundProvider = (id: unknown): SoundProvider | undefined => SOUND_PROVIDERS.find(p => p.id === id);
export const HOSTED_SOUND_PROVIDERS: readonly HostedSoundProvider[] = ["fal", "elevenlabs"];
export const isHostedSoundProvider = (id: unknown): id is HostedSoundProvider => id === "fal" || id === "elevenlabs";
export const hostedOptions = (kind: SoundKind) => SOUND_PROVIDERS.filter((p): p is SoundProvider & { id: HostedSoundProvider } => p.runs === "hosted" && p.kinds.includes(kind));

/** The Location's chosen hosted provider per kind (stored beside the local/hosted choice). */
export type SoundProviderChoices = Partial<Record<SoundKind, HostedSoundProvider>>;
export function readSoundProviderChoices(value: unknown): SoundProviderChoices {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>, out: SoundProviderChoices = {};
  for (const kind of ["music", "effects"] as const) if (isHostedSoundProvider(raw[kind])) out[kind] = raw[kind] as HostedSoundProvider;
  return out;
}
export type SoundKeys = Record<HostedSoundProvider, boolean>;
/** Which hosted provider renders this kind: the chosen one when it has a key, otherwise the first with a key (fal before ElevenLabs: its price is per clip and its free plan does not allow music over the API). Null when none can. */
export function pickHostedSound(choice: HostedSoundProvider | undefined, keys: SoundKeys): HostedSoundProvider | null {
  if (choice && keys[choice]) return choice;
  return HOSTED_SOUND_PROVIDERS.find(p => keys[p]) ?? null;
}

/** The line the Make video dialog shows for one kind: where it will be made, by what. */
export function soundSourceLabel(kind: SoundKind, source: "local" | "hosted" | "none", hosted: HostedSoundProvider | null, modelInstalled: boolean): string {
  const word = kind === "music" ? "Music" : "Sound effects";
  if (source === "hosted") return hosted ? `${word}: ${soundProvider(hosted)!.label}` : `${word}: add a fal.ai or ElevenLabs key (made on this Mac meanwhile)`;
  return `${word}: made on this Mac with ${modelInstalled ? "Stable Audio 3 Small" : "the built-in synth"}`;
}
