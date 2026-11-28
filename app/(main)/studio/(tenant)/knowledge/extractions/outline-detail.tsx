import Link from "next/link";
import { Loader2 } from "lucide-react";
import { buildKnowledgeOutline, type KnowledgeOutline } from "@/lib/studio/knowledge-outline";
import { safeStudioSourceUrl } from "@/lib/studio/library-policy";
import { RetryBatchForm } from "./extraction-forms";
import { OutlineTopics, RefreshKnowledgeOutline, TranscriptPassage } from "./outline-review";

const pageSize = 24;

export function KnowledgeOutlineDetail({ outline, query, embedded = false, framesFailed = false }: {
  outline: KnowledgeOutline; query: { passage?: string; transcript?: string }; embedded?: boolean; framesFailed?: boolean;
}) {
  const { batches, annotations } = outline;
  const { topics, units, covered, duplicates, allTakeaways, featured } = buildKnowledgeOutline(batches);
  const speech = units.filter(unit => unit.evidenceType === "speech").length;
  const ocr = units.filter(unit => unit.evidenceType === "ocr").length;
  const other = units.length - speech - ocr;
  const source = batches[0]?.snapshot.source;
  const url = safeStudioSourceUrl(source?.url);
  const historyUrl = `/studio/knowledge/extractions?source=${outline.sourceId}`;
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

  const coverage = <p>{covered} of {units.length} evidence passages processed · {batches.filter(batch => batch.result).length} of {batches.length} batches</p>;
  const Shell = embedded ? "div" : "main";
  return <Shell className={embedded ? "space-y-3" : "mx-auto max-w-4xl space-y-6 p-4 sm:p-6 md:p-10"}>
    {embedded ? null : <header className="space-y-2">
      <Link href={historyUrl} className="text-sm text-primary underline">Extraction history</Link>
      <h1 className="break-words text-2xl font-semibold sm:text-3xl">{source?.title ?? "Source knowledge"}</h1>
      {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary underline">Open original source</a> : null}
    </header>}
    <section aria-label="Processing coverage" className="space-y-2 text-sm">
      {waiting || !complete || !embedded ? <div role="status" className="text-muted-foreground">
        <p className="flex items-center gap-2 font-medium text-foreground">
          {waiting ? <Loader2 aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" /> : null}
          {waiting ? "Extracting knowledge…" : complete ? "Reading complete" : "Extraction incomplete"}
        </p>
        {coverage}
      </div> : null}
      {waiting ? <RefreshKnowledgeOutline /> : null}
      {batches.length ? <details className="space-y-1 text-muted-foreground">
        <summary className="cursor-pointer py-2">{embedded ? "Extraction details" : "Processing details"}</summary>
        {embedded && complete ? coverage : null}
        {units.length ? <p>{speech} speech · {ocr} on-screen text{other ? ` · ${other} saved text` : ""}
          {framesFailed ? " · Frame processing failed" : null}</p> : null}
        {duplicates ? <p>{duplicates} {duplicates === 1 ? "duplicate combined" : "duplicates combined"}. Distinct citations are shown with the takeaway.</p> : null}
        <p className="break-words">{outline.provider === "location_order" ? "Location AI order" : outline.provider === "subscription" ? "Paired Mac subscription" : "Location OpenAI API"}
          {" · "}{[...new Set(batches.map(batch => batch.model))].join(", ")}</p>
        {embedded ? <Link href={historyUrl} className="inline-flex min-h-11 items-center text-primary underline">Extraction history</Link> : null}
      </details> : null}
      {failures.length ? <div className="space-y-2 rounded-md border p-3">
        <p role="alert">{failures.length} {failures.length === 1 ? "batch stopped" : "batches stopped"} before completion. Resolve failed work before approving takeaways.</p>
        {[...new Set(failures.map(batch => batch.error).filter(Boolean))].map(error => <p className="break-words" key={error}>{error}</p>)}
        <p className="text-muted-foreground">Completed batches are kept. A retry runs only the stopped batch again.</p>
        {failures.filter(batch => batch.jobId && batch.status === "failed").map(batch => <RetryBatchForm key={batch.reviewId} outlineId={outline.id}
          reviewId={batch.reviewId} provider={outline.provider === "location_order" ? (batch.model.startsWith("mac_") ? "subscription" : "openai") : outline.provider} firstPassage={batch.snapshot.startUnit + 1}
          lastPassage={batch.snapshot.startUnit + batch.snapshot.unitCount} />)}
        <Link href="/studio/jobs" className="text-primary underline">Open Jobs</Link>
      </div> : null}
      {stale ? <p role="status" className="rounded-md border p-3">The source changed. Start a new extraction for the current evidence. This review keeps its original evidence and notes.</p> : null}
    </section>
    {covered ? <OutlineTopics key={outline.id} outlineId={outline.id} sourceId={outline.sourceId} topics={topics}
      allTakeaways={allTakeaways} featured={featured} curated={batches.some(batch => batch.snapshot.curationVersion === 1)}
      annotations={annotations} initialTriage={outline.triage ?? {}} canApprove={complete && !stale} compact={embedded} /> : null}
    {units.length ? <details id="transcript" open={query.passage !== undefined || query.transcript !== undefined}
      className={embedded ? "space-y-2 rounded-lg border p-3" : "space-y-3 rounded-xl border p-4 sm:p-5"}>
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
