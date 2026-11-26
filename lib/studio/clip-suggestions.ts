import { readSourceQuoteCue, validateSourceQuote, MAX_SOURCE_QUOTES, sourceQuoteCue, type SourceQuote } from "./script-source-quotes";
import { insertBlockAfter, makeBlockId, MAX_BLOCKS, type ScriptBlock } from "./script-blocks";
import { withoutSpeakerCues } from "./script-speakers";

/** A timed line of speech in an uploaded video (seconds into the file), as the transcript stored it. */
export interface TimedSegment { start: number; end: number; text: string }
export interface ClipSource { uploadId: string; name: string; segments: TimedSegment[] }
export interface ClipSuggestion { blockId: string; beat: number; uploadId: string; name: string; start: number; end: number; quote: string; score: number }

const STOP = new Set("about after again also because been before being between both could does doing down each even from have here into just like make more most much only other over really same should some such than that their them then there these they this those through very want were what when where which while will with would your you and are but can for had has her him his how its not our out she the was who why".split(" "));
const words = (text: string) => [...new Set(text.toLowerCase().split(/[^\p{L}\p{N}']+/u).map(w => w.replace(/^'+|'+$/g, "")).filter(w => w.length >= 4 && !STOP.has(w)))];
const round = (n: number) => Math.round(n * 10) / 10;
const MAX_CLIP = 15, MIN_CLIP = 1.5, PAD = 0.3, MIN_SHARED = 3, MIN_SCORE = 0.25;

/** Windows of consecutive lines, 1.5 to 15 seconds long: the moments a clip could be cut from. */
function windows(segments: readonly TimedSegment[]) {
  const out: Array<{ start: number; end: number; text: string; tokens: string[] }> = [];
  const lines = segments.filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start && s.text.trim()).sort((a, b) => a.start - b.start);
  for (let i = 0; i < lines.length; i++) {
    let text = "";
    for (let j = i; j < lines.length && lines[j].end - lines[i].start <= MAX_CLIP; j++) {
      text += `${text ? " " : ""}${lines[j].text.trim()}`;
      if (lines[j].end - lines[i].start >= MIN_CLIP) out.push({ start: lines[i].start, end: lines[j].end, text, tokens: words(text) });
    }
  }
  return out;
}

/**
 * Which lines of the script a moment in an uploaded video could support: the script line and the moment share the same specific words.
 * No model is involved: a suggestion is only ever a real stretch of the video's own transcript, so its quote and times are never invented.
 * Lines that already have a clip right after them are skipped; one suggestion per line, and no two suggestions use the same moment.
 */
export function suggestClips(blocks: readonly ScriptBlock[], sources: readonly ClipSource[], max = 8): ClipSuggestion[] {
  const pool = sources.map(s => ({ source: s, windows: windows(s.segments) }));
  const taken: Array<{ uploadId: string; start: number; end: number }> = readQuotes(blocks).map(q => ({ uploadId: q.asset, start: q.start, end: q.end }));
  const found: ClipSuggestion[] = [];
  let beat = 0;
  for (const [index, block] of blocks.entries()) {
    if (block.type !== "narration") continue;
    beat++;
    const next = blocks[index + 1];
    if (next && readSourceQuoteCue(next.text)) continue;
    const mine = words(withoutSpeakerCues(block.text));
    if (mine.length < MIN_SHARED) continue;
    let best: ClipSuggestion | null = null, bestRaw = { start: 0, end: 0 };
    for (const { source, windows: list } of pool) for (const w of list) {
      if (taken.some(t => t.uploadId === source.uploadId && w.start < t.end && w.end > t.start)) continue;
      const shared = mine.filter(t => w.tokens.includes(t)).length;
      if (shared < MIN_SHARED || !w.tokens.length) continue;
      // Shared specific words relative to both texts; a longer window needs proportionally more to win, so the tightest good match is chosen.
      const score = shared / Math.sqrt(mine.length * w.tokens.length);
      if (score >= MIN_SCORE && (!best || score > best.score)) best = { blockId: block.id, beat, uploadId: source.uploadId, name: source.name, start: round(Math.max(0, w.start - PAD)), end: round(w.end + PAD), quote: w.text.slice(0, 240), score: round(score * 100) / 100 }, bestRaw = { start: w.start, end: w.end };
    }
    if (best) { found.push(best); taken.push({ uploadId: best.uploadId, ...bestRaw }); }
  }
  return found.sort((a, b) => b.score - a.score).slice(0, max).sort((a, b) => a.beat - b.beat);
}
const readQuotes = (blocks: readonly ScriptBlock[]) => blocks.map(b => readSourceQuoteCue(b.text)).filter((q): q is SourceQuote => q !== null);

/** The credit shown on screen: the file's own name without its extension, until the creator writes a better one. */
export const defaultCredit = (name: string) => name.replace(/\.[A-Za-z0-9]{2,5}$/, "").replace(/[\[\]\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Source video";

/** Add an approved suggestion to the script as a source clip block right after the line that cites it. Null when it cannot be added (unknown line, bad times, too many clips). */
export function addSuggestedClip(blocks: readonly ScriptBlock[], pick: { blockId: string; uploadId: string; start: number; end: number; credit: string }): ScriptBlock[] | null {
  const quote = validateSourceQuote({ asset: pick.uploadId, start: pick.start, end: pick.end, credit: pick.credit });
  if (!quote || !blocks.some(b => b.id === pick.blockId && b.type === "narration") || blocks.length >= MAX_BLOCKS || readQuotes(blocks).length >= MAX_SOURCE_QUOTES) return null;
  return insertBlockAfter(blocks, pick.blockId, "visual", makeBlockId(), sourceQuoteCue(quote));
}
