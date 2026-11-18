import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { studioRouteParams } from "@/lib/studio/route-context";
import { getVideoTemplateReview } from "@/lib/studio/video-template";
import { reusableVideoTemplate } from "@/lib/studio/video-template-policy";
import { saveExtractedScriptTemplateAction } from "../../actions";
import { ScriptTemplateForm } from "../../template-form";
import { VideoTemplateEvidence } from "../video-template-evidence";

export const dynamic = "force-dynamic";

export default async function VideoTemplateReviewPage({ params }: { params: Promise<{ reviewId: string }> }) {
  const { locationId, reviewId } = await studioRouteParams(params);
  const [review, state] = await Promise.all([getVideoTemplateReview(locationId, reviewId), auth()]);
  if (!review) notFound();
  const source = review.snapshot.source;
  const working = ["queued", "running"].includes(review.status);
  const path = "/studio/content/templates";
  return <main className="mx-auto max-w-3xl space-y-6 p-6 md:p-10">
    <header className="space-y-3">
      <nav className="flex flex-wrap gap-3 text-sm text-primary">
        <Link href={path} className="underline">Script templates</Link>
        <Link href={`/studio/library/${source.id}`} className="underline">Saved video source</Link>
      </nav>
      <h1 className="text-3xl font-semibold">Video template review</h1>
      <p className="break-words text-muted-foreground">{source.title}</p>
    </header>
    {review.template_id ? <Link className="block text-sm text-primary underline" href={`${path}/${review.template_id}`}>Open saved template</Link> : null}
    {review.stale ? <p role="status" className="text-sm">The video source changed after this extraction. Review the historical evidence below or <Link className="underline" href={`/studio/library/${source.id}/template`}>start a new extraction</Link>.</p> : null}
    {review.result ? <>
      <VideoTemplateEvidence result={review.result} snapshot={review.snapshot} />
      {!review.template_id && !review.stale && !state.actor && review.result.beats.length ? <section className="space-y-3">
        <h2 className="text-xl font-semibold">Edit the template draft</h2>
        <p className="text-sm text-muted-foreground">Save the reusable guidance for Location Admin review. Citations stay in this review.</p>
        <ScriptTemplateForm initial={reusableVideoTemplate(review.result)}
          action={saveExtractedScriptTemplateAction.bind(null, locationId, reviewId, randomUUID(), randomUUID())} />
      </section> : null}
    </> : <section className="space-y-3 text-sm" aria-label="Extraction status">
      {working ? <p role="status">{review.status === "queued" ? "Template extraction is queued." : "Template extraction is running."}</p> :
        <p>{review.last_error_message ?? "The extraction ended without a proposal."}</p>}
      {working ? <a className="inline-block text-primary underline" href={`${path}/from-video/${reviewId}`}>Refresh status</a> :
        <Link className="text-primary underline" href={`/studio/library/${source.id}/template`}>Back to extraction options</Link>}
    </section>}
  </main>;
}
