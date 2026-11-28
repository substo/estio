"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Star, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { highlightId, highlightLabel, splitParagraphs, splitSentences, textKey, type HighlightKind, type SourceHighlight, type SummaryView } from "@/lib/studio/source-highlights";
import { sourceDetailsCount, type SourceDetailsRow, type SourceDetailsState } from "@/lib/studio/source-details-policy";
import type { SourceComment, SourceMeta } from "@/lib/studio/youtube-source-meta";
import { OPEN_TAB_EVENT } from "./source-tabs";

const OPEN_SECTION_EVENT = "studio:open-section";
const clock = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(Math.floor(s % 60)).padStart(2, "0")}`; };
const number = (n: number | null) => n === null ? null : n.toLocaleString("en-GB");

/* ---------- Highlights: one list per source, saved as soon as an item is starred. ---------- */
interface HighlightApi { items: SourceHighlight[]; has: (kind: HighlightKind, key: string) => boolean; toggle: (item: SourceHighlight) => void; error: string }
const Highlights = createContext<HighlightApi | null>(null);
export const useHighlights = () => useContext(Highlights);
export function HighlightsProvider({ locationId, recordId, initial, children }: { locationId: string; recordId: string; initial: SourceHighlight[]; children: React.ReactNode }) {
  const [items, setItems] = useState(initial); const [error, setError] = useState("");
  const has = useCallback((kind: HighlightKind, key: string) => items.some(i => i.kind === kind && i.key === key), [items]);
  const toggle = useCallback((item: SourceHighlight) => {
    const on = !items.some(i => i.kind === item.kind && i.key === item.key);
    setError(""); setItems(list => on ? [...list, item] : list.filter(i => !(i.kind === item.kind && i.key === item.key)));
    void fetch("/api/studio/library/source", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Tenant": locationId },
      body: JSON.stringify({ action: "highlight", recordId, kind: item.kind, key: item.key, excerpt: item.excerpt.slice(0, 600), at: item.at }) })
      .then(async response => { if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Try again."); })
      .catch(e => { setError(e instanceof Error ? e.message : "Could not save the highlight."); setItems(list => on ? list.filter(i => !(i.kind === item.kind && i.key === item.key)) : [...list, item]); });
  }, [items, locationId, recordId]);
  return <Highlights.Provider value={{ items, has, toggle, error }}>{children}</Highlights.Provider>;
}
export function StarButton({ kind, id, excerpt, at = null, label }: { kind: HighlightKind; id: string; excerpt: string; at?: number | null; label: string }) {
  const api = useHighlights(); if (!api) return null;
  const on = api.has(kind, id);
  return <button type="button" aria-pressed={on} aria-label={`${on ? "Remove highlight from" : "Highlight"} ${label}`} title={on ? "Highlighted for the assistant" : "Highlight for the assistant"}
    onClick={() => api.toggle({ kind, key: id, excerpt, at })} className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md align-middle transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${on ? "text-amber-500" : "text-muted-foreground/60 hover:text-foreground"}`}>
    <Star aria-hidden="true" className={`h-4 w-4 ${on ? "fill-current" : ""}`} /></button>;
}
const ref = (kind: HighlightKind, key: string) => highlightId(kind, key);

/* ---------- Layout: collapsible sections and the jump bar. ---------- */
export function Section({ id, title, count, defaultOpen = true, action, children }: { id: string; title: string; count?: string; defaultOpen?: boolean; action?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { const on = (e: Event) => { if ((e as CustomEvent<string>).detail === id) setOpen(true); }; window.addEventListener(OPEN_SECTION_EVENT, on); return () => window.removeEventListener(OPEN_SECTION_EVENT, on); }, [id]);
  return <section id={`sec-${id}`} aria-label={title} tabIndex={-1} className="scroll-mt-14 space-y-3 rounded-xl border bg-card p-3 md:p-4">
    <div className="flex items-center gap-2">
      <button type="button" aria-expanded={open} aria-controls={`sec-${id}-body`} onClick={() => setOpen(v => !v)} className="flex min-h-9 flex-1 items-center gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${open ? "" : "-rotate-90"}`} />
        <h2 className="font-semibold">{title}</h2>{count ? <span className="rounded-full bg-muted px-2 text-xs tabular-nums text-muted-foreground">{count}</span> : null}
        <span className="sr-only">{open ? "Hide" : "Show"}</span></button>
      {open ? action : null}
    </div>
    <div id={`sec-${id}-body`} hidden={!open} className="space-y-3">{children}</div>
  </section>;
}
export function jumpTo(id: string, tab?: string) {
  if (tab) window.dispatchEvent(new CustomEvent(OPEN_TAB_EVENT, { detail: tab }));
  window.dispatchEvent(new CustomEvent(OPEN_SECTION_EVENT, { detail: id }));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const section = document.getElementById(`sec-${id}`);
    section?.focus({ preventScroll: true });
    section?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }));
}
export function JumpBar({ items }: { items: Array<{ id: string; label: string; tab?: string }> }) {
  return <nav aria-label="Jump to a section" className="sticky top-0 z-20 min-w-0 border-b bg-background">
    <div className="flex gap-0.5 overflow-x-auto py-0.5 md:gap-1">{items.map(item => <a key={item.id} href={`#sec-${item.id}`} onClick={event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      jumpTo(item.id, item.tab);
      history.replaceState(null, "", `#sec-${item.id}`);
    }} className="inline-flex min-h-11 shrink-0 items-center rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary md:px-3">{item.label}</a>)}</div>
  </nav>;
}

/* ---------- Summary: made on the owner's Mac from the transcript, without a button. ---------- */
const generating: Record<string, string> = { queued: "Writing the summary on your Mac…", waiting_for_device: "Waiting for your Mac to pick this up. It needs to be online with Text work on in Mac Setup.", waiting_for_capacity: "Waiting for a signed-in subscription on your Mac with capacity." };
export function SummarySection({ locationId, recordId, view, failure, evidence }: { locationId: string; recordId: string; view: SummaryView; failure: string | null; evidence: string }) {
  const router = useRouter(); const asked = useRef(""); const [pending, setPending] = useState(false); const [error, setError] = useState("");
  const request = useCallback(async (retry: boolean) => {
    setPending(true); setError("");
    try {
      const response = await fetch("/api/studio/library/source", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Tenant": locationId }, body: JSON.stringify({ action: "summary", recordId, ...(retry ? { retry: true } : {}) }) });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || "Try again.");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not connect. Retry."); } finally { setPending(false); }
  }, [locationId, recordId, router]);
  // Once per change of evidence (a transcript arriving, a description): ask for the summary. A failed one is never re-asked by itself.
  useEffect(() => { const signature = `${view.request}:${evidence}`; if (!view.request || asked.current === signature) return; asked.current = signature; void request(view.request === "retry"); }, [view.request, evidence, request]);
  useEffect(() => { if (view.state !== "generating") return; const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 5000); return () => clearInterval(t); }, [view.state, router]);
  const busy = pending || view.state === "generating";
  const reason = error || (view.state === "failed" ? failure || "The summary could not be made on your Mac." : "");
  return <Section id="summary" title="Summary" action={view.text && !busy ? <Button type="button" size="sm" variant="ghost" onClick={() => void request(true)}>Update</Button> : null}>
    {view.text ? <><p className="break-words text-sm leading-relaxed">{splitSentences(view.text).map((sentence, i) => <span key={i}>{sentence}<StarButton kind="summary" id={textKey(sentence)} excerpt={sentence} label="this summary sentence" />{" "}</span>)}</p>
      {view.basis ? <p className="text-xs text-muted-foreground">{view.basis}</p> : null}</> : null}
    {busy ? <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />{pending && view.state !== "generating" ? "Asking your Mac for a summary…" : generating[view.status] ?? "Writing the summary…"}</p> : null}
    {reason && !busy ? <div role="alert" className="flex flex-wrap items-start gap-2 rounded-md border border-destructive/40 p-3 text-sm"><TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1 break-words">The summary could not be made: {reason.replace(/\.+$/, "")}.</p><Button type="button" size="sm" variant="outline" onClick={() => void request(true)}>Retry</Button></div> : null}
    {!view.text && !busy && !reason ? <p className="text-sm text-muted-foreground">{view.state === "none" && !view.request ? "A summary is written automatically once this source has a transcript or description." : "No summary yet."}</p> : null}
  </Section>;
}

/* ---------- Details: everything YouTube reported. ---------- */
export function DetailsSection({ meta, description, channelUrl, channel, action, status }: { meta: Omit<SourceMeta, "comments" | "commentsError"> | null; description: string; channelUrl: string | null; channel: string | null; action?: React.ReactNode; status?: React.ReactNode }) {
  const [more, setMore] = useState(false);
  const paragraphs = splitParagraphs(description); const long = description.length > 700;
  const facts: Array<[string, React.ReactNode]> = [
    ["Channel", (meta?.channel || channel) ? (channelUrl ? <a href={channelUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{meta?.channel || channel}</a> : meta?.channel || channel) : null],
    ["Published", meta?.uploadDate ? new Date(`${meta.uploadDate}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null],
    ["Length", meta?.duration ? clock(meta.duration) : null], ["Views", number(meta?.viewCount ?? null)], ["Likes", number(meta?.likeCount ?? null)], ["Comments", number(meta?.commentCount ?? null)],
  ];
  return <Section id="details" title="Details" action={action}>
    {status}
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">{facts.filter(([, v]) => v).map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="break-words font-medium">{v}</dd></div>)}</dl>
    {meta?.title ? <p className="text-sm font-medium break-words">{meta.title}</p> : null}
    {meta?.thumbnail && /^https:\/\/i\.ytimg\.com\//.test(meta.thumbnail) ? <a href={meta.thumbnail} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-primary hover:underline">Open YouTube thumbnail</a> : null}
    {meta?.tags.length ? <ul aria-label="Tags" className="flex flex-wrap gap-1.5">{meta.tags.map(t => <li key={t} className="rounded-full bg-muted px-2 py-0.5 text-xs">{t}</li>)}</ul> : null}
    {meta?.chapters.length ? <div><h3 className="text-xs font-medium text-muted-foreground">Chapters</h3><ol className="mt-1 space-y-0.5 text-sm">{meta.chapters.map(c => <li key={c.start} className="flex gap-3"><span className="w-12 shrink-0 tabular-nums text-muted-foreground">{clock(c.start)}</span><span className="break-words">{c.title}</span></li>)}</ol></div> : null}
    <div><h3 className="text-xs font-medium text-muted-foreground">Description</h3>
      {paragraphs.length ? <div className={`mt-1 space-y-2 ${long && !more ? "max-h-40 overflow-hidden" : ""}`}>{paragraphs.map(p => <p key={textKey(p)} className="whitespace-pre-wrap break-words text-sm leading-relaxed">{p}<StarButton kind="description" id={textKey(p)} excerpt={p} label="this part of the description" /></p>)}</div> : <p className="text-sm text-muted-foreground">No description saved.</p>}
      {long ? <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={() => setMore(v => !v)}>{more ? "Show less" : "Show all"}</Button> : null}</div>
  </Section>;
}

function Comment({ comment }: { comment: SourceComment & { published?: string | null } }) {
  return <div className="flex items-start gap-2 text-sm"><div className="min-w-0 flex-1">
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{comment.author}</span>
      {comment.byUploader ? <span className="rounded bg-muted px-1.5">Creator</span> : null}
      {comment.pinned ? <span className="rounded bg-muted px-1.5">Pinned</span> : null}
      {comment.likes !== null ? <span>{number(comment.likes)} {comment.likes === 1 ? "like" : "likes"}</span> : null}
      {comment.replies !== null ? <span>{number(comment.replies)} {comment.replies === 1 ? "reply" : "replies"}</span> : null}
      {comment.published ?? (comment.at ? new Date(comment.at * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null)}</p>
    <p className="mt-0.5 whitespace-pre-wrap break-words leading-relaxed">{comment.text}</p></div>
    <StarButton kind="comment" id={textKey(`${comment.author}${comment.text}`)} excerpt={`${comment.author}: ${comment.text}`} label={`the comment by ${comment.author}`} />
  </div>;
}

export function CommentsSection({ meta, mac, details }: { meta: SourceMeta | null; mac: boolean; details: SourceDetailsState | null }) {
  const [visible, setVisible] = useState(8);
  const live = details?.status === "queued" || details?.status === "running";
  const saved = details?.rows ?? [];
  const browserRows = saved.length > 0 || details?.outcome === "reached_end";
  const topLevel = browserRows ? saved.filter(row => !row.parentId) : (meta?.comments ?? []);
  const replies = new Map<string, SourceDetailsRow[]>();
  for (const row of saved) {
    if (row.parentId) replies.set(row.parentId, [...(replies.get(row.parentId) ?? []), row]);
  }
  const total = details?.meta?.commentCount ?? meta?.commentCount;
  const loaded = live || browserRows ? `${sourceDetailsCount(details?.fetchedComments ?? 0, details?.fetchedReplies ?? 0)} loaded` : null;
  const status = details?.error ?? details?.reason;
  return <Section id="comments" title="Comments" count={total != null ? `${number(total)} on YouTube` : topLevel.length ? String(topLevel.length) : undefined}>
    {loaded ? <p className="text-sm tabular-nums text-muted-foreground">{loaded}{live ? " · fetch in progress" : ""}</p> : null}
    {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
    {!topLevel.length && !status && !live ? <p className="text-sm text-muted-foreground">{meta?.commentsError ?? (mac ? "Use Fetch details to load comments and replies from YouTube." : "Comments are available for YouTube sources.")}</p> : null}
    {topLevel.length ? <ul className="divide-y">
      {topLevel.slice(0, visible).map((comment, i) => {
        const thread = "id" in comment ? replies.get(comment.id as string) : undefined;
        return <li key={"id" in comment ? String(comment.id) : i} className="py-3 first:pt-0">
          <Comment comment={comment} />
          {thread?.length ? <details className="ml-3 mt-2 border-l pl-3">
            <summary className="cursor-pointer text-sm font-medium text-primary">{thread.length} saved {thread.length === 1 ? "reply" : "replies"}</summary>
            <ul className="mt-2 space-y-3">{thread.map(reply => <li key={reply.id}><Comment comment={reply} /></li>)}</ul>
          </details> : null}
        </li>;
      })}
    </ul> : null}
    {topLevel.length > visible ? <Button type="button" size="sm" variant="outline" onClick={() => setVisible(n => n + 12)}>Show more comments</Button> : null}
  </Section>;
}

/* ---------- The list of everything starred, shown once something is. ---------- */
export function HighlightsSection() {
  const api = useHighlights(); if (!api || (!api.items.length && !api.error)) return null;
  return <Section id="highlights" title="Highlights" count={String(api.items.length)}>
    <p className="text-xs text-muted-foreground">The assistant sees these when you message it about this source.</p>
    {api.error ? <p role="alert" className="text-sm text-destructive">{api.error}</p> : null}
    <ul className="space-y-1.5">{api.items.map(h => <li key={ref(h.kind, h.key)} className="flex items-start gap-2 text-sm"><StarButton kind={h.kind} id={h.key} excerpt={h.excerpt} at={h.at} label={highlightLabel(h)} />
      <p className="min-w-0 break-words"><span className="font-medium">{highlightLabel(h)}</span> <span className="text-muted-foreground">{h.excerpt}</span></p></li>)}</ul>
  </Section>;
}
