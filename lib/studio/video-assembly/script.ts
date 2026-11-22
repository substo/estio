/** A script is plain text: blank-line separated paragraphs are spoken beats; `[bracketed]` or `(parenthesised)` lines are visual directions for the beat that follows. */
export interface Beat { index: number; narration: string; direction?: string }

const directionLine = /^\s*(?:\[([^\]]+)\]|\(([^)]+)\))\s*$/;

export function parseScript(text: string): Beat[] {
  const beats: Beat[] = [];
  let direction: string[] = [];
  for (const block of text.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const spoken: string[] = [];
    for (const raw of block.split("\n")) {
      const line = raw.trim();
      if (!line || /^#{1,6}\s/.test(line)) continue;
      const d = directionLine.exec(line);
      if (d) direction.push((d[1] ?? d[2]).trim()); else spoken.push(line);
    }
    const narration = spoken.join(" ").replace(/\s+/g, " ").trim();
    if (!narration) continue;
    beats.push({ index: beats.length + 1, narration, ...(direction.length ? { direction: direction.join("; ") } : {}) });
    direction = [];
  }
  return beats;
}
