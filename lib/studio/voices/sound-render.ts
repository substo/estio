import { generateMusicBed, generateSoundEffect, VoiceProviderError } from "./clients";
import { FalError, generateFalSound } from "./fal-client";
import type { HostedSoundProvider, SoundKind } from "./sound-providers";

type Fetch = typeof fetch;
export const SOUND_PROMPTS: Record<SoundKind, string> = {
  music: "Calm, modern instrumental background music for a creator video. Soft pulse, light piano and warm pads, no vocals, steady energy, loop-friendly, leaves room for a spoken voiceover.",
  effects: "A soft, short whoosh transition sound, smooth air swoosh, clean, no music",
};
/** One clip from the chosen hosted provider. Music takes the length of the video (clamped by the provider); an effect is about a second. */
export function generateHostedSound(provider: HostedSoundProvider, kind: SoundKind, key: string, seconds: number, fetcher: Fetch = fetch): Promise<Buffer> {
  const length = kind === "music" ? seconds : 1;
  if (provider === "fal") return generateFalSound(key, kind, SOUND_PROMPTS[kind], length, fetcher);
  return kind === "music" ? generateMusicBed(key, SOUND_PROMPTS.music, length, fetcher) : generateSoundEffect(key, SOUND_PROMPTS.effects, length, fetcher);
}
/** The provider's own words for the page ("Made without music or sound effects: ..."). */
export const soundErrorMessage = (error: unknown): string | null => error instanceof VoiceProviderError || error instanceof FalError ? error.message : null;
