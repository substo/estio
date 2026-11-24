/**
 * The script as a transcript that follows the video: each spoken beat is a line, each word has a start and an end,
 * so the player can highlight the word being said and a click on a word can seek to it.
 *
 * The timeline says when each narration clip (one per beat) plays. Within a clip the words are spread by length, with a longer
 * pause after a comma and a longer one after a full stop. That is an estimate (a few tenths of a second off for a long clip);
 * the text and the clips are exact.
 */
export interface TranscriptWord { text: string; start: number; end: number }
export interface TranscriptLine { index: number; start: number; end: number; words: TranscriptWord[] }
export interface VoiceSpan { s: number; e: number }

const COMMA_PAUSE = 3, STOP_PAUSE = 6, MIN_WEIGHT = 2;
const weightOf = (word: string) => {
  const letters = word.replace(/[^\p{L}\p{N}]/gu, "").length;
  const pause = /[.!?…]["')\]]*$/.test(word) ? STOP_PAUSE : /[,;:–—]["')\]]*$/.test(word) ? COMMA_PAUSE : 0;
  return Math.max(MIN_WEIGHT, letters) + pause;
};
const round = (n: number) => Math.round(n * 1000) / 1000;

/** One line per beat. Null when the beats and the narration clips do not line up (the video was edited by hand), so nothing misleading is shown. */
export function buildTranscript(beats: string[], voice: VoiceSpan[]): TranscriptLine[] | null {
  const clips = [...voice].filter(c => Number.isFinite(c.s) && Number.isFinite(c.e) && c.e > c.s).sort((a, b) => a.s - b.s);
  if (!beats.length || beats.length !== clips.length) return null;
  return beats.map((text, i) => {
    const words = text.split(/\s+/).filter(Boolean), clip = clips[i];
    const total = words.reduce((sum, w) => sum + weightOf(w), 0) || 1;
    let at = clip.s;
    const out = words.map(word => {
      const span = (clip.e - clip.s) * weightOf(word) / total;
      const w = { text: word, start: round(at), end: round(at + span) };
      at += span;
      return w;
    });
    return { index: i, start: clip.s, end: clip.e, words: out };
  });
}

/** The word being said at time `t` (seconds): the last word that has started inside its line. Between lines, nothing is active. */
export function activeWord(lines: TranscriptLine[], t: number): { line: number; word: number } | null {
  for (const line of lines) {
    if (t < line.start || t >= line.end) continue;
    let found = 0;
    line.words.forEach((w, i) => { if (t >= w.start) found = i; });
    return { line: line.index, word: found };
  }
  return null;
}
