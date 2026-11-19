import Link from "next/link";
import { buildKnowledgeOutline, type KnowledgeOutline } from "@/lib/studio/knowledge-outline";
import { safeStudioSourceUrl } from "@/lib/studio/library-policy";
import { OutlineTopics, RefreshKnowledgeOutline, TranscriptPassage } from "./outline-review";

const pageSize = 24;

export function KnowledgeOutlineDetail({ outline, query, embedded = false }: {
  outline: KnowledgeOutline; query: { passage?: string; transcript?: string }; embedded?: boolean;
}) {
  const { batches, annotations } = outline;
  const { topics, units, covered, duplicates } = buildKnowledgeOutline(batches);
  const source = batches[0]?.snapshot.source;
  const url = safeStudioSourceUrl(source?.url);
  const waiting = batches.some(batch => ["queued", "running"].includes(batch.status) && !batch.result);
  const failures = batches.filter(batch => !batch.result && !["queued", "running"].includes(batch.status));
  const complete = batches.length > 0 && batches.every(batch => !!batch.result);
  const stale = outline.stale || batches.some(batch => batch.stale);
  const passage = /^\d{1,4}$/.test(query.passage ?? "") ? Number(query.passage) : null;
  const finalPage = Math.max(0, Math.ceil(units.length / pageSize) - 1);
  const requestedPage = passage !== null ? Math.floor(passage / pageSize) : Number(query.transcript);
  const page = Number.isInteger(requestedPage) ? Math.max(0, Math.min(requestedPage, finalPage)) : 0;
  const pageHref = (n: number) => `/studio/knowledge/extractions/${outline.id}?transcript=${n}#transcript`;
  const isSavedNotes = batches[0]?.snapshot.evidenceMode === "record_text" && batches[0].snapshot.evidenceInputId !== "transcript";

  const Shell = embedded ? "div" : "main";
  return <Shell className={embedded ? "space-y-6" : "mx-auto max-w-4xl space-y-6 p-4 sm:p-6 md:p-10"}>
    {embedded ? null : <header className="space-y-2">
      <Link href="/studio/knowledge/extractions" className="text-sm text-primary underline">Knowledge extractions</Link>
      <h1 className="break-words text-2xl font-semibold sm:text-3xl">{source?.title ?? "Source knowledge"}</h1>
      {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">Open original source</a> : null}
    </header>}
    <section aria-label="Processing coverage" className="space-y-2 text-sm">
      <p role="status"><strong>{complete ? "Reading complete" : waiting ? "Reading source" : "Extraction incomplete"}</strong>
        {" · "}{covered} of {units.length} evidence passages processed · {batches.filter(batch => batch.result).length} of {batches.length} batches</p>
      {duplicates ? <p className="text-muted-foreground">{duplicates} exact {duplicates === 1 ? "duplicate combined" : "duplicates combined"}. Distinct citations are shown with the takeaway.</p> : null}
      {waiting ? <RefreshKnowledgeOutline /> : null}
      {batches.length ? <details>
        <summary className="cursor-pointer text-muted-foreground">Processing details</summary>
        <p className="break-words">{outline.provider === "subscription" ? "Paired Mac subscription" : "Location OpenAI API"}
          {" · "}{[...new Set(batches.map(batch => batch.model))].join(", ")}</p>
      </details> : null}
      {failures.length ? <div className="space-y-2 rounded-md border p-3">
        <p role="alert">{failures.length} {failures.length === 1 ? "batch stopped" : "batches stopped"} before completion. Resolve failed work before approving takeaways.</p>
        {[...new Set(failures.map(batch => batch.error).filter(Boolean))].map(error => <p className="break-words" key={error}>{error}</p>)}
        <Link href="/studio/jobs" className="text-primary underline">Open Jobs</Link>
      </div> : null}
      {stale ? <p role="status" className="rounded-md border p-3">The source changed. Start a new extraction for the current evidence. This review keeps its original evidence and notes.</p> : null}
    </section>
    {covered ? <OutlineTopics outlineId={outline.id} topics={topics} annotations={annotations} canApprove={complete && !stale} /> : null}
    {units.length ? <details id="transcript" open={query.passage !== undefined || query.transcript !== undefined}
      className="space-y-3 rounded-xl border p-4 sm:p-5">
      <summary className="cursor-pointer font-semibold">{isSavedNotes ? "Read saved evidence" : "Read transcript and source evidence"}</summary>
      <p className="text-sm text-muted-foreground">Passages {page * pageSize + 1}–{Math.min((page + 1) * pageSize, units.length)} of {units.length}</p>
      {units.slice(page * pageSize, (page + 1) * pageSize).map(unit => <TranscriptPassage key={unit.id} outlineId={outline.id} unit={unit}
        note={annotations[`unit:${unit.unitIndex}`]} focused={passage === unit.unitIndex} />)}
      <nav aria-label="Transcript pages" className="flex flex-wrap gap-4 text-sm">
        {page > 0 ? <Link className="text-primary underline" href={pageHref(page - 1)}>Previous passages</Link> : null}
        {page < finalPage ? <Link className="text-primary underline" href={pageHref(page + 1)}>Next passages</Link> : null}
      </nav>
    </details> : null}
    {source && !embedded ? <Link href={`/studio/records/${source.id}/extract`} className="text-sm text-primary underline">Extraction options</Link> : null}
  </Shell>;
}
