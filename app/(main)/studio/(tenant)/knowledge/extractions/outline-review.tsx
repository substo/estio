"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { evidenceTime, type EvidenceUnit, type OutlineAnnotation, type OutlineTakeaway, type OutlineTopic } from "@/lib/studio/knowledge-outline";
import { useStudioCommand } from "../../../_components/use-studio-command";

const endpoint = "/studio/knowledge/extractions/api";
const citationLabel = (type: EvidenceUnit["evidenceType"]) =>
  type === "ocr" ? "On-screen text" : type === "text" ? "Saved text" : "Speech";

function Annotation({ outlineId, nodeKey, value, editable, label }: {
  outlineId: string; nodeKey: string; value?: OutlineAnnotation; editable?: boolean; label: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState(value?.note ?? "");
  const [title, setTitle] = useState(value?.title ?? "");
  const [summary, setSummary] = useState(value?.summary ?? "");
  const [saved, setSaved] = useState(false);
  const command = useStudioCommand(endpoint);
  return <div className="space-y-2">
    {value?.note ? <p className="whitespace-pre-wrap break-words border-l-2 border-accent pl-3 text-sm"><strong>Note</strong><br />{value.note}</p> : null}
    <details className="text-sm">
      <summary className="w-fit cursor-pointer text-primary underline">{editable ? "Edit summary or note" : value?.note ? "Edit note" : "Add a note"}</summary>
      <form className="mt-2 space-y-2" onSubmit={async event => {
        event.preventDefault();
        setSaved(false);
        const result = await command.run({ action: "annotate", requestId: crypto.randomUUID(), outlineId, nodeKey,
          expectedVersion: value?.version ?? 0, note, title, summary });
        if (result?.ok) { setSaved(true); router.refresh(); }
      }}>
        <fieldset className="space-y-2" disabled={command.pending || command.retry || saved}>
          {editable ? <>
            <label className="block">Display title
              <input value={title} maxLength={120} placeholder={label} onChange={e => setTitle(e.target.value)}
                className="mt-1 block w-full rounded-md border bg-background p-2" />
            </label>
            <label className="block">Summary
              <textarea value={summary} maxLength={1200} rows={2} onChange={e => setSummary(e.target.value)}
                className="mt-1 block w-full rounded-md border bg-background p-2" />
            </label>
          </> : null}
          <label className="block">Note
            <textarea value={note} maxLength={2000} rows={2} onChange={e => setNote(e.target.value)}
              className="mt-1 block w-full rounded-md border bg-background p-2" />
          </label>
        </fieldset>
        <button type="submit" disabled={command.pending || saved} className="rounded-md border px-3 py-1.5 disabled:opacity-50">
          {command.pending ? "Saving…" : command.retry ? "Retry save" : "Save changes"}
        </button>
        {command.error ? <p role="alert" className="text-destructive">{command.error}</p> : null}
        {saved ? <p role="status">Saved.</p> : null}
      </form>
    </details>
  </div>;
}

function annotationVersion(value?: OutlineAnnotation) {
  return value?.version ?? 0;
}

function Takeaway({ item, outlineId, annotation, selected, canApprove, change }: {
  item: OutlineTakeaway; outlineId: string; annotation?: OutlineAnnotation; selected: boolean;
  canApprove: boolean; change: (item: OutlineTakeaway, checked: boolean) => void;
}) {
  return <article id={item.key} className="space-y-2 rounded-lg border p-3">
    <div className="flex items-start gap-2">
      {canApprove && !item.applied ? <input type="checkbox" aria-label={`Select takeaway: ${item.statement}`} className="mt-1"
        checked={selected} onChange={e => change(item, e.target.checked)} /> : null}
      <p className="min-w-0 flex-1 break-words font-medium">{item.statement}</p>
    </div>
    {item.citations.map(citation => <blockquote key={`${citation.index}:${citation.quote}`} className="space-y-1 border-l-2 pl-3 text-sm">
      <Link className="text-primary underline" href={`/studio/knowledge/extractions/${outlineId}?passage=${citation.index}#unit-${citation.index}`}>
        {citationLabel(citation.type)} · {evidenceTime(citation.start, citation.end) ?? (citation.startChar === null ? "Source passage" : `Text offset ${citation.startChar}`)}
      </Link>
      <p className="whitespace-pre-wrap break-words">“{citation.quote}”</p>
    </blockquote>)}
    {item.applied ? <p className="text-sm">
      <Link className="text-primary underline" href={`/studio/knowledge/${item.applied.insightId}`}>Open in Knowledge</Link>
      {" · "}{item.applied.status}{item.applied.reused ? " · existing match" : ""}
    </p> : null}
    <Annotation key={annotationVersion(annotation)} outlineId={outlineId} nodeKey={item.key} value={annotation} label={item.statement} />
  </article>;
}

type TopicProps = {
  outlineId: string; annotations: Record<string, OutlineAnnotation>; selection: ReadonlyMap<string, OutlineTakeaway["selection"]>;
  canApprove: boolean; change: (item: OutlineTakeaway, checked: boolean) => void;
};

function Topic({ topic, depth, ...props }: TopicProps & { topic: OutlineTopic; depth: number }) {
  const value = props.annotations[topic.key];
  const title = value?.title || topic.title;
  const summary = value?.summary || (topic.takeaways.length === 1 && topic.branches.length === 0 ? "" : topic.summary);
  return <details id={encodeURIComponent(topic.key)} className={`min-w-0 space-y-3 border-l-2 border-border py-1 open:border-accent ${depth < 3 ? "pl-3 sm:pl-4" : "pl-2"}`}>
    <summary className="cursor-pointer break-words font-semibold marker:text-primary">
      {title}
      {summary ? <span className="ml-2 text-sm font-normal text-muted-foreground">{summary}</span> : null}
    </summary>
    <Annotation key={annotationVersion(value)} outlineId={props.outlineId} nodeKey={topic.key} value={value} editable label={topic.title} />
    {topic.branches.map(branch => <Topic key={branch.key} topic={branch} depth={depth + 1} {...props} />)}
    {topic.takeaways.map(item => <Takeaway key={item.key} item={item} outlineId={props.outlineId} annotation={props.annotations[item.key]}
      selected={props.selection.has(item.key)} canApprove={props.canApprove} change={props.change} />)}
  </details>;
}

export function OutlineTopics({ outlineId, topics, annotations, canApprove }: {
  outlineId: string; topics: OutlineTopic[]; annotations: Record<string, OutlineAnnotation>; canApprove: boolean;
}) {
  const router = useRouter();
  const command = useStudioCommand(endpoint);
  const [selected, setSelected] = useState(new Map<string, OutlineTakeaway["selection"]>());
  const [message, setMessage] = useState("");
  const [limitReached, setLimitReached] = useState(false);
  const overview = annotations.overview;

  function change(item: OutlineTakeaway, checked: boolean) {
    if (command.pending || command.retry) return;
    if (checked && selected.size >= 50) { setLimitReached(true); return; }
    setLimitReached(false);
    setSelected(current => {
      const next = new Map(current);
      if (checked) next.set(item.key, item.selection);
      else next.delete(item.key);
      return next;
    });
  }

  async function approve() {
    const result = await command.run({ action: "approve", requestId: crypto.randomUUID(), outlineId,
      selections: [...selected.values()], confirmApproval: true });
    if (result?.ok) {
      const outcomes = result.data.findings as Array<{ decision: "approved" | "existing" }>;
      const approved = outcomes.filter(item => item.decision === "approved").length;
      const prior = outcomes.length - approved;
      setMessage(prior ? `${approved} approved. ${prior} existing decisions preserved.` : `${approved} approved in Knowledge.`);
      setSelected(new Map());
      setLimitReached(false);
      router.refresh();
    } else if (result?.status === 409) {
      router.refresh();
    }
  }

  return <>
    <section className="space-y-3 rounded-xl border p-4 sm:p-5" aria-labelledby="source-overview">
      <h2 id="source-overview" className="text-lg font-semibold">{overview?.title || "At a glance"}</h2>
      {overview?.summary ? <p className="whitespace-pre-wrap break-words">{overview.summary}</p> : topics.length ? <ul className="list-disc space-y-1 pl-5">
        {topics.slice(0, 4).map(topic => <li key={topic.key}>{annotations[topic.key]?.summary || topic.summary}</li>)}
      </ul> : <p className="text-muted-foreground">There are no takeaways to summarize yet.</p>}
      <Annotation key={annotationVersion(overview)} outlineId={outlineId} nodeKey="overview" value={overview} editable label="At a glance" />
    </section>
    {topics.length ? <section aria-labelledby="knowledge-topics" className="space-y-3">
      <h2 id="knowledge-topics" className="text-lg font-semibold">Topics</h2>
      {topics.map(topic => <Topic key={topic.key} topic={topic} depth={0} outlineId={outlineId} annotations={annotations}
        selection={selected} canApprove={canApprove} change={change} />)}
    </section> : null}
    {canApprove && topics.length ? <div className="sticky bottom-1 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-background p-3 shadow-sm">
      <button type="button" onClick={approve} disabled={command.pending || (!command.retry && !selected.size)}
        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
        {command.pending ? "Approving…" : command.retry ? "Retry same approval" : "Approve selected"}
      </button>
      <p role="status" className="text-sm">{selected.size ? `${selected.size} selected. Approved takeaways are saved in Knowledge.` : message || "Select the takeaways you want to approve."}</p>
      {limitReached ? <p role="alert" className="text-sm">Approve up to 50 at a time.</p> : null}
      {command.error ? <p role="alert" className="text-sm text-destructive">{command.error}</p> : null}
    </div> : null}
  </>;
}

export function TranscriptPassage({ outlineId, unit, note, focused }: {
  outlineId: string; unit: EvidenceUnit; note?: OutlineAnnotation; focused: boolean;
}) {
  const key = `unit:${unit.unitIndex}`;
  return <article id={`unit-${unit.unitIndex}`} className={`scroll-mt-3 space-y-2 rounded-md p-3 ${focused ? "border border-primary bg-muted" : "border-b"}`}>
    <p className="text-sm font-medium">{citationLabel(unit.evidenceType)} · {evidenceTime(unit.startSeconds, unit.endSeconds) ??
      (unit.startChar === null ? `Passage ${unit.unitIndex + 1}` : `Characters ${unit.startChar}–${unit.endChar}`)}</p>
    <p className="whitespace-pre-wrap break-words text-sm">{unit.text}</p>
    <Annotation key={annotationVersion(note)} outlineId={outlineId} nodeKey={key} value={note} label="Evidence" />
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
