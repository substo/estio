/** Highlights the owner marks on a Source, and how they reach the in-app agent. Pure: shared by the page, the routes and the agent. */
export const HIGHLIGHT_KINDS = ["summary", "description", "transcript", "slide", "comment"] as const;
export type HighlightKind = typeof HIGHLIGHT_KINDS[number];
export interface SourceHighlight { kind: HighlightKind; key: string; excerpt: string; at: number | null }
export const highlightId = (kind: string, key: string) => `${kind}:${key}`;
const clock = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(Math.floor(s % 60)).padStart(2, "0")}`; };
const names: Record<HighlightKind, string> = { summary: "Summary", description: "Description", transcript: "Transcript", slide: "Slide", comment: "Comment" };
export const highlightLabel = (h: Pick<SourceHighlight, "kind" | "at">) => `${names[h.kind]}${h.at === null ? "" : ` ${clock(h.at)}`}`;

export const HIGHLIGHT_MARK = "\n\n[Highlighted by the user in this source]\n";
/** Appends the highlights to a message for the agent, never exceeding `limit` characters (the message itself is never cut). */
export function withHighlights(message: string, highlights: SourceHighlight[], limit: number): string {
  if (!message.trim()) return message;
  let out = ""; const room = limit - message.length - HIGHLIGHT_MARK.length;
  for (const h of highlights) {
    const line = `- ${highlightLabel(h)}: "${h.excerpt.replace(/\s+/g, " ").slice(0, 240)}"\n`;
    if (out.length + line.length > room) break;
    out += line;
  }
  return out ? `${message}${HIGHLIGHT_MARK}${out.trimEnd()}` : message;
}
/** The owner's own words only: the highlight block is context for the agent, not part of what they typed. */
export const stripHighlights = (message: string) => { const at = message.indexOf(HIGHLIGHT_MARK); return at < 0 ? message : message.slice(0, at); };

export const splitSentences = (text: string) => (text.replace(/\s+/g, " ").trim().match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? []).map(s => s.trim()).filter(Boolean);
export const splitParagraphs = (text: string) => text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
/** A short stable key for free text (sentences, paragraphs): same text, same key. */
export function textKey(text: string): string {
  let h = 5381; for (const ch of text.trim()) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0;
  return h.toString(36);
}

export interface SummaryView { state: "none" | "ready" | "generating" | "failed"; status: string; text: string; basis: string | null; request: "request" | "retry" | null }
/** What the Summary section shows, and whether the page should ask for a (new) summary by itself. A failure is shown with a retry, never retried in a loop. */
export function summaryView(payload: Record<string, unknown>, hasTranscript: boolean, hasDescription: boolean): SummaryView {
  const str = (k: string) => typeof payload[k] === "string" ? payload[k] as string : "";
  const text = str("aiSummary"), status = str("summaryStatus"), basisKey = str("summaryBasis");
  const basis = !text ? null : basisKey === "transcript" ? "Based on the saved transcript (first 20,000 characters) and description." : basisKey === "description" ? "Based on the description only; the video was not watched." : null;
  const view = (state: SummaryView["state"], request: SummaryView["request"]): SummaryView => ({ state, status, text, basis, request });
  if (["queued", "waiting_for_device", "waiting_for_capacity"].includes(status)) return view("generating", null);
  if (["failed", "uncertain"].includes(status)) return view("failed", null);
  if (!hasTranscript && !hasDescription) return view("none", null);
  if (status === "stale") return view("none", "retry");
  if (text) return view("ready", hasTranscript && basisKey !== "transcript" ? "request" : null);
  return view("none", "request");
}
