import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageStudioAi } from "@/lib/studio/ai-settings-policy";
import { listStudioJobs, studioDiagnosticDisplayResult, canRetryStudioJob } from "@/lib/studio/jobs";
import { studioJobKindLabels } from "@/lib/studio/worker/handlers";
import { JobActionButton, WorkerCheckButton } from "./job-buttons";

export const dynamic = "force-dynamic";
const statusLabels = { queued: "Waiting", running: "Running", succeeded: "Done", failed: "Failed", cancelled: "Cancelled" } as const;
const when = (value: string | null) => value ? new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Nicosia", dateStyle: "medium", timeStyle: "short" }) : "";

export default async function StudioJobsPage({ params, searchParams }: { params: Promise<{  }>; searchParams: Promise<{ page?: string }> }) {
  const { workspaceId } = await studioRouteParams(params);
  const page = Math.max(0, Math.min(1000, Number((await searchParams).page) || 0));
  const result = await listStudioJobs(workspaceId, page);
  if (!result) notFound();
  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6 md:p-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Jobs</h1>
        <p className="text-muted-foreground">Processing for this Business. Mac jobs wait for their paired companion, with no automatic paid API fallback. Hosted jobs run on the server.</p>
      </header>
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-card p-5 text-sm">
        <p><span className="font-medium">Hosted worker:</span> {result.workerOnline ? "Online" : "Offline"}{result.workerLastSeen ? ` · last seen ${when(result.workerLastSeen)}` : " · not seen yet"}</p>
        <WorkerCheckButton workspaceId={workspaceId} />
      </section>
      {canManageStudioAi(result.access) ? <Link href={`/studio/jobs/reconciliation`} className="block text-sm text-primary hover:underline">Review uncertain AI charges and replacement work</Link> : null}
      <section className="space-y-3" aria-label="Jobs">
        {result.jobs.map(job => {
          const diagnosticResult = studioDiagnosticDisplayResult(job.kind, job.result);
          return <article id={`job-${job.id}`} key={job.id} className="space-y-1 rounded-xl border bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{studioJobKindLabels[job.kind] ?? job.kind}</p>
            <p>{job.status === "queued" && job.execution_target === "device" ? "Waiting for Mac" : statusLabels[job.status]} · attempt {job.attempts} of {job.max_attempts}</p>
          </div>
          <p className="text-muted-foreground">{job.execution_target === "device" ? `Paired Mac${job.device_id ? ` · device ${job.device_id}` : ""} · no paid API fallback` : "Hosted execution"}</p>
          <p className="text-muted-foreground">Created {when(job.created_at)}{job.finished_at ? ` · finished ${when(job.finished_at)}` : job.status === "queued" && job.attempts > 0 ? ` · next try ${when(job.run_after)}` : ""}</p>
          {job.last_error_message && job.status !== "succeeded" ? <p className={job.status === "failed" ? "text-destructive" : "text-muted-foreground"}>{job.last_error_message}</p> : null}
          {diagnosticResult ? <details className="pt-2"><summary className="cursor-pointer font-medium">Check result</summary><pre className="mt-2 whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs">{diagnosticResult}</pre></details> : null}
          {job.status === "failed" && canRetryStudioJob(result.access, job) ? <JobActionButton workspaceId={workspaceId} jobId={job.id} action="retry" /> : null}
          {job.status === "queued" ? <JobActionButton workspaceId={workspaceId} jobId={job.id} action="cancel" /> : null}
        </article>; })}
        {!result.jobs.length ? <p className="text-sm text-muted-foreground">No jobs yet.</p> : null}
        <nav className="flex gap-4 text-sm">{page > 0 ? <Link href={`?page=${page - 1}`}>Newer jobs</Link> : null}{result.hasMore ? <Link href={`?page=${page + 1}`}>Older jobs</Link> : null}</nav>
      </section>
    </main>
  );
}
