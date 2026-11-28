"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Bookmark, Check, EyeOff, MessageSquare, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { evidenceTime, type EvidenceUnit, type OutlineAnnotation, type OutlineTakeaway, type OutlineTopic } from "@/lib/studio/knowledge-outline";
import { useStudioCommand } from "../../../_components/use-studio-command";
import { DISCUSS_KNOWLEDGE_EVENT, DRAFT_FROM_FINDINGS_EVENT, useOptionalSourceWorkspace } from "../../../_components/source-workspace";

const endpoint = "/studio/knowledge/extractions/api";
const citationLabel = (type: EvidenceUnit["evidenceType"]) =>
  type === "ocr" ? "On-screen text" : type === "text" ? "Saved text" : "Speech";
type TriageMap = Record<string, "kept" | "hidden">;
type TriageState = "kept" | "hidden" | "clear";

function Comment({ outlineId, nodeKey, value, editable, label, children }: {
  outlineId: string; nodeKey: string; value?: OutlineAnnotation; editable?: boolean; label: string; children?: ReactNode;
}) {
  const router = useRouter();
  const editorId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [saved, setSaved] = useState(value);
  const [mode, setMode] = useState<"comment" | "heading" | null>(null);
  const [note, setNote] = useState(value?.note ?? "");
  const [title, setTitle] = useState(value?.title ?? "");
  const [summary, setSummary] = useState(value?.summary ?? "");
  const [message, setMessage] = useState("");
  const command = useStudioCommand(endpoint);

  function start() {
    setNote(saved?.note ?? ""); setTitle(saved?.title ?? ""); setSummary(saved?.summary ?? "");
    setMessage(""); setMode("comment");
  }
  function close() { setMode(null); trigger.current?.focus(); requestAnimationFrame(() => trigger.current?.focus()); }
  useEffect(() => { if (mode === "comment") field.current?.focus(); }, [mode]);
  useEffect(() => {
    if (value && value.version > (saved?.version ?? 0)) setSaved(value);
  }, [value, saved?.version]);

  async function save() {
    const result = await command.run({ action: "annotate", requestId: crypto.randomUUID(), outlineId, nodeKey,
      expectedVersion: saved?.version ?? 0, note, title, summary });
    if (result?.ok) {
      setSaved(result.data); setMessage(mode === "heading" ? "Heading saved." : note.trim() ? "Comment saved." : "Comment cleared.");
      close(); router.refresh();
    } else if (result?.status === 409) router.refresh();
  }

  return <div className="min-w-0 space-y-2">
    <div className="flex items-center gap-2">
      {children ? <div className="min-w-0 flex-1">{children}</div> : null}
      <Button ref={trigger} type="button" variant="ghost" size="icon" className="ml-auto h-11 w-11 shrink-0"
        aria-label={`${saved?.note ? "Edit comment" : "Comment"} on ${label}`}
        aria-expanded={mode !== null} aria-controls={mode ? editorId : undefined}
        title={saved?.note ? "Edit comment" : "Comment"} onClick={() => mode ? close() : start()} disabled={command.pending || command.retry}>
        <MessageSquare aria-hidden="true" className={`h-4 w-4 ${saved?.note ? "fill-primary/20 text-primary" : "text-muted-foreground"}`} />
      </Button>
    </div>
    {saved?.note ? <p className="whitespace-pre-wrap break-words border-l-2 border-primary/40 pl-3 text-sm"><span className="sr-only">Comment: </span>{saved.note}</p> : null}
    {mode ? <div id={editorId} className="space-y-2 rounded-lg border bg-muted/30 p-3" onKeyDown={e => {
      if (e.key === "Escape" && !command.pending && !command.retry) { e.stopPropagation(); close(); }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !command.pending) { e.preventDefault(); void save(); }
    }}>
      {mode === "heading" ? <>
        <label className="block text-sm">Display title<input value={title} maxLength={120}
          onChange={e => setTitle(e.target.value)} disabled={command.pending || command.retry}
          className="mt-1 block w-full rounded-md border bg-background p-2" /></label>
        <label className="block text-sm">Summary<textarea value={summary} maxLength={1200} rows={2}
          onChange={e => setSummary(e.target.value)} disabled={command.pending || command.retry}
          className="mt-1 block w-full rounded-md border bg-background p-2" /></label>
      </> : <label className="block text-sm">Comment<textarea ref={field} value={note} maxLength={2000} rows={2}
        onChange={e => setNote(e.target.value)} disabled={command.pending || command.retry}
        className="mt-1 block w-full rounded-md border bg-background p-2" /></label>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void save()} disabled={command.pending} className="min-h-11">
          {command.pending ? "Saving…" : command.retry ? "Retry save" : "Save"}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={close} disabled={command.pending || command.retry}>Cancel</Button>
        {editable && mode === "comment" ? <Button type="button" variant="ghost" className="min-h-11" disabled={command.pending || command.retry}
          onClick={() => setMode("heading")}>Edit heading</Button> : null}
      </div>
      {command.error ? <p role="alert" className="text-sm text-destructive">{command.error}</p> : null}
    </div> : null}
    {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
  </div>;
}

type ReviewControls = {
  outlineId: string; annotations: Record<string, OutlineAnnotation>; triage: TriageMap;
  busy: boolean; compact: boolean; discuss: boolean; change: (item: OutlineTakeaway, state: TriageState) => void;
};

function Takeaway({ item, controls, restore = false }: { item: OutlineTakeaway; controls: ReviewControls; restore?: boolean }) {
  const { outlineId, annotations, triage, busy, compact, discuss, change } = controls;
  const kept = triage[item.key] === "kept";
  const hasEvidence = Boolean(item.citations.length || item.alternateStatements?.length);
  const evidence = <div className="space-y-2 text-sm">{item.citations.map(citation => <blockquote key={`${citation.index}:${citation.quote}`} className="space-y-1 border-l-2 pl-3">
      <p className="whitespace-pre-wrap break-words">“{citation.quote}”</p>
      <Link className="text-primary underline" href={`/studio/knowledge/extractions/${outlineId}?passage=${citation.index}#unit-${citation.index}`}>
        {citationLabel(citation.type)} · {evidenceTime(citation.start, citation.end) ?? (citation.startChar === null ? "Source passage" : `Text offset ${citation.startChar}`)}
      </Link>
    </blockquote>)}
      {item.alternateStatements?.length ? <div className="space-y-1 text-muted-foreground">
        <p>Related wording from the extraction</p>
        <ul className="list-disc pl-5">{item.alternateStatements.map(variant => <li key={variant}>{variant}</li>)}</ul>
      </div> : null}
    </div>;
  return <article className={compact ? "min-w-0 space-y-1 py-2" : "min-w-0 space-y-2 py-3"}>
    <Comment outlineId={outlineId} nodeKey={item.key} value={annotations[item.key]} label={item.statement}>
      <p className="break-words font-medium">{item.statement}</p>
      {item.unverified ? <p className="mt-1 text-xs font-medium text-muted-foreground">Speaker claim · unverified</p> : null}
    </Comment>
    {compact && hasEvidence ? <details className="space-y-2">
      <summary className="cursor-pointer py-2 text-sm text-muted-foreground">Source evidence</summary>
      {evidence}
    </details> : !compact ? evidence : null}
    {item.applied ? <p className="text-sm"><Link className="text-primary underline" href={`/studio/knowledge/${item.applied.insightId}`}>Open in Knowledge</Link>{" · "}{item.applied.status}</p> : null}
    <div className="flex flex-wrap gap-2">
      {restore ? <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => change(item, "clear")}>
        <Undo2 aria-hidden="true" className="mr-2 h-4 w-4" />Restore
      </Button> : <>
        <Button type="button" variant={kept ? "secondary" : "outline"} className="min-h-11" aria-pressed={kept} disabled={busy} onClick={() => change(item, kept ? "clear" : "kept")}>
          {kept ? <Check aria-hidden="true" className="mr-2 h-4 w-4" /> : <Bookmark aria-hidden="true" className="mr-2 h-4 w-4" />}{kept ? "Kept" : "Keep"}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => change(item, "hidden")}>
          <EyeOff aria-hidden="true" className="mr-2 h-4 w-4" />Skip
        </Button>
      </>}
      {discuss ? <Button type="button" variant="ghost" size="sm" className="min-h-11" onClick={event => {
        window.dispatchEvent(new CustomEvent(DISCUSS_KNOWLEDGE_EVENT, { detail: {
          statement: item.statement, quote: item.citations[0]?.quote ?? "", origin: event.currentTarget,
        } }));
      }}>Discuss</Button> : null}
    </div>
  </article>;
}

function topicHasContent(topic: OutlineTopic, controls: ReviewControls): boolean {
  const annotation = controls.annotations[topic.key];
  return Boolean(annotation?.note || annotation?.summary || annotation?.title)
    || topic.takeaways.some(item => controls.triage[item.key] !== "hidden")
    || topic.branches.some(branch => topicHasContent(branch, controls));
}

function Topic({ topic, controls, section, depth = 0 }: {
  topic: OutlineTopic; controls: ReviewControls; section?: string; depth?: number;
}) {
  const value = controls.annotations[topic.key];
  const title = value?.title || topic.title;
  const items = topic.takeaways.filter(item => controls.triage[item.key] !== "hidden");
  const branches = topic.branches.filter(branch => topicHasContent(branch, controls));
  const showHeading = depth === 0 || Boolean(value?.title || value?.summary || value?.note);
  return <section id={section} tabIndex={section ? -1 : undefined} className={section ? "scroll-mt-3 space-y-2" : "space-y-1"}>
    {showHeading ? <Comment outlineId={controls.outlineId} nodeKey={topic.key} value={value} editable label={title}>
      {depth === 0 ? <h3 className="break-words font-semibold">{title}</h3> : <h4 className="break-words text-sm font-medium">{title}</h4>}
      {value?.summary ? <p className="whitespace-pre-wrap break-words text-sm">{value.summary}</p> : null}
    </Comment> : null}
    {items.length ? <div className="divide-y border-t">{items.map(item => <Takeaway key={item.key} item={item} controls={controls} />)}</div> : null}
    {branches.map(branch => <Topic key={branch.key} topic={branch} controls={controls} depth={depth + 1} />)}
  </section>;
}

export function OutlineTopics({ outlineId, sourceId, topics, allTakeaways, featured, curated, annotations, initialTriage, canApprove, compact = false }: {
  outlineId: string; sourceId: string; topics: OutlineTopic[]; allTakeaways: OutlineTakeaway[];
  featured: Array<{ title: string; items: OutlineTakeaway[] }>; curated: boolean;
  annotations: Record<string, OutlineAnnotation>; initialTriage: TriageMap; canApprove: boolean; compact?: boolean;
}) {
  const router = useRouter();
  const workspace = useOptionalSourceWorkspace();
  const approval = useStudioCommand(endpoint);
  const privateCommand = useStudioCommand(endpoint);
  const [triage, setTriage] = useState(initialTriage);
  const [filter, setFilter] = useState<"suggested" | "all" | "kept" | "hidden">("suggested");
  const [undo, setUndo] = useState<{ item: OutlineTakeaway; state: TriageState } | null>(null);
  const [message, setMessage] = useState("");
  const [retryTriage, setRetryTriage] = useState<{ item: OutlineTakeaway; state: TriageState } | null>(null);
  const [recentlyApplied, setRecentlyApplied] = useState<string[]>([]);
  const undoButton = useRef<HTMLButtonElement>(null);
  const overview = annotations.overview;
  const topicJumpId = useId();
  const kept = allTakeaways.filter(item => triage[item.key] === "kept");
  const hidden = allTakeaways.filter(item => triage[item.key] === "hidden");
  const approvable = kept.filter(item => !item.applied && !recentlyApplied.includes(item.key));
  const references = kept.flatMap(item => item.references);
  const busy = approval.pending || approval.retry || privateCommand.pending || privateCommand.retry;
  const view = filter === "suggested" && !featured.length ? "all" : filter;
  const groups = featured.map(g => ({ ...g, items: g.items.filter(item => triage[item.key] !== "hidden") })).filter(g => g.items.length);

  async function change(item: OutlineTakeaway, state: TriageState) {
    const prior = triage[item.key] ?? "clear";
    setRetryTriage({ item, state });
    const result = await privateCommand.run({ action: "triage", requestId: crypto.randomUUID(), outlineId, nodeKey: item.key, state });
    if (!result?.ok) return;
    setTriage(current => {
      const next = { ...current };
      if (state === "clear") delete next[item.key]; else next[item.key] = state;
      return next;
    });
    setRetryTriage(null); setUndo(state === "hidden" ? { item, state: prior } : null);
    setMessage(state === "hidden" ? "Takeaway skipped privately." : state === "kept" ? "Takeaway kept privately." : "Takeaway restored to review.");
    if (state === "hidden") requestAnimationFrame(() => undoButton.current?.focus());
  }

  async function approve() {
    const result = await approval.run({ action: "approve", requestId: crypto.randomUUID(), outlineId,
      selections: approvable.map(item => item.selection), confirmApproval: true });
    if (result?.ok) {
      const outcomes = result.data.findings as Array<{ decision: "approved" | "existing" }>;
      const approved = outcomes.filter(item => item.decision === "approved").length;
      setRecentlyApplied(previous => [...previous, ...approvable.map(item => item.key)]);
      setMessage(`${approved} added to Knowledge.${outcomes.length > approved ? " Existing decisions preserved." : ""}`);
      router.refresh();
    } else if (result?.status === 409) router.refresh();
  }

  const controls = { outlineId, annotations, triage, busy, compact, discuss: Boolean(workspace), change };
  const readingTopics = topics.filter(topic => topicHasContent(topic, controls));
  const reviewNotes = <Comment outlineId={outlineId} nodeKey="overview" value={overview} editable label="review overview">
      <h2 className="font-semibold">{overview?.title || "Review notes"}</h2>
      {overview?.summary ? <p className="whitespace-pre-wrap break-words text-sm">{overview.summary}</p> : null}
    </Comment>;
  return <div className={compact ? "space-y-2" : "space-y-4"}>
    {compact ? <details>
      <summary className="cursor-pointer py-2 text-sm text-muted-foreground">{overview?.title || "Review notes"}</summary>
      {reviewNotes}
    </details> : reviewNotes}
    {allTakeaways.length ? <div className="flex flex-wrap gap-2" role="group" aria-label="Filter takeaways">
      {featured.length ? <Button type="button" variant={view === "suggested" ? "secondary" : "ghost"} aria-pressed={view === "suggested"} className="min-h-11" onClick={() => setFilter("suggested")}>Suggested</Button> : null}
      <Button type="button" variant={view === "all" ? "secondary" : "ghost"} aria-pressed={view === "all"} className="min-h-11" onClick={() => setFilter("all")}>All takeaways</Button>
      <Button type="button" variant={filter === "kept" ? "secondary" : "ghost"} aria-pressed={filter === "kept"} className="min-h-11" onClick={() => setFilter("kept")}>Kept ({kept.length})</Button>
      <Button type="button" variant={filter === "hidden" ? "secondary" : "ghost"} aria-pressed={filter === "hidden"} className="min-h-11" onClick={() => setFilter("hidden")}>Skipped ({hidden.length})</Button>
    </div> : null}
    <div className="flex flex-wrap items-center gap-2 text-sm empty:hidden" role="status">
      {message ? <p>{message}</p> : null}
      {undo ? <Button ref={undoButton} type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => void change(undo.item, undo.state)}>Undo skip</Button> : null}
      {privateCommand.retry && retryTriage ? <Button variant="outline" type="button" onClick={() => void change(retryTriage.item, retryTriage.state)}>Retry triage</Button> : null}
      {privateCommand.error || approval.error ? <p role="alert" className="text-destructive">{privateCommand.error || approval.error}</p> : null}
    </div>
    {canApprove && kept.length ? <section aria-label="Actions for kept takeaways" className="space-y-2 rounded-lg border p-3">
      <p className="text-sm text-muted-foreground">Kept takeaways are private. Approval adds selected proposals to Knowledge.</p>
      <div className="flex flex-wrap gap-2">
        {workspace ? <Button type="button" className="min-h-11" disabled={busy || references.length > 50} onClick={event => {
          workspace.setFindingSelection({ outlineId, selections: references });
          window.dispatchEvent(new CustomEvent(DRAFT_FROM_FINDINGS_EVENT, { detail: event.currentTarget }));
        }}>Draft linked idea</Button> : <Link className="inline-flex min-h-11 items-center text-primary underline" href={`/studio/library/${sourceId}?knowledgeReview=${outlineId}#knowledge`}>Draft in source workspace</Link>}
        <Button type="button" variant="outline" className="min-h-11" disabled={approval.pending || privateCommand.pending || privateCommand.retry || (!approval.retry && (!approvable.length || approvable.length > 50))}
          onClick={() => void approve()}>{approval.pending ? "Approving…" : approval.retry ? "Retry approval" : "Approve selected"}</Button>
      </div>
      {references.length > 50 ? <p className="text-sm">Keep fewer citations to draft in one request.</p> : null}
    </section> : null}
    {view === "suggested" ? <section aria-label="Suggested takeaways" className={compact ? "space-y-3" : "space-y-5"}>
      {groups.length ? groups.map(group => <section key={group.title}>
        <h3 className="break-words pb-2 text-sm font-semibold">{group.title}</h3>
        <div className="divide-y border-t">{group.items.map(item => <Takeaway key={item.key} item={item} controls={controls} />)}</div>
      </section>) : <p className="text-sm text-muted-foreground">All suggested takeaways are skipped. Other findings are in All takeaways.</p>}
    </section> : view === "all" ? <section aria-label="All takeaways" className={compact ? "space-y-3" : "space-y-5"}>
      {!curated && allTakeaways.length ? <p className="text-sm text-muted-foreground">Earlier extraction. Takeaways are grouped by topic.</p> : null}
      {readingTopics.length > 1 ? <label className="flex flex-wrap items-center gap-2 text-sm">
        Jump to topic
        <select className="min-h-11 min-w-0 max-w-full rounded-md border bg-background px-3" value="" onChange={event => {
          const target = document.getElementById(event.target.value);
          target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: "start" });
        }}>
          <option value="">Choose a topic</option>
          {readingTopics.map((topic, index) => <option key={topic.key} value={`${topicJumpId}-${index}`}>{annotations[topic.key]?.title || topic.title}</option>)}
        </select>
      </label> : null}
      {readingTopics.length ? readingTopics.map((topic, index) => <Topic key={topic.key} topic={topic} controls={controls} section={`${topicJumpId}-${index}`} />)
        : <p className="text-sm text-muted-foreground">{allTakeaways.length ? "All takeaways are skipped." : "No takeaways were proposed in the processed passages."}</p>}
    </section> : (view === "kept" ? kept : hidden).length ? <section aria-label={view === "kept" ? "Kept takeaways" : "Skipped takeaways"} className="divide-y border-y">
      {(view === "kept" ? kept : hidden).map(item => <Takeaway key={item.key} item={item} controls={controls} restore={view === "hidden"} />)}
    </section> : <p className="text-sm text-muted-foreground">{view === "kept" ? "No kept takeaways yet." : "No skipped takeaways."}</p>}

  </div>;
}

export function TranscriptPassage({ outlineId, unit, note, focused }: {
  outlineId: string; unit: EvidenceUnit; note?: OutlineAnnotation; focused: boolean;
}) {
  const label = `${citationLabel(unit.evidenceType)} · ${evidenceTime(unit.startSeconds, unit.endSeconds) ??
    (unit.startChar === null ? `Passage ${unit.unitIndex + 1}` : `Characters ${unit.startChar}–${unit.endChar}`)}`;
  return <article id={`unit-${unit.unitIndex}`} className={`scroll-mt-3 rounded-md p-3 ${focused ? "border border-primary bg-muted" : "border-b"}`}>
    <Comment outlineId={outlineId} nodeKey={`unit:${unit.unitIndex}`} value={note} label={label}>
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{unit.text}</p>
    </Comment>
  </article>;
}

export function RefreshKnowledgeOutline() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) router.refresh(); }, 7000);
    return () => clearInterval(timer);
  }, [router]);
  return <button type="button" className="text-primary underline" onClick={() => router.refresh()}>Refresh</button>;
}
