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
/** The band the model is asked to land in: ±7% around the middle, so an answer near its lower edge is still inside the ±15% acceptance range. */
export const AIM_TOLERANCE = 0.07;
export const aimWords = (seconds: number) => ({ target: Math.round(seconds / 60 * SPEAKING_WPM), min: Math.round(seconds / 60 * SPEAKING_WPM * (1 - AIM_TOLERANCE)), max: Math.round(seconds / 60 * SPEAKING_WPM * (1 + AIM_TOLERANCE)) });
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
const CONTEXT = /\b(video|script|long|length|duration|runtime|run time|minutes?|mins?|seconds?|secs?|about|around|roughly|approx|aim|target|under|within|make it|keep it|trim|cut|shorter|longer|revision|version)\b/i;

type Candidate = { index: number; end: number; seconds: number; clock: boolean };
/** Words before a duration that describe an earlier script, not a request ("after a 6-minute script, ..."). */
const DESCRIPTIVE = /\b(?:after|following|from|given|since|once|earlier|previous(?:ly)?|original(?:ly)?|last|old|existing|current|saved|first)\b[^,.;!?]{0,30}$/i;
/** Words before a duration the owner is correcting away from ("not 6 minutes", "instead of 6 minutes"). */
const NEGATED = /\b(?:not|instead of|rather than|no longer|than)\s+(?:a|an|the|about|around|roughly)?\s*$/i;
/** m:ss is a requested runtime only in a clearly requesting context; source timestamps, clock times and ratios are not. */
const CLOCK_BEFORE = /(?:\b(?:make|keep|get|bring|cut|trim|shorten|expand|stretch|tighten|lengthen)\s+(?:it|the\s+(?:script|video|revision|version|cut|take|draft))?(?:\s+(?:down\s+|up\s+|back\s+))?(?:to|at|under|within)?\s*(?:about|around|roughly|approx(?:imately)?|exactly|just)?\s*$|\b(?:give\s+me|want|wanted|need|needed|asked\s+for|said|should\s+be|needs\s+to\s+be|must\s+be|has\s+to\s+be|to\s+be|aim(?:ing)?\s+(?:for|at)|target(?:ing)?|runtime|length|duration|no\s+longer\s+than|at\s+most|under|within|about|approx(?:imately)?|roughly|exactly)\s*(?:of|is|was|:)?\s*(?:an?\s+|the\s+)?(?:about\s+|around\s+|roughly\s+)?$|\b(?:actually|now|instead|rather|make\s+that|change\s+(?:it\s+)?to|switch\s+to|go\s+(?:with|for)|let'?s\s+(?:do|say|make\s+it)|no\s+wait,?)\s*(?:an?\s+)?$|\b(?:an?|the)\s+$)/i;
const CLOCK_AFTER_OK = /^\s*(?:video|script|revision|version|cut|take|draft|runtime|long|length|total|spoken|edit|rewrite|one)\b/i;
const CLOCK_AFTER_NO = /^\s*(?:in(?:to)?\b|mark|timestamp|pm\b|am\b|p\.m|a\.m|ratio|aspect|o'clock)/i;
const CLOCK_BEFORE_NO = /(?:\b(?:at|from|until|till|by|between)|@)\s*(?:the\s+)?$/i;

/**
 * Reads an approximate duration out of the owner's own words ("about 90 seconds", "a 3-4 minute video", "give me a 1:30 revision").
 * Deterministic and server-side: the model cannot invent or change the target. The latest explicit request wins over an earlier
 * descriptive or negated duration. Returns null when the message states none.
 */
export function parseDurationRequest(message: string): DurationRequest | null {
  const text = message.replace(/\s+/g, " ");
  if (/\b(no (?:time|length|duration) (?:limit|target|constraint)|any length|forget the (?:length|duration)|drop the (?:length|duration) target|don'?t (?:worry about|care about) (?:the )?(?:length|duration))\b/i.test(text)) return { kind: "clear" };
  const found: Candidate[] = [];
  const add = (index: number, length: number, seconds: number, clock = false) => {
    if (seconds >= MIN_TARGET_SECONDS && seconds <= MAX_TARGET_SECONDS && !found.some(c => index < c.end && index + length > c.index)) found.push({ index, end: index + length, seconds, clock });
  };
  for (const m of text.matchAll(/\bhalf (?:a|an) minute\b/gi)) add(m.index!, m[0].length, 30);
  for (const m of text.matchAll(/\b(?:a|one) minute and a half\b/gi)) add(m.index!, m[0].length, 90);
  for (const m of text.matchAll(new RegExp(String.raw`\b${NUMBER}\s*(?:-|–|—|to)\s*${NUMBER}\s*${UNIT}`, "gi")))
    add(m.index!, m[0].length, Math.round((toSeconds(toNumber(m[1]), m[3]) + toSeconds(toNumber(m[2]), m[3])) / 2));
  for (const m of text.matchAll(new RegExp(String.raw`\b${NUMBER}[\s-]*${UNIT}`, "gi"))) add(m.index!, m[0].length, toSeconds(toNumber(m[1]), m[2]));
  const named = CONTEXT.test(text);
  // m:ss with strict seconds 00-59, not part of h:mm:ss.
  for (const m of text.matchAll(/(?<![\d:])(\d{1,2}):([0-5]\d)(?![\d:])/g)) {
    const before = text.slice(Math.max(0, m.index! - 70), m.index!), after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 24);
    if (CLOCK_AFTER_NO.test(after) || (CLOCK_BEFORE_NO.test(before) && !CLOCK_AFTER_OK.test(after))) continue;
    if (CLOCK_BEFORE.test(before) || CLOCK_AFTER_OK.test(after)) add(m.index!, m[0].length, Number(m[1]) * 60 + Number(m[2]), true);
  }
  if (!found.length || (!named && !found.some(c => c.clock))) return null;
  found.sort((a, b) => a.index - b.index);
  const live = found.filter(c => !NEGATED.test(text.slice(Math.max(0, c.index - 30), c.index)));
  if (!live.length) return null;
  // With several durations the latest explicit request wins; an earlier description of an existing script does not.
  const requests = live.length > 1 ? live.filter(c => !DESCRIPTIVE.test(text.slice(Math.max(0, c.index - 40), c.index))) : live;
  const chosen = (requests.length ? requests : live).at(-1)!;
  return { kind: "set", seconds: chosen.seconds };
}

/**
 * Fit by section. A Script is written in beats, each introduced by a cue line such as `[Opening]`, `[Development]` or `[Payoff]`
 * (cues are not spoken words). Default budgets split the target 15% / 65% / 20%, which adds up to the target. Only a script that
 * actually uses at least two beat cues gets a section breakdown; nothing is inferred from unlabelled text.
 */
export const BEATS = ["Opening", "Development", "Payoff"] as const;
export type Beat = typeof BEATS[number];
export const BEAT_SHARE: Record<Beat, number> = { Opening: 0.15, Development: 0.65, Payoff: 0.2 };
const BEAT_NAMES: Record<string, Beat> = { opening: "Opening", hook: "Opening", intro: "Opening", development: "Development", body: "Development", middle: "Development", example: "Development", payoff: "Payoff", close: "Payoff", closing: "Payoff", ending: "Payoff", cta: "Payoff" };
export function beatBudgets(targetSeconds: number) {
  const total = Math.round(targetSeconds / 60 * SPEAKING_WPM);
  const opening = Math.round(total * BEAT_SHARE.Opening), payoff = Math.round(total * BEAT_SHARE.Payoff);
  return { Opening: opening, Development: total - opening - payoff, Payoff: payoff } satisfies Record<Beat, number>;
}
export function sectionStats(text: string, targetSeconds: number | null) {
  const parts: Partial<Record<Beat, number>> = {};
  let current: Beat | null = null, seen = 0;
  for (const line of text.split(/\r?\n/)) {
    const cue = /^\s*\[\s*([A-Za-z]+)\b[^\]]*\]/.exec(line);
    const beat = cue ? BEAT_NAMES[cue[1].toLowerCase()] : undefined;
    if (beat) { current = beat; seen++; }
    const spoken = words(line.replace(/\[[^\]]*\]/g, " "));
    if (current && spoken) parts[current] = (parts[current] ?? 0) + spoken;
  }
  if (seen < 2) return null;
  const budgets = targetSeconds ? beatBudgets(targetSeconds) : null;
  return BEATS.filter(beat => parts[beat] !== undefined || budgets).map(beat => {
    const spoken = parts[beat] ?? 0, budget = budgets ? budgets[beat] : null;
    const gap = budget ? spoken / budget - 1 : null;
    return { beat, spokenWords: spoken, budgetWords: budget, state: gap === null ? null : Math.abs(gap) <= 0.25 ? "match" as const : gap < 0 ? "short" as const : "long" as const, percent: gap === null ? null : Math.round(Math.abs(gap) * 100) };
  });
}
