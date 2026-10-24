import Link from "next/link";
import { notFound } from "next/navigation";
import { listStudioTranscriptionReviews } from "@/lib/studio/transcription-reconciliation";
import { TranscriptionReviewForm } from "./review-form";
export const dynamic = "force-dynamic";
const usd = (micros: number) => `$${(Number(micros) / 1_000_000).toFixed(6)}`;
const when = (date: string) => new Date(date).toLocaleString("en-GB", { timeZone: "Asia/Nicosia" });
const labels: Record<string, string> = { no_charge: "Confirmed no charge", billed: "Confirmed billed", authorize_replacement: "Replacement authorized" };
export default async function TranscriptionReconciliationPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>; searchParams: Promise<{ page?: string }>;
}) {
  const { workspaceId } = await params;
  const raw = Number((await searchParams).page);
  const page = Number.isSafeInteger(raw) && raw > 0 ? Math.min(1000, raw) : 0;
  const result = await listStudioTranscriptionReviews(workspaceId, page);
  if (!result) notFound();
  return <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10">
    <header className="space-y-2">
      <Link href={`/studio/workspace/${workspaceId}/jobs`} className="text-sm text-primary hover:underline">Back to jobs</Link>
      <h1 className="text-3xl font-semibold">Review AI outcomes</h1>
      <p className="text-muted-foreground">AI managers can reconcile uncertain charges using provider evidence. Recording billing does not authorize another paid call. A separate authorization can queue replacement work.</p>
      <p className="text-sm text-muted-foreground">Active workers must finish or lose their lease before review. If the outcome remains unknown, leave the budget hold in place. Reload this page for the latest state.</p>
    </header>
    {result.attempts.map(a => {
      const usage = result.usage.find(u => u.id === a.usage_id);
      return <article key={`${a.id}:${a.review_version}`} className="space-y-3 rounded-xl border bg-card p-5 text-sm">
        <h2 className="font-semibold">{a.operation === "knowledge_extract" ? "Knowledge extraction" : a.operation === "script_brief" ? "Script brief" : a.operation === "idea_review" ? "Idea review" : `Chunk ${Number(a.chunk_index) + 1} · ${Number(a.duration_seconds).toFixed(3)} seconds`}</h2>
        <dl className="space-y-1 break-all text-muted-foreground">
          <div><dt className="inline font-medium">Attempt: </dt><dd className="inline">{a.id}</dd></div>
          <div><dt className="inline font-medium">Job: </dt><dd className="inline">{a.job_id}</dd></div>
          <div><dt className="inline font-medium">Subject: </dt><dd className="inline">{a.idea_review_id ?? a.upload_id}</dd></div>
          <div><dt className="inline font-medium">Started: </dt><dd className="inline">{when(a.created_at)}</dd></div>
        </dl>
        <p>{a.billing_outcome ? labels[a.billing_outcome] : "Billing outcome unconfirmed"}{a.replacement_authorized ? " · replacement authorized" : " · replacement blocked"}</p>
        {usage ? <p>Original hold {usd(usage.reserved_micros)} · {usage.status === "settled" ? `confirmed cost ${usd(usage.cost_micros ?? 0)}` : usage.status === "released" ? "hold released" : "hold retained"} · usage month {usage.usage_month}</p> : null}
        {result.events.filter(e => e.attempt_id === a.id).map(e => <div key={e.id} className="space-y-1 border-l-2 pl-3">
          <p className="font-medium">{labels[e.action]}{e.cost_micros !== null ? ` · ${usd(e.cost_micros)}` : ""}</p>
          <p className="whitespace-pre-wrap break-words">{e.evidence}</p>
          <p className="text-muted-foreground">{e.actor_clerk_user_id} · {when(e.created_at)}</p>
        </div>)}
        {!a.replacement_authorized ? <TranscriptionReviewForm workspaceId={workspaceId} attemptId={a.id} version={Number(a.review_version)} billingReviewed={!!a.billing_outcome} /> : null}
      </article>;
    })}
    {!result.attempts.length ? <p>No uncertain or in-flight AI attempts on this page.</p> : null}
    <nav className="flex gap-4 text-sm">{page > 0 ? <Link href={`?page=${page - 1}`}>Newer attempts</Link> : null}{result.hasMore ? <Link href={`?page=${page + 1}`}>Older attempts</Link> : null}</nav>
  </main>;
}
