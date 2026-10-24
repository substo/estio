import Link from "next/link";
import {notFound} from "next/navigation";
import {getKnowledgeExtraction} from "@/lib/studio/knowledge-extraction";
import {safeStudioSourceUrl} from "@/lib/studio/library-policy";
import {RefreshIdeaReview} from "../../../content/idea-reviews/start-form";
import {ExtractionApplyForm} from "../extraction-forms";
export const dynamic="force-dynamic";
export default async function ExtractionDetail({params}:{params:Promise<{workspaceId:string;reviewId:string}>}){
 const {workspaceId,reviewId}=await params;const data=await getKnowledgeExtraction(workspaceId,reviewId);if(!data)notFound();const {review,state,job}=data;const snapshot=review.snapshot;
 const available=review.result?.findings.map((f,index)=>({index,statement:f.statement})).filter(f=>!state.findings.some(a=>a.findingIndex===f.index))??[];
 const url=safeStudioSourceUrl(snapshot.source.url);
 return <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10"><header className="space-y-2"><Link href={`/studio/workspace/${workspaceId}/knowledge/extractions`} className="text-sm text-primary hover:underline">Knowledge extractions</Link>
 <h1 className="text-3xl font-semibold">Knowledge from {snapshot.source.title}</h1><p className="text-sm text-muted-foreground">{review.model} · {review.prompt_version} · {new Date(review.created_at).toLocaleString("en-GB",{timeZone:"Asia/Nicosia"})}</p></header>
 <p>Status: {review.result?"Proposals saved":job?.status??"unavailable"}</p>
 {!review.result?<div className="space-y-3">{job?.last_error_message?<p role="alert" className="text-destructive">{job.last_error_message}</p>:null}<RefreshIdeaReview/><Link href={`/studio/workspace/${workspaceId}/jobs`} className="ml-4 text-sm text-primary hover:underline">Jobs and manager reconciliation</Link></div>:null}
 <section className="space-y-2 rounded-xl border p-5 text-sm"><h2 className="font-medium">Selected source range</h2><p>{snapshot.mode} · {snapshot.inputId} · source version {snapshot.source.version}</p><p>Selected {snapshot.coverage.selectedUnits} of {snapshot.coverage.totalUnits} units, starting at unit {snapshot.startUnit} (zero-based). Only this range is supplied to this run; other ranges are not included.</p><p className="text-muted-foreground">Proposals interpret saved text; they do not independently verify the source's claims or interpret visuals/OCR.</p>{url?<a href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Original saved URL</a>:null}</section>
 {state.stale?<p role="status" className="rounded-lg border p-4">The source changed. These are historical proposals; extract current text before adding further findings.</p>:null}
 {review.result?.findings.map((f,index)=>{const applied=state.findings.find(a=>a.findingIndex===index);return <article key={index} className="space-y-3 rounded-xl border p-5 text-sm"><p className="text-muted-foreground">{f.kind.replaceAll("_"," ")} · suggested topic: {f.suggestedTopic}</p><h2 className="whitespace-pre-wrap font-medium">{f.statement}</h2><blockquote className="whitespace-pre-wrap border-l-2 pl-4">{f.quote}</blockquote><a href={`#unit-${encodeURIComponent(f.unitId)}`} className="text-primary hover:underline">Cited unit: {f.unitId}</a>
 {applied?<p>{applied.reused?"Linked exact existing finding":"Added finding"} · current status {applied.status} · <Link href={`/studio/workspace/${workspaceId}/knowledge/${applied.insightId}`} className="text-primary hover:underline">Open finding and review history</Link></p>:<p className="text-muted-foreground">Proposed only; not added to Knowledge.</p>}</article>;})}
 {review.result&&!review.result.findings.length?<p>No high-signal findings were proposed for this selected range.</p>:null}
 {!state.stale&&available.length?<ExtractionApplyForm key={state.findings.length} workspaceId={workspaceId} reviewId={reviewId} version={Number(snapshot.source.version)} available={available}/>:null}
 <section className="space-y-3"><h2 className="text-xl font-medium">Exact supplied units</h2>{snapshot.units.map(u=><article key={u.id} id={`unit-${u.id}`} className="space-y-2 rounded-lg border p-4 text-sm"><p className="font-medium">Unit {u.unitIndex} · {u.id}</p><p className="text-muted-foreground">{u.startChar!==null?`Characters ${u.startChar}–${u.endChar} (zero-based, end exclusive)`:u.startSeconds!==null?`Unit time range ${u.startSeconds}–${u.endSeconds??"?"}s`:"No saved time range"}</p><p className="whitespace-pre-wrap">{u.text||"No text in this unit."}</p></article>)}</section>
 </main>;
}
