import { studioRouteParams } from "@/lib/studio/route-context";
import { TextRunProvenance } from "../../../../_components/text-run-provenance";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudioIdeaReview } from "@/lib/studio/idea-review";
import { RefreshIdeaReview } from "../start-form";
export const dynamic = "force-dynamic";
export default async function IdeaReviewPage({ params }: { params: Promise<{ reviewId: string }> }) {
  const { workspaceId, reviewId } = await studioRouteParams(params); const data = await getStudioIdeaReview(workspaceId, reviewId); if (!data) notFound();
  const { review, job, stale } = data; const result = review.result;
  return <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10">
    <header className="space-y-2"><Link href={`/studio/content/idea-reviews`} className="text-sm text-primary hover:underline">Idea reviews</Link><h1 className="text-3xl font-semibold">Idea review result</h1><p className="text-sm text-muted-foreground">{review.model} · {review.prompt_version} · {new Date(review.created_at).toLocaleString("en-GB", { timeZone: "Asia/Nicosia" })}</p></header>
    <p>Status: {result ? "Result saved" : job?.status ?? "unavailable"}</p>
    {job?.last_error_message && !result ? <p role="alert" className="text-destructive">{job.last_error_message}</p> : null}
    {!result ? <div className="flex flex-wrap gap-4"><RefreshIdeaReview /><Link href={`/studio/jobs`} className="text-sm text-primary hover:underline">Open jobs for retry or manager reconciliation</Link></div> : null}
    {stale ? <p role="status" className="rounded-lg border p-4">An idea or linked source changed after this snapshot. This result is historical; review current records before acting.</p> : null}
    {result ? <>
      <section className="space-y-2 rounded-xl border p-5"><h2 className="text-xl font-medium">Recommended: {review.snapshot.ideas.find(i => i.id === result.recommendation)?.title}</h2><p className="whitespace-pre-wrap">{result.reason}</p><Link href={`/studio/content/${result.recommendation}/script-briefs`} className="inline-block text-sm text-primary hover:underline">Draft a script brief from this idea</Link><h3 className="font-medium">Main verification gap</h3><p className="whitespace-pre-wrap">{result.verificationGap}</p></section>
      {result.scores.map(s => <section key={s.ideaId} className="space-y-2 rounded-xl border p-5 text-sm">
        <h2 className="font-medium">{review.snapshot.ideas.find(i => i.id === s.ideaId)?.title}</h2>
        <p>Relevance {s.relevance}/5 · Evidence {s.evidence}/5 · Timeliness {s.timeliness}/5 · Differentiation {s.differentiation}/5 · Production ease {s.ease}/5</p>
        <p className="whitespace-pre-wrap">{s.rationale}</p><p className="text-muted-foreground">Cited source IDs: {s.sourceIds.length ? s.sourceIds.join(", ") : "None — verify missing evidence"}</p>
      </section>)}
    </> : null}
    <TextRunProvenance workspaceId={workspaceId} snapshot={review.snapshot} />
  </main>;
}
