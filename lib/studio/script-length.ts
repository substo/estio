/**
 * Approximate spoken length. Pace: 150 words per minute, a common on-camera narration rate (slower for explanation,
 * faster for energetic delivery); the estimate ignores pauses and cutaways, so it is a planning figure, not a stopwatch.
 * Spoken copy is everything except cues: text in [square brackets] is a shoot/screen cue or transition and is counted separately.
 */
export const SPEAKING_WPM = 150;
/** Longest script one proposal can carry: 1,200 spoken words (8 minutes) and 9,000 characters including cues. */
export const MAX_SCRIPT_WORDS = 1200;
export const MAX_SCRIPT_CHARS = 9000;
export const MAX_SINGLE_SCRIPT_SECONDS = Math.round(MAX_SCRIPT_WORDS / SPEAKING_WPM * 60);
export const MIN_TARGET_SECONDS = 10;
export const MAX_TARGET_SECONDS = 3600;
/** A script within ±15% of the request is a match; beyond ±30% it is meaningfully short or long. */
export const FIT_TOLERANCE = 0.15;
export const FIT_REVISE = 0.3;

const words = (text: string) => (text.match(/\S+/g) ?? []).length;
export function scriptStats(text: string) {
  const cues = [...text.matchAll(/\[[^\]]*\]/g)].map(match => match[0]);
  const spoken = words(text.replace(/\[[^\]]*\]/g, " "));
  const cueWords = cues.reduce((sum, cue) => sum + words(cue), 0);
  return { spokenWords: spoken, cueWords, seconds: Math.round(spoken / SPEAKING_WPM * 60) };
}
export const targetWords = (seconds: number) => ({ target: Math.round(seconds / 60 * SPEAKING_WPM), min: Math.round(seconds / 60 * SPEAKING_WPM * (1 - FIT_TOLERANCE)), max: Math.round(seconds / 60 * SPEAKING_WPM * (1 + FIT_TOLERANCE)) });
export function formatClock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type LengthFit = { state: "match" | "short" | "long"; percent: number; meaningful: boolean; beyondSupported: boolean };
/** Compares the estimated runtime with the request. A mismatch is never reported as a pass. */
export function lengthFit(targetSeconds: number, estimatedSeconds: number): LengthFit {
  const ratio = estimatedSeconds / targetSeconds - 1;
  const state = Math.abs(ratio) <= FIT_TOLERANCE ? "match" : ratio < 0 ? "short" : "long";
  return { state, percent: Math.round(Math.abs(ratio) * 100), meaningful: Math.abs(ratio) > FIT_REVISE, beyondSupported: targetSeconds > MAX_SINGLE_SCRIPT_SECONDS };
}

export type DurationRequest = { kind: "set"; seconds: number } | { kind: "clear" };
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };
const UNIT = String.raw`(seconds?|secs?|s|minutes?|mins?|m)\b`;
const NUMBER = String.raw`(\d+(?:\.\d+)?|${Object.keys(NUMBER_WORDS).join("|")})`;
const toNumber = (raw: string) => NUMBER_WORDS[raw.toLowerCase()] ?? Number(raw);
const toSeconds = (value: number, unit: string) => Math.round(/^m/i.test(unit) && !/^s/i.test(unit) ? value * 60 : value);
const CONTEXT = /\b(video|script|long|length|duration|runtime|run time|minutes?|mins?|seconds?|secs?|about|around|roughly|approx|aim|target|under|within|make it|keep it|trim|cut|shorter|longer)\b/i;

/**
 * Reads an approximate duration out of the owner's own words ("about 90 seconds", "a 3–4 minute video", "make it 2 minutes").
 * Deterministic and server-side: the model cannot invent or change the target. Returns null when the message states none.
 */
export function parseDurationRequest(message: string): DurationRequest | null {
  const text = message.replace(/\s+/g, " ");
  if (/\b(no (?:time|length|duration) (?:limit|target|constraint)|any length|forget the (?:length|duration)|drop the (?:length|duration) target|don'?t (?:worry about|care about) (?:the )?(?:length|duration))\b/i.test(text)) return { kind: "clear" };
  if (!CONTEXT.test(text)) return null;
  const clamp = (seconds: number) => seconds >= MIN_TARGET_SECONDS && seconds <= MAX_TARGET_SECONDS ? { kind: "set" as const, seconds } : null;
  if (/\bhalf (?:a|an) minute\b/i.test(text)) return clamp(30);
  if (/\b(?:a|one) minute and a half\b/i.test(text)) return clamp(90);
  const range = new RegExp(String.raw`\b${NUMBER}\s*(?:-|–|—|to)\s*${NUMBER}\s*${UNIT}`, "i").exec(text);
  if (range) {
    const a = toSeconds(toNumber(range[1]), range[3]), b = toSeconds(toNumber(range[2]), range[3]);
    return clamp(Math.round((a + b) / 2));
  }
  const single = new RegExp(String.raw`\b${NUMBER}[\s-]*${UNIT}`, "i").exec(text);
  return single ? clamp(toSeconds(toNumber(single[1]), single[2])) : null;
}
