import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getLatestVideoTemplateReview, getVideoTemplateReview } from "@/lib/studio/video-template";
import { reusableVideoTemplate } from "@/lib/studio/video-template-policy";
import { saveExtractedScriptTemplateAction } from "../(tenant)/content/templates/actions";
import { ScriptTemplateForm } from "../(tenant)/content/templates/template-form";
import { VideoTemplateEvidence } from "../(tenant)/content/templates/from-video/video-template-evidence";
import { AutoRefresh } from "./auto-refresh";

/** The latest script-template extraction for this source, shown in place with its existing review and save controls. */
export async function SourceTemplatePanel({ locationId, sourceId }: { locationId: string; sourceId: string }) {
  const latest = await getLatestVideoTemplateReview(locationId, sourceId);
  if (!latest) return null;
  const [review, state] = await Promise.all([getVideoTemplateReview(locationId, latest.id), auth()]);
  if (!review) return null;
  const working = ["queued", "running"].includes(review.status) && !review.result;
  const path = "/studio/content/templates";
  return <section aria-label="Script template extraction" className="space-y-3 border-t pt-4">
    <h3 className="font-medium">Script template</h3>
    <AutoRefresh active={working} />
    {review.template_id ? <Link className="block text-sm text-primary underline" href={`${path}/${review.template_id}`}>Open saved template</Link> : null}
    {review.stale ? <p role="status" className="text-sm text-muted-foreground">The source changed after this extraction. Use the assistant's Script template mode to run it again.</p> : null}
    {review.result ? <>
      <VideoTemplateEvidence result={review.result} snapshot={review.snapshot} />
      {!review.template_id && !review.stale && !state.actor && review.result.beats.length ? <div className="space-y-3">
        <h4 className="font-medium">Edit the template draft</h4>
        <p className="text-sm text-muted-foreground">Save the reusable guidance for Location Admin review. Citations stay with this review.</p>
        <ScriptTemplateForm initial={reusableVideoTemplate(review.result)} action={saveExtractedScriptTemplateAction.bind(null, locationId, latest.id, randomUUID(), randomUUID())} />
      </div> : null}
    </> : working ? <p role="status" className="text-sm text-muted-foreground">{review.status === "queued" ? "Queued. Waiting for the processor…" : "Reading the video…"}</p>
      : <p role="alert" className="text-sm text-destructive">{review.last_error_message ?? "The extraction ended without a proposal."} Run it again from the assistant.</p>}
  </section>;
}
