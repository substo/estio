/** Structured script blocks. The record keeps `scriptBlocks` (this document) and a plain `script` derived from it on every save, so the script snapshot, Make video's parser and the agent keep reading text. Pure and client-safe. */
export type BlockType = "heading" | "narration" | "visual" | "break";
export interface BlockAudio { hash: string; uploadId: string; voiceId: string; at: string }
export interface ScriptBlock { id: string; type: BlockType; text: string; level?: 1 | 2 | 3; audio?: BlockAudio }
export interface ScriptBlocksDoc { version: 1; blocks: ScriptBlock[] }

export const MAX_BLOCKS = 500;
export const MAX_BLOCK_TEXT = 4500;
export const MAX_SCRIPT = 100_000;
export const BLOCK_LABELS: Record<BlockType, string> = { heading: "Heading", narration: "Narration", visual: "Visual note", break: "Section break" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const makeBlockId = () => `b${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
const clean = (text: string) => text.replace(/\r\n/g, "\n").replace(/\n[ \t]*\n+/g, "\n");   // a blank line would split one narration into two beats

/** Plain script -> blocks, without losing a line: `# x` heading, `# ---` break, `[x]` / `(x)` visual note, everything else narration. */
export function scriptToBlocks(script: string, id: () => string = makeBlockId): ScriptBlock[] {
  const blocks: ScriptBlock[] = [];
  for (const paragraph of script.replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    let spoken: string[] = [];
    const flush = () => { if (spoken.length) { blocks.push({ id: id(), type: "narration", text: spoken.join("\n") }); spoken = []; } };
    for (const raw of paragraph.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      const visual = /^\[([^\]]+)\]$|^\(([^)]+)\)$/.exec(line);
      if (heading) { flush(); const text = heading[2].trim(); blocks.push(text === "---" ? { id: id(), type: "break", text: "" } : { id: id(), type: "heading", text, level: heading[1].length as 1 | 2 | 3 }); }
      else if (visual) { flush(); blocks.push({ id: id(), type: "visual", text: (visual[1] ?? visual[2]).trim() }); }
      else spoken.push(line);
    }
    flush();
  }
  return blocks.slice(0, MAX_BLOCKS);
}

/** Blocks -> plain script in the format Make video already parses (headings are skipped there, visual notes attach to the next narration). */
export function blocksToScript(blocks: readonly ScriptBlock[]): string {
  return blocks.flatMap(block => {
    const text = clean(block.text).trim();
    if (block.type === "break") return ["# ---"];
    if (!text) return [];
    if (block.type === "heading") return [`${"#".repeat(block.level ?? 1)} ${text.replace(/\n/g, " ")}`];
    if (block.type === "visual") return [`[${text.replace(/[\[\]\n]/g, " ")}]`];
    return [text];
  }).join("\n\n");
}

/** Locate the exact contributed text of a saved block, keeping heading and visual markers outside the replacement. */
export function scriptBlockSpan(blocks: readonly ScriptBlock[], id: string) {
  let offset = 0;
  for (const block of blocks) {
    const encoded = blocksToScript([block]);
    if (!encoded) continue;
    if (block.id === id) {
      if (block.type === "break") return null;
      const leading = block.type === "heading" ? (block.level ?? 1) + 1 : block.type === "visual" ? 1 : 0;
      const text = encoded.slice(leading, block.type === "visual" ? -1 : undefined);
      if (!text || text.length > 1800) return null;
      const start = offset + leading;
      return { start, end: start + text.length, text };
    }
    offset += encoded.length + 2;
  }
  return null;
}

export const narrationBlocks = (blocks: readonly ScriptBlock[]) => blocks.filter(b => b.type === "narration" && clean(b.text).trim());

/** cyrb53: a small deterministic hash so server and browser agree on staleness without shipping crypto to the client. */
function cyrb53(input: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) { const c = input.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
export const audioHash = (voiceId: string, text: string) => cyrb53(`${voiceId}\n${clean(text).trim().replace(/\s+/g, " ")}`);
export type AudioStatus = "none" | "fresh" | "stale";
export function blockAudioStatus(block: ScriptBlock, voiceId: string | null): AudioStatus | null {
  if (block.type !== "narration" || !clean(block.text).trim()) return null;
  if (!block.audio) return "none";
  return voiceId && block.audio.hash === audioHash(voiceId, block.text) && block.audio.voiceId === voiceId ? "fresh" : "stale";
}

// Editing operations: all pure, all return a new array.
const at = (blocks: readonly ScriptBlock[], id: string) => blocks.findIndex(b => b.id === id);
export function moveBlock(blocks: readonly ScriptBlock[], id: string, delta: -1 | 1): ScriptBlock[] {
  const i = at(blocks, id), j = i + delta;
  if (i < 0 || j < 0 || j >= blocks.length) return [...blocks];
  const next = [...blocks]; [next[i], next[j]] = [next[j], next[i]]; return next;
}
export function moveBlockTo(blocks: readonly ScriptBlock[], id: string, index: number): ScriptBlock[] {
  const i = at(blocks, id); if (i < 0) return [...blocks];
  const next = [...blocks]; const [item] = next.splice(i, 1); next.splice(Math.max(0, Math.min(index, next.length)), 0, item); return next;
}
export function insertBlockAfter(blocks: readonly ScriptBlock[], afterId: string | null, type: BlockType, id: string = makeBlockId(), text = ""): ScriptBlock[] {
  if (blocks.length >= MAX_BLOCKS) return [...blocks];
  const next = [...blocks]; const i = afterId === null ? -1 : at(blocks, afterId);
  next.splice(i + 1, 0, { id, type, text, ...(type === "heading" ? { level: 1 as const } : {}) }); return next;
}
export const removeBlock = (blocks: readonly ScriptBlock[], id: string) => blocks.filter(b => b.id !== id);
export function setBlockText(blocks: readonly ScriptBlock[], id: string, text: string): ScriptBlock[] {
  return blocks.map(b => b.id === id ? { ...b, text: text.slice(0, MAX_BLOCK_TEXT) } : b);
}
export function setBlockType(blocks: readonly ScriptBlock[], id: string, type: BlockType): ScriptBlock[] {
  return blocks.map(b => {
    if (b.id !== id) return b;
    const { audio: _audio, level: _level, ...rest } = b;
    return { ...rest, type, ...(type === "heading" ? { level: 1 as const } : {}), ...(type === "break" ? { text: "" } : {}) };
  });
}
/** Enter in the middle of a block splits it; the first part keeps the id (and so its audio, which then reads as changed). */
export function splitBlock(blocks: readonly ScriptBlock[], id: string, caret: number, newId: string = makeBlockId()): ScriptBlock[] {
  const i = at(blocks, id); if (i < 0 || blocks.length >= MAX_BLOCKS) return [...blocks];
  const block = blocks[i], head = block.text.slice(0, caret), tail = block.text.slice(caret);
  const next = [...blocks];
  next.splice(i, 1, { ...block, text: head }, { id: newId, type: block.type === "heading" ? "narration" : block.type, text: tail });
  return next;
}
export function setBlockAudio(blocks: readonly ScriptBlock[], id: string, audio: BlockAudio | undefined): ScriptBlock[] {
  return blocks.map(b => { if (b.id !== id) return b; const { audio: _old, ...rest } = b; return audio ? { ...rest, audio } : rest; });
}

/** Stored document -> validated blocks, or null when it is not a usable document. Strict: unknown fields are dropped, bounds enforced. */
export function parseScriptBlocks(value: unknown): ScriptBlocksDoc | null {
  if (!value || typeof value !== "object") return null;
  const doc = value as { version?: unknown; blocks?: unknown };
  if (doc.version !== 1 || !Array.isArray(doc.blocks) || doc.blocks.length > MAX_BLOCKS) return null;
  const seen = new Set<string>(); const blocks: ScriptBlock[] = [];
  for (const raw of doc.blocks) {
    if (!raw || typeof raw !== "object") return null;
    const b = raw as Record<string, unknown>;
    if (typeof b.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(b.id) || seen.has(b.id)) return null;
    if (b.type !== "heading" && b.type !== "narration" && b.type !== "visual" && b.type !== "break") return null;
    if (typeof b.text !== "string" || b.text.length > MAX_BLOCK_TEXT) return null;
    seen.add(b.id);
    const block: ScriptBlock = { id: b.id, type: b.type, text: b.text };
    if (b.type === "heading") block.level = b.level === 2 || b.level === 3 ? b.level : 1;
    const a = b.audio as Record<string, unknown> | undefined;
    if (a && b.type === "narration") {
      if (typeof a.hash !== "string" || !/^[0-9a-f]{14}$/.test(a.hash) || typeof a.uploadId !== "string" || !uuid.test(a.uploadId)
        || typeof a.voiceId !== "string" || !uuid.test(a.voiceId) || typeof a.at !== "string" || a.at.length > 40) return null;
      block.audio = { hash: a.hash, uploadId: a.uploadId, voiceId: a.voiceId, at: a.at };
    }
    blocks.push(block);
  }
  const doc2: ScriptBlocksDoc = { version: 1, blocks };
  return blocksToScript(blocks).length > MAX_SCRIPT ? null : doc2;
}

/** The blocks to show for a record. If the plain script was changed elsewhere (the agent, an import), re-derive blocks from it and keep audio for narration whose text is unchanged. */
export function reconcileBlocks(payload: { script?: unknown; scriptBlocks?: unknown }, id: () => string = makeBlockId): ScriptBlock[] {
  const script = typeof payload.script === "string" ? payload.script : "";
  const stored = parseScriptBlocks(payload.scriptBlocks);
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  if (stored && norm(blocksToScript(stored.blocks)) === norm(script)) return stored.blocks;
  const fresh = scriptToBlocks(script, id);
  if (!stored) return fresh;
  const audioByText = new Map(stored.blocks.filter(b => b.audio).map(b => [norm(b.text), b.audio!]));
  return fresh.map(b => { const audio = b.type === "narration" ? audioByText.get(norm(b.text)) : undefined; return audio ? { ...b, audio } : b; });
}

export const blocksDoc = (blocks: readonly ScriptBlock[]): ScriptBlocksDoc => ({ version: 1, blocks: [...blocks] });
/** Beat n of Make video's parser is the n-th narration block: map them so fresh audio can be reused. */
export function beatAudio(blocks: readonly ScriptBlock[], voiceId: string): Map<number, string> {
  const reuse = new Map<number, string>();
  narrationBlocks(blocks).forEach((b, i) => { if (blockAudioStatus(b, voiceId) === "fresh" && b.audio) reuse.set(i + 1, b.audio.uploadId); });
  return reuse;
}
