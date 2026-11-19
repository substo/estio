/** Pure rules for the single-source assistant. No provider call happens here: notes and idea drafts are the user's own words. */
export const SOURCE_NOTES_LIMIT = 20_000;
export const REACTION_LIMIT = 4_000;
export const IDEA_TITLE_LIMIT = 180;

export type NoteResult = { ok: true; value: string } | { ok: false; error: string };

/** Appends a dated entry to My notes. Existing notes are never rewritten or dropped. */
export function appendSourceNote(existing: unknown, addition: string, now = new Date()): NoteResult {
  const text = addition.trim();
  if (!text) return { ok: false, error: "Write or dictate a reaction before saving it." };
  if (text.length > REACTION_LIMIT) return { ok: false, error: `Keep each saved note under ${REACTION_LIMIT.toLocaleString()} characters.` };
  const previous = typeof existing === "string" ? existing.trimEnd() : "";
  const entry = `[${now.toISOString().slice(0, 10)}] ${text}`;
  const value = previous ? `${previous}\n\n${entry}` : entry;
  if (value.length > SOURCE_NOTES_LIMIT) return { ok: false, error: "My notes are full for this source. Open Edit source to tidy them, then save again." };
  return { ok: true, value };
}

/** A deterministic starting point for a linked idea, assembled from the user's words. Always shown for editing. */
export function draftIdeaFromReactions(sourceTitle: string, reactions: readonly string[]) {
  const spoken = reactions.map(item => item.trim()).filter(Boolean);
  const first = (spoken[0] ?? "").split(/(?<=[.!?])\s|\n/)[0]?.trim() ?? "";
  const clipped = first.length > 80 ? `${first.slice(0, 79).trimEnd()}…` : first;
  const fallback = `Idea from ${sourceTitle}`.slice(0, IDEA_TITLE_LIMIT);
  return { title: clipped || fallback, summary: spoken.join("\n\n").slice(0, 20_000) };
}

/** The phrase handed to the existing related-video search when the user asks for more like this. */
export function relatedSearchPhrase(reactions: readonly string[], sourceTitle: string) {
  const latest = [...reactions].reverse().find(item => item.trim());
  const base = (latest ?? "").replace(/\s+/g, " ").trim();
  return (base.length >= 8 ? base : sourceTitle).slice(0, 160);
}
