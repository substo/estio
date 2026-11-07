import { z } from "zod";

/**
 * A plain-language story of a piece of work, shown first when its feature is opened on the Build page: what it is (concept), what was achieved,
 * how it works, and what's next, plus the product area it belongs to. Client-safe (zod only).
 *
 * Stored on the BuildJob's checkpoint as `checkpoint.story`, not on the spec: the spec is the approved, immutable scope
 * (approval binds it; external scope can't change), while a story is description that is updated as work moves on.
 * The server keeps it when the worker or an external report rewrites the checkpoint.
 */
export const storyLimits = { area: 60, concept: 600, item: 280, achieved: 12, howItWorks: 12, next: 8 } as const;

const hash = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi;
/** Plain text for a story: no inline code marks, no commit hashes, single spaces. */
export function plain(text: string) {
  return text.replace(/`+/g, "").replace(hash, "").replace(/\(\s*\)/g, "").replace(/\s+([,.;:)])/g, "$1").replace(/\s+/g, " ").trim();
}
const line = (max: number) => z.preprocess(v => typeof v === "string" ? plain(v) : v, z.string().min(1).max(max));
const list = (max: number) => z.array(line(storyLimits.item)).max(max).default([]);
export const storyInput = z.object({
  area: line(storyLimits.area).optional(),
  concept: line(storyLimits.concept),
  achieved: list(storyLimits.achieved), howItWorks: list(storyLimits.howItWorks), next: list(storyLimits.next),
}).strict();
export type StoryInput = z.infer<typeof storyInput>;
export const storySpec = storyInput.extend({ updatedAt: z.string().max(40), by: z.enum(["task", "owner", "worker"]).optional() }).strict();
export type Story = z.infer<typeof storySpec>;

export function makeStory(input: StoryInput, by: Story["by"], now = new Date()): Story {
  return storySpec.parse({ ...storyInput.parse(input), updatedAt: now.toISOString(), by });
}
/** The story already on a checkpoint, if valid. */
export function storyFrom(checkpoint: unknown): Story | undefined {
  const r = storySpec.safeParse((checkpoint as { story?: unknown } | null)?.story);
  return r.success ? r.data : undefined;
}
/** A rewritten checkpoint keeps the previous story unless it brings a valid one of its own. */
export function keepStory<T extends Record<string, unknown>>(previous: unknown, next: T): T {
  const story = storyFrom(next) ?? storyFrom(previous);
  const { story: _drop, ...rest } = next;
  return (story ? { ...rest, story } : rest) as T;
}

const storyHeading = /^\s*(?:#{1,6}\s*)?\**\s*story\s*(?:\**\s*:\s*\**|:)\s*(.*)$|^\s*#{1,6}\s*\**\s*story\s*\**\s*$/i;
const decisionsHeading = /^\s*(?:#{1,6}\s*)?\**\s*decisions\s*\**\s*:/i;
const fields: [keyof StoryInput, RegExp][] = [
  ["area", /^(?:area|product area)$/i], ["concept", /^(?:concept|what it is)$/i], ["achieved", /^(?:achieved|what was achieved)$/i],
  ["howItWorks", /^(?:how it works|features)$/i], ["next", /^(?:next|what'?s next|next steps?)$/i],
];
const fieldLine = /^\s*(?:#{1,6}\s*)?(?:[-*]\s+)?\**\s*([a-z' ]{2,20}?)\s*(?:\**\s*:\s*\**|:)\s*(.*)$/i;
const headingOnly = /^\s*#{1,6}\s*([a-z' ]{2,20}?)\s*$/i;
const bullet = /^\s*(?:[-*•]|\d+[.)])\s+/;

/**
 * The "Story:" section of a task report (Area, Concept, Achieved, How it works, Next), or null if there is none or it
 * has no concept. Long text is trimmed to the limits rather than rejected.
 */
export function storyOf(report: string): StoryInput | null {
  const lines = report.split(/\r?\n/);
  let start = -1;
  lines.forEach((l, i) => { if (storyHeading.test(l)) start = i; });
  if (start < 0) return null;
  const draft: Record<string, string[]> = { area: [], concept: [], achieved: [], howItWorks: [], next: [] };
  let field: keyof StoryInput | null = null;
  const first = storyHeading.exec(lines[start])?.[1]?.trim();
  const body = first ? [first, ...lines.slice(start + 1)] : lines.slice(start + 1);
  for (const raw of body) {
    if (decisionsHeading.test(raw)) break;
    if (!raw.trim()) continue;
    const m = fieldLine.exec(raw) ?? headingOnly.exec(raw);
    const name = m && fields.find(([, re]) => re.test(m[1].trim()))?.[0];
    if (m && name) { field = name; if (m[2]?.trim()) draft[name].push(m[2].trim()); continue; }
    if (!field) continue;
    const text = raw.replace(bullet, "").trim();
    const items = draft[field];
    if (field !== "concept" && field !== "area" && !bullet.test(raw) && /^\s{2,}/.test(raw) && items.length) items[items.length - 1] += ` ${text}`;
    else items.push(text);
  }
  const cut = (s: string, n: number) => { const p = plain(s); return p.length > n ? `${p.slice(0, n - 1).trimEnd()}…` : p; };
  const items = (k: "achieved" | "howItWorks" | "next") => draft[k].map(s => cut(s, storyLimits.item)).filter(Boolean).slice(0, storyLimits[k]);
  const concept = cut(draft.concept.join(" "), storyLimits.concept);
  if (!concept) return null;
  const area = cut(draft.area.join(" "), storyLimits.area);
  const r = storyInput.safeParse({ ...(area.length >= 1 ? { area } : {}), concept, achieved: items("achieved"), howItWorks: items("howItWorks"), next: items("next") });
  return r.success ? r.data : null;
}

/** "Story:" instruction for task reports; the matching parser is storyOf. */
export const storyInstruction = `Before "Decisions:", add a short section starting "Story:" so the owner can read this work without code, in plain language (no code, file paths, commit hashes or IDs):
Story:
Area: the product area, e.g. Business data
Concept: one or two sentences on what this is and why
Achieved:
- short bullets of what now works
How it works:
- short bullets of what a user sees and does
Next:
- what remains or should come next in this area`;

/** Text split into plain parts and links; links are shown by a short label, never the raw URL. */
export type RichPart = { text: string } | { text: string; href: string };
export function shortUrl(href: string) {
  try {
    const u = new URL(href);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/$/, "");
    const label = host === "github.com" ? path.split("/").filter(Boolean).slice(0, 2).join("/") || host : `${host}${path}`;
    return label.length > 40 ? `${label.slice(0, 39)}…` : label;
  } catch { return href.slice(0, 40); }
}
export function richParts(text: string): RichPart[] {
  const parts: RichPart[] = [];
  const re = /\[([^\]]{1,120})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')\]]+)/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > at) parts.push({ text: text.slice(at, m.index) });
    const href = (m[2] ?? m[3]).replace(/[.,;:]+$/, "");
    parts.push({ text: m[1] ?? shortUrl(href), href });
    at = m.index! + (m[1] ? m[0].length : href.length);
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}
