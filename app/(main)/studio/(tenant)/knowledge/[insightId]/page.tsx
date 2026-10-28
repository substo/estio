import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { findStudioKnowledgeTopics } from "@/lib/studio/knowledge-commands";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { getStudioKnowledgeInsight } from "@/lib/studio/knowledge";
import { knowledgePage, maySubmitKnowledgeReview } from "@/lib/studio/knowledge-policy";
import { safeStudioSourceUrl } from "@/lib/studio/library-policy";
import { ReviewDecisionForm } from "./review-decision-form";

export const dynamic = "force-dynamic";

function text(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function numberText(value: unknown): string | null { return typeof value === "number" && Number.isFinite(value) ? String(value) : null; }

export default async function StudioKnowledgeInsightPage({ params, searchParams }: {
  params: Promise<{ insightId: string }>;
  searchParams: Promise<{ evidencePage?: string | string[]; reviewsPage?: string | string[]; unitsPage?: string | string[] }>;
}) {
  const { locationId, insightId } = await studioRouteParams(params);
  const query = await searchParams;
  const pages = { evidence: knowledgePage(query.evidencePage), reviews: knowledgePage(query.reviewsPage), units: knowledgePage(query.unitsPage) };
  const result = await getStudioKnowledgeInsight(locationId, insightId, pages);
  if (!result) notFound();
  const canReview = maySubmitKnowledgeReview({
    hasLocationAccess: true,
    isImpersonating: Boolean((await auth()).actor),
  });
  const { insight, source, topic, record } = result;
  const reviewTopics = canReview ? await findStudioKnowledgeTopics(locationId, "") : { topics: [], hasMore: false };
  const root = `/studio`;
  const detail = `${root}/knowledge/${insightId}`;
  const pageHref = (section: "evidence" | "reviews" | "units", next: number) => {
    const search = new URLSearchParams({ evidencePage: String(section === "evidence" ? next : pages.evidence), reviewsPage: String(section === "reviews" ? next : pages.reviews), unitsPage: String(section === "units" ? next : pages.units) });
    return `${detail}?${search}`;
  };
  const sourceUrl = safeStudioSourceUrl(source?.payload.url);
  const sourceRoute = record?.kind === "content" ? "content" : "library";
  const imported = insight.payload;
  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6 md:p-10">
      <header className="space-y-3">
        <nav className="flex flex-wrap gap-4 text-sm"><Link href={`${root}/knowledge`} className="text-muted-foreground hover:underline">Knowledge</Link><Link href={root} className="text-muted-foreground hover:underline">{result.access.locationName}</Link></nav>
        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground"><span>Current status: {insight.status}</span><span>Review version {insight.version}</span><span>{text(imported.kind)?.replaceAll("_", " ") || "Finding"}</span>{topic ? <span>Topic: {text(topic.payload.name) || topic.id}</span> : text(imported.suggested_topic) ? <span>Suggested topic: {text(imported.suggested_topic)}</span> : null}</div>
        <h1 className="whitespace-pre-wrap text-3xl font-semibold tracking-tight">{insight.statement}</h1>
        <p className="text-sm text-muted-foreground">Statement edits, topic assignments and review decisions are recorded in the history below. Source wording and provenance stay available for inspection.</p>
      </header>
      {canReview ? <ReviewDecisionForm key={`${insight.id}:${insight.version}`} locationId={locationId} insightId={insight.id} version={insight.version} status={insight.status} statement={insight.statement} suggestedTopic={text(insight.payload.suggested_topic) ?? ""} currentTopic={topic ? { id: topic.id, name: text(topic.payload.name) ?? topic.id } : null} initialTopics={reviewTopics} />
        : <p className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">Review decisions are unavailable while impersonating another account. Return to your own account to review this finding.</p>}
      <section className="space-y-3 rounded-xl border bg-card p-5" aria-label="Knowledge source">
        <h2 className="text-lg font-medium">Source</h2>
        <p className="font-medium">{record?.title || text(source?.payload.title) || insight.source_id}</p>
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground"><span>{text(source?.payload.platform) || "Saved source"}</span>{text(source?.payload.observed_at) ? <span>Observed: {text(source?.payload.observed_at)}</span> : null}{source ? <span>{source.payload.coverage_origin === "extraction_ranges" ? "See extraction citations for processed ranges" : `Coverage: ${source.covered_units} of ${source.total_units} units`}</span> : null}</div>
        <div className="flex flex-wrap gap-4 text-sm">{record ? <Link href={`${root}/${sourceRoute}/${record.id}`} className="text-primary hover:underline">Open saved source</Link> : null}{sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Open original URL</a> : null}</div>
        <details className="text-sm"><summary className="cursor-pointer">{source?.payload.origin === "hosted_extraction" ? "Hosted source metadata" : "Imported source metadata"}</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3">{JSON.stringify(source?.payload ?? {}, null, 2)}</pre></details>
      </section>
      <section className="space-y-4" aria-label="Citations">
        <h2 className="text-xl font-medium">Citations</h2>
        {result.evidence.map((entry) => {
          const quote = text(entry.payload.quote);
          const citationUrl = safeStudioSourceUrl(entry.payload.source_url);
          const start = numberText(entry.payload.start_sec);
          const end = numberText(entry.payload.end_sec);
          const frame = text(entry.payload.frame_file);
          return <article key={entry.id} className="space-y-3 rounded-xl border bg-card p-5">
            {quote ? <blockquote className="whitespace-pre-wrap border-l-2 pl-4">{quote}</blockquote> : <p className="text-sm text-muted-foreground">No quote text saved.</p>}
            <p className="text-sm text-muted-foreground">{start !== null ? `Start ${start}s` : "No start time"}{end !== null ? ` · End ${end}s` : ""}{text(entry.payload.observed_at) ? ` · Observed ${text(entry.payload.observed_at)}` : ""}</p>
            {entry.payload.origin === "hosted_extraction" ? <p className="text-sm text-muted-foreground">Saved source version {numberText(entry.payload.source_version)} · unit {text(entry.payload.unit_id)}{numberText(entry.payload.char_start)!==null ? ` · characters ${numberText(entry.payload.char_start)}–${numberText(entry.payload.char_end)} (end exclusive)` : " · time range refers to the whole cited unit"}{text(entry.payload.extraction_id) ? <Link href={`${root}/knowledge/extractions/${text(entry.payload.extraction_id)}`} className="ml-2 text-primary hover:underline">Extraction provenance</Link> : null}</p> : null}
            {citationUrl ? <a href={citationUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">Open citation URL</a> : null}
            {frame && result.verifiedFrames.evidence.has(entry.id)
              // eslint-disable-next-line @next/next/no-img-element
              ? <img className="max-h-80 rounded-lg border" alt={`Frame ${frame}`} loading="lazy" src={`${root}/knowledge-media/evidence/${entry.id}`} />
              : frame ? <p className="text-sm text-muted-foreground">Frame reference: {frame} · awaiting media upload and verification</p> : null}
            <details className="text-sm"><summary className="cursor-pointer">{entry.payload.origin === "hosted_extraction" ? "Exact hosted evidence" : "Exact imported evidence"}</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3">{JSON.stringify(entry.payload, null, 2)}</pre></details>
          </article>;
        })}
        {!result.evidence.length ? <p className="text-sm text-muted-foreground">No citations on this page.</p> : null}
        <nav className="flex gap-4 text-sm" aria-label="Citation pages">{pages.evidence > 0 ? <Link href={pageHref("evidence", pages.evidence - 1)}>Previous citations</Link> : null}{result.hasMoreEvidence ? <Link href={pageHref("evidence", pages.evidence + 1)}>More citations</Link> : null}</nav>
      </section>
      <section className="space-y-4" aria-label="Reviews">
        <h2 className="text-xl font-medium">Review history</h2>
        {result.reviews.map((entry) => <article key={entry.id} className="rounded-xl border bg-card p-5 text-sm"><p>{text(entry.payload.action) || "Review event"} · {text(entry.payload.previous_status) || "?"} → {text(entry.payload.new_status) || "?"}</p>{text(entry.payload.at) ? <p className="mt-1 text-muted-foreground">{text(entry.payload.at)}</p> : null}{text(entry.payload.actor_clerk_user_id) ? <p className="mt-1 text-muted-foreground">Reviewed by {text(entry.payload.actor_app) || "workspace"} account {text(entry.payload.actor_clerk_user_id)}</p> : null}{entry.payload.previous_statement !== undefined && entry.payload.previous_statement !== entry.payload.new_statement ? <div className="mt-3 space-y-1"><p className="font-medium">Statement changed</p><p className="whitespace-pre-wrap">Before: {text(entry.payload.previous_statement)}</p><p className="whitespace-pre-wrap">After: {text(entry.payload.new_statement)}</p></div> : null}{entry.payload.previous_topic_id !== undefined && entry.payload.previous_topic_id !== entry.payload.new_topic_id ? <p className="mt-3">Topic: {text(entry.payload.previous_topic_name) ?? "Unassigned"} → {text(entry.payload.new_topic_name) ?? "Unassigned"}</p> : null}{text(entry.payload.reason) ? <p className="mt-3 whitespace-pre-wrap">{text(entry.payload.reason)}</p> : null}<details className="mt-3"><summary className="cursor-pointer">Exact review event</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3">{JSON.stringify(entry.payload, null, 2)}</pre></details></article>)}
        {!result.reviews.length ? <p className="text-sm text-muted-foreground">No review events on this page.</p> : null}
        <nav className="flex gap-4 text-sm" aria-label="Review pages">{pages.reviews > 0 ? <Link href={pageHref("reviews", pages.reviews - 1)}>Previous events</Link> : null}{result.hasMoreReviews ? <Link href={pageHref("reviews", pages.reviews + 1)}>More events</Link> : null}</nav>
      </section>
      <section className="space-y-4" aria-label="Source units">
        <h2 className="text-xl font-medium">Source units</h2>
        <p className="text-sm text-muted-foreground">Exact imported transcript units for this source. OCR text is part of each unit; frame images appear once uploaded and verified.</p>
        {result.units.map((entry) => {
          const raw = entry.payload.unit;
          const unit = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
          return <article key={entry.id} className="space-y-2 rounded-xl border bg-card p-5 text-sm"><p className="text-muted-foreground">Unit {entry.unit_index + 1} · transcription {entry.transcription_id}</p><p className="whitespace-pre-wrap">{text(unit.text) || "No text saved."}</p><p className="text-muted-foreground">{numberText(unit.start) !== null ? `Start ${numberText(unit.start)}s` : "No start time"}{numberText(unit.end) !== null ? ` · End ${numberText(unit.end)}s` : ""}</p>{text(unit.frameFile) && result.verifiedFrames.unit.has(entry.id)
            // eslint-disable-next-line @next/next/no-img-element
            ? <img className="max-h-64 rounded-lg border" alt={`Frame ${text(unit.frameFile)}`} loading="lazy" src={`${root}/knowledge-media/unit/${entry.id}`} />
            : text(unit.frameFile) ? <p className="text-muted-foreground">Frame reference: {text(unit.frameFile)} · awaiting media upload and verification</p> : null}<details><summary className="cursor-pointer">Exact imported unit</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3">{JSON.stringify(raw, null, 2)}</pre></details></article>;
        })}
        {!result.units.length ? <p className="text-sm text-muted-foreground">No source units on this page.</p> : null}
        <nav className="flex gap-4 text-sm" aria-label="Source unit pages">{pages.units > 0 ? <Link href={pageHref("units", pages.units - 1)}>Previous units</Link> : null}{result.hasMoreUnits ? <Link href={pageHref("units", pages.units + 1)}>More units</Link> : null}</nav>
      </section>
      <details className="text-sm"><summary className="cursor-pointer">{imported.origin === "hosted_extraction" ? "Exact hosted finding" : "Exact imported finding"}</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3">{JSON.stringify(imported, null, 2)}</pre></details>
    </main>
  );
}
