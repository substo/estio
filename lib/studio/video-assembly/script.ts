import { readSourceQuoteCue, type SourceQuote } from "../script-source-quotes";
import { readSpeakerCue } from "../script-speakers";

/** A script is plain text: blank-line separated paragraphs are spoken beats; `[bracketed]` or `(parenthesised)` lines are visual directions for the beat that follows. */
export interface Beat { index: number; narration: string; direction?: string; speaker?: string }

const directionLine = /^\s*(?:\[([^\]]+)\]|\(([^)]+)\))\s*$/;

export type TimedSourceQuote = SourceQuote & { beforeBeat: number };
export function parseScriptTimeline(text: string) {
  const beats: Beat[] = [];
  const quotes: TimedSourceQuote[] = [];
  let direction: string[] = [];
  let speaker = "";
  for (const block of text.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    let spoken: string[] = [];
    const flush = () => {
      const narration = spoken.join(" ").replace(/\s+/g, " ").trim();
      if (!narration) return;
      beats.push({ index: beats.length + 1, narration, ...(direction.length ? { direction: direction.join("; ") } : {}), ...(speaker ? { speaker } : {}) });
      spoken = [];
      direction = [];
    };
    for (const raw of block.split("\n")) {
      const line = raw.trim();
      if (!line || /^#{1,6}\s/.test(line)) continue;
      const quote = readSourceQuoteCue(line);
      if (quote) {
        flush();
        quotes.push({ ...quote, beforeBeat: beats.length + 1 });
        continue;
      }
      const cue = readSpeakerCue(line);
      if (cue) {
        flush();
        speaker = cue.speaker;
        if (cue.text) spoken.push(cue.text);
        continue;
      }
      const d = directionLine.exec(line);
      if (d) direction.push((d[1] ?? d[2]).trim()); else spoken.push(line);
    }
    if (spoken.length) { flush(); speaker = ""; }
  }
  return { beats, quotes };
}

export const parseScript = (text: string) => parseScriptTimeline(text).beats;


export function sameScriptNarration(original: string, current: string) {
  if (original === current) return Boolean(current.trim());
  const lines = (value: string) => parseScript(value).map(beat => beat.narration);
  const expected = lines(original);
  return expected.length > 0 && JSON.stringify(expected) === JSON.stringify(lines(current));
}
