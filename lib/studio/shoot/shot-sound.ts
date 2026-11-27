/**
 * Whose sound plays on a filmed beat. A shot's own sound carries the beat only when the clip contains speech that matches the shot's line;
 * a silent clip, b-roll, a test pattern or a tone keeps the generated voiceover, played over the clip. Shared by the Mac assembly and the Shoot page.
 */
export type ShotSound = "own" | "voiceover";

const words = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).map(w => w.replace(/^'+|'+$/g, "")).filter(Boolean);

/** Does the transcript contain the shot's line? At least half of the line's words (all of them for a very short line) must be spoken. */
export function speechMatchesLine(transcript: string, line: string): boolean {
  const said = new Set(words(transcript)), wanted = words(line);
  if (said.size < 2 || !wanted.length) return false;
  const hits = wanted.filter(w => said.has(w)).length;
  return wanted.length <= 3 ? hits === wanted.length : hits / wanted.length >= 0.5;
}

/** From a transcript of the clip (null/empty when it has no speech) and the shot's line. */
export const soundFromTranscript = (transcript: string | null | undefined, line: string): ShotSound => transcript && speechMatchesLine(transcript, line) ? "own" : "voiceover";

/**
 * A cheap fallback when no transcript can be made: ffmpeg's volumedetect output for the clip's audio. No audio, or near-silence, is not speech.
 * A steady tone is not speech either: its peak sits only about 3 dB above its mean level, while speech swings well above that.
 */
export function soundFromVolume(volumedetect: string): ShotSound {
  const mean = /mean_volume:\s*(-?[\d.]+|-inf)\s*dB/.exec(volumedetect)?.[1], max = /max_volume:\s*(-?[\d.]+|-inf)\s*dB/.exec(volumedetect)?.[1];
  const m = Number(mean), x = Number(max);
  if (!mean || !max || !Number.isFinite(m) || !Number.isFinite(x) || m < -50) return "voiceover";
  return x - m >= 9 ? "own" : "voiceover";
}

export const SHOT_SOUND_LABEL: Record<ShotSound, string> = {
  own: "Its own sound will be used (speech found that matches this line).",
  voiceover: "The voiceover will play over this clip (no speech that matches this line).",
};
