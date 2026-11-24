/** Where each kind of audio is made: on the owner's Mac, or by a hosted provider with the Location's own key. Stored per Location; nothing here is a global priority. */
export const GENERATION_KINDS = ["voice", "music", "effects"] as const;
export type GenerationKind = typeof GENERATION_KINDS[number];
export type SourceChoice = "local" | "hosted";
export type GenerationSources = Partial<Record<GenerationKind, SourceChoice>>;

export const kindLabels: Record<GenerationKind, string> = { voice: "Voice", music: "Music", effects: "Sound effects" };
/** Hosted music and sound effects come from fal.ai or ElevenLabs (the Location picks, see sound-providers.ts); hosted voice from ElevenLabs or Fish, whichever voice is picked. */
export const hostedProviderLabel: Record<GenerationKind, string> = { voice: "ElevenLabs or Fish", music: "fal.ai or ElevenLabs", effects: "fal.ai or ElevenLabs" };

export function readGenerationSources(value: unknown): GenerationSources {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>, out: GenerationSources = {};
  for (const kind of GENERATION_KINDS) if (raw[kind] === "local" || raw[kind] === "hosted") out[kind] = raw[kind] as SourceChoice;
  return out;
}

export interface SourceFacts {
  /** The paired Mac can make this kind itself (music and effects need only the Mac; voice needs an installed on-device model). */
  localReady: boolean;
  /** The Location has a key for the hosted provider of this kind. */
  hostedKey: boolean;
}
export interface ResolvedSource { source: SourceChoice | "none"; chosen: boolean; label: string }
/** The user's choice wins. Without one: local when the Mac can, otherwise hosted when a key exists. */
export function resolveSource(kind: GenerationKind, choice: SourceChoice | undefined, facts: SourceFacts): ResolvedSource {
  const source: SourceChoice | "none" = choice ?? (facts.localReady ? "local" : facts.hostedKey ? "hosted" : "none");
  const label = source === "local" ? `${kindLabels[kind]}: made on this Mac` : source === "hosted" ? `${kindLabels[kind]}: ${hostedProviderLabel[kind]}` : `${kindLabels[kind]}: not set up`;
  return { source, chosen: choice !== undefined, label };
}
