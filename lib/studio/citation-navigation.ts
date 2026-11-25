import { recordLinkId } from "./record-link-policy";

export type ProposalFocus = { turnId: string; index: number };

export function readProposalFocus(turnId: unknown, index: unknown): ProposalFocus | null {
  if (typeof turnId !== "string" || !recordLinkId(turnId) || typeof index !== "string" || !/^[0-2]$/.test(index)) return null;
  return { turnId: turnId.toLowerCase(), index: Number(index) };
}

export function proposalFocusQuery(focus: ProposalFocus) {
  return new URLSearchParams({ proposalTurn: focus.turnId, proposalIndex: String(focus.index) });
}

export function proposalAnchor(focus: ProposalFocus) {
  return `proposal-${focus.turnId}-${focus.index}`;
}

export function agentCitationHref(sourceId: string, focus: ProposalFocus, itemId: string) {
  const query = new URLSearchParams({ citationTurn: focus.turnId, citationProposal: String(focus.index), citationItem: itemId });
  return `/studio/library/${sourceId}?${query}#transcript`;
}

export function knowledgeCitationHref(sourceId: string, evidenceId: string) {
  return `/studio/library/${sourceId}?citationEvidence=${encodeURIComponent(evidenceId)}#transcript`;
}

export function citedQuote(id: string, text: string) {
  if (!id.startsWith("f:")) return text;
  const marker = "Exact saved quote: “";
  const start = text.lastIndexOf(marker);
  return start >= 0 && text.endsWith("”") ? text.slice(start + marker.length, -1) : text;
}

export function recordedTranscriptOffset(sourceId: string, itemId: string) {
  const prefix = `${sourceId.slice(0, 8)}:`;
  if (!itemId.startsWith(prefix)) return null;
  const value = itemId.slice(prefix.length);
  return /^\d{1,6}$/.test(value) ? Number(value) : null;
}

/** Highlight only the recorded occurrence or a unique exact match in the currently saved transcript. */
export function transcriptPassage(transcript: string, quote: string, offset: number | null) {
  if (!quote.trim()) return null;
  // The source-read SQL uses btrim (ASCII spaces) before the assistant records its UTF-16 offset.
  const readText = transcript.replace(/^ +/, "");
  const leadingSpaces = transcript.length - readText.length;
  let at = offset !== null && readText.startsWith(quote, offset) ? offset + leadingSpaces : -1;
  if (at < 0) {
    at = transcript.indexOf(quote);
    if (at < 0 || transcript.indexOf(quote, at + 1) >= 0) return null;
  }
  const end = at + quote.length;
  const from = Math.max(0, at - 180), to = Math.min(transcript.length, end + 180);
  return { before: (from > 0 ? "…" : "") + transcript.slice(from, at),
    quote: transcript.slice(at, end), after: transcript.slice(end, to) + (to < transcript.length ? "…" : "") };
}
