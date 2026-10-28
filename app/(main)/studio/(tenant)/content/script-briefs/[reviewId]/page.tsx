import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudioScriptBrief } from "@/lib/studio/script-brief";
import { TextRunProvenance } from "../../../../_components/text-run-provenance";
import { RefreshIdeaReview } from "../../idea-reviews/start-form";
import { ScriptBriefApplyForm } from "../apply-form";
export const dynamic = "force-dynamic";
export default async function ScriptBriefPage({ params }: { params: Promise<{ reviewId: string }> }) {
  const { locationId,reviewId }=await studioRouteParams(params); const data=await getStudioScriptBrief(locationId,reviewId); if(!data)notFound();
  const {review,job,stale,application}=data;const brief=review.result;const idea=review.snapshot.ideas[0];
  return <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10"><header className="space-y-2">
    <Link href={`/studio/content/script-briefs`} className="text-sm text-primary hover:underline">Script briefs</Link>
    <h1 className="text-3xl font-semibold">Script brief: {idea.title}</h1><p className="text-sm text-muted-foreground">{review.model} · {review.prompt_version} · {new Date(review.created_at).toLocaleString("en-GB",{timeZone:"Asia/Nicosia"})}</p>
  </header>
    <p>Status: {brief?"Advisory draft saved":job?.status??"unavailable"}</p>
    {job?.last_error_message&&!brief?<p role="alert" className="text-destructive">{job.last_error_message}</p>:null}
    {!brief?<div className="flex flex-wrap gap-4"><RefreshIdeaReview/><Link href={`/studio/jobs`} className="text-sm text-primary hover:underline">Open jobs for retry or manager reconciliation</Link></div>:null}
    {application?<p role="status" className="rounded-lg border p-4">Applied by {application.actor_clerk_user_id} at content version {application.record_version}. <Link href={`/studio/content/${application.record_id}`} className="text-primary hover:underline">Open current script</Link>. Later edits are preserved; this application cannot run again.</p>:stale?<p role="status" className="rounded-lg border p-4">An input changed. Keep this historical draft for reference; generate a fresh brief from current content before applying.</p>:null}
    {brief?<>
      <section className="space-y-3 rounded-xl border p-5"><h2 className="text-xl font-medium">Audience promise</h2><p className="whitespace-pre-wrap">{brief.audiencePromise}</p><h3 className="font-medium">Angle</h3><p className="whitespace-pre-wrap">{brief.angle}</p><h3 className="font-medium">Hook</h3><p className="whitespace-pre-wrap">{brief.hook}</p></section>
      <section className="space-y-3"><h2 className="text-xl font-medium">Outline</h2><ol className="list-decimal space-y-2 pl-5">{brief.outline.map((item,i)=><li key={i}>{item}</li>)}</ol></section>
      <section className="space-y-3"><h2 className="text-xl font-medium">Claims and saved sources</h2>{brief.claims.map((c,i)=><article key={i} className="space-y-1 rounded-lg border p-4 text-sm"><p>{c.claim}</p><p className="font-medium">{c.verificationNeeded?"Verification required":"Source cited — still review its support"}</p><p className="text-muted-foreground">{c.sourceIds.length?c.sourceIds.map(id=>review.snapshot.ideas[0].sources.find(s=>s.id===id)?.title??id).join("; "):"No supporting source supplied"}</p></article>)}</section>
      <section className="space-y-2"><h2 className="text-xl font-medium">Verification gaps</h2><ul className="list-disc space-y-2 pl-5">{brief.verificationGaps.map((gap,i)=><li key={i}>{gap}</li>)}</ul></section>
      <section className="space-y-3"><h2 className="text-xl font-medium">First script draft</h2><pre className="whitespace-pre-wrap break-words rounded-xl border p-5 font-sans text-sm">{brief.script}</pre></section>
      {!stale&&!application?<ScriptBriefApplyForm locationId={locationId} reviewId={reviewId} expectedVersion={Number(idea.version)}/>:null}
    </>:null}
    <TextRunProvenance locationId={locationId} snapshot={review.snapshot}/>
  </main>;
}
