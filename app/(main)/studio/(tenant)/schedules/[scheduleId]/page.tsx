import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { getStudioYoutubeScheduleSettings } from "@/lib/studio/youtube-schedules";
import { YoutubeScheduleForm } from "../youtube-schedule-form";
import { auth } from "@clerk/nextjs/server";
import { getStudioScheduleExecutionData } from "@/lib/studio/schedule-executions";
import { RefreshScheduleHistory, ScheduleRunNowForm, SchedulePauseForm } from "../run-now-form";
import { notFound } from "next/navigation";
import { getStudioScheduleHistory } from "@/lib/studio/schedule-history";
import { historicalRunStatus, scheduleHistoryPage } from "@/lib/studio/schedule-history-policy";
import { scheduleFrequency, schedulePresets } from "@/lib/studio/schedule-policy";
import { ImportProvenance } from "../import-provenance";

export const dynamic = "force-dynamic";
export default async function ScheduleHistoryPage({ params, searchParams }: {
  params: Promise<{ scheduleId: string }>;
  searchParams: Promise<{ page?: string | string[]; hostedPage?: string | string[] }>;
}) {
  const { locationId, scheduleId } = await studioRouteParams(params);
  const query = await searchParams;
  const page = scheduleHistoryPage(query.page);
  const hostedPage = scheduleHistoryPage(query.hostedPage);
  const result = await getStudioScheduleHistory(locationId, scheduleId, page);
  if (!result) notFound();
  const root = `/studio/schedules`;
  const detail = `${root}/${result.schedule.id}`;
  const hosted = await getStudioScheduleExecutionData(locationId, scheduleId, hostedPage);
  const canRun = !(await auth()).actor;
  const active = !!hosted?.recurring?.enabled;
  const youtubeSettings = canRun && result.schedule.preset_id === "youtube-discovery" ? await getStudioYoutubeScheduleSettings(locationId) : null;
  return <main className="mx-auto max-w-5xl space-y-6 p-6 md:p-10">
    <Link href={root} className="text-sm text-primary hover:underline">Back to schedules</Link>
    <h1 className="text-3xl font-semibold">Schedule and history</h1>
    <p className="text-muted-foreground">{result.access.locationName} · {schedulePresets[result.schedule.preset_id]}</p>
    <section className="space-y-3 rounded-xl border bg-card p-5" aria-label="Active">
      <h2 className="text-xl font-medium">Active: {active ? "On" : "Off"} · {scheduleFrequency(result.schedule)}</h2>
      <p className="text-sm">{active ? (hosted?.recurring?.next_run_at ? `Next run ${hosted.recurring.next_run_at}` : "No run is due yet.") : "Off: nothing runs automatically. Use Run now below, then turn it on when it works."} · Last outcome: {hosted?.recurring?.last_outcome ?? "never turned on"}</p>
      <p className="text-sm text-muted-foreground">Change the frequency in the <Link href={root} className="text-primary hover:underline">schedule draft</Link>; saving the draft turns the schedule off. Daily times use Asia/Nicosia; on a clock change, a missing time rolls forward and a repeated time uses its later occurrence. Every 7 days counts 168 hours after a run. Missed times produce at most one run.</p>
      {canRun && active ? <SchedulePauseForm key={hosted!.recurring!.version} locationId={locationId} scheduleId={scheduleId} version={Number(result.schedule.version)} stateVersion={Number(hosted!.recurring!.version)} /> : null}
      {hosted?.recurring ? <><p className="text-sm">Last turned on by {hosted.recurring.authorized_by}</p><details><summary className="cursor-pointer text-sm">Pinned input snapshot</summary><pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(hosted.recurring.snapshot, null, 2)}</pre></details></> : null}
      {hosted?.ticks.length ? <details><summary className="cursor-pointer text-sm">Recent due-run outcomes</summary><ul className="space-y-1 text-sm">{hosted.ticks.map(tick => <li key={`${tick.due_at}:${tick.created_at}`}>Due {tick.due_at} · {tick.outcome} · checked {tick.created_at}</li>)}</ul></details> : null}
    </section>
    <section className="space-y-2 rounded-xl border bg-card p-5" aria-label="Current draft">
      <h2 className="text-xl font-medium">Current draft · version {result.schedule.version}</h2>
      <p className="whitespace-pre-wrap">{result.schedule.focus || "No focus saved."}</p>
      <p className="text-sm text-muted-foreground">Updated {result.schedule.updated_at}</p>
    </section>
    {hosted && canRun && result.schedule.preset_id !== "youtube-discovery" ? <ScheduleRunNowForm key={`${scheduleId}:${result.schedule.version}:${hosted.recurring?.version ?? 0}`} locationId={locationId} scheduleId={scheduleId} version={Number(result.schedule.version)} stateVersion={Number(hosted.recurring?.version ?? 0)} isScript={result.schedule.preset_id === "script-brief"} ideas={hosted.ideas} active={active} /> : null}
    {youtubeSettings ? <YoutubeScheduleForm key={`${scheduleId}:${result.schedule.version}:${hosted?.recurring?.version ?? 0}`} locationId={locationId} scheduleId={scheduleId} version={Number(result.schedule.version)} stateVersion={Number(hosted?.recurring?.version ?? 0)} settings={youtubeSettings} active={active} /> : null}
    {!canRun ? <p>Return to your own account to run a workflow.</p> : null}
    <section className="space-y-4" aria-label="Hosted run history">
      <h2 className="text-xl font-medium">Runs</h2>
      <RefreshScheduleHistory />
      {hosted?.executions.map(run => <article key={run.id} className="space-y-2 rounded-xl border bg-card p-5 text-sm">
        <Link className="text-primary hover:underline" href={run.workflow === "youtube_discovery" ? `${detail}/discoveries/${run.youtube_run_id}` : `/studio/content/${run.workflow === "script_brief" ? "script-briefs" : "idea-reviews"}/${run.review_id}`}>{run.workflow === "youtube_discovery" ? "YouTube discovery" : run.workflow === "script_brief" ? "Script brief" : "Idea review"} · {run.job?.status ?? "Status unavailable"}</Link>
        <p>{run.activation_token ? `Recurring · due ${run.due_at}` : "Manual"} · Queued {run.created_at} · by {run.created_by_clerk_user_id} · saved definition version {run.definition.version}</p>
        <p className="whitespace-pre-wrap">Focus: {run.definition.focus || "None"}</p>
        {run.job?.last_error_message ? <p>{run.job.last_error_message}</p> : null}
        <p className="text-muted-foreground">The linked run retains the exact selected input snapshot and outcome. Retry, cancellation and charge review are available in <Link className="text-primary hover:underline" href={`/studio/jobs`}>Jobs</Link>.</p>
      </article>)}
      {!hosted?.executions.length ? <p className="text-sm text-muted-foreground">No hosted runs on this page.</p> : null}
      <nav aria-label="Hosted run pages" className="flex gap-4 text-sm text-primary">
        {hostedPage > 0 ? <Link href={`${detail}?hostedPage=${hostedPage - 1}&page=${page}`}>Previous hosted runs</Link> : null}
        {hosted?.hasMore ? <Link href={`${detail}?hostedPage=${hostedPage + 1}&page=${page}`}>More hosted runs</Link> : null}
      </nav>
    </section>
    {result.legacy ? <section className="space-y-3 rounded-xl border bg-card p-5">
      <h2 className="text-xl font-medium">Original imported definition</h2>
      <p className="text-sm text-muted-foreground">Preserved separately from later draft edits. Original source position {result.legacy.source_index + 1}.</p>
      <details><summary className="cursor-pointer text-sm">Exact legacy definition</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">{JSON.stringify(result.legacy.payload, null, 2)}</pre></details>
    </section> : <p className="text-sm text-muted-foreground">This hosted draft has no imported definition or legacy run history.</p>}
    {result.legacy ? <>
      <section className="space-y-4" aria-label="Imported run history">
        <h2 className="text-xl font-medium">Imported local run history</h2>
        <p className="text-sm text-muted-foreground">Original source order; up to 20 runs per page. Queued and running entries are historical and are not resumed.</p>
        {result.history.map(run => <article key={run.id} className="space-y-2 rounded-xl border bg-card p-5 text-sm">
          <h3 className="font-medium"><Link href={`${detail}/runs/${run.id}`} className="text-primary hover:underline">Local run {run.id}</Link></h3>
          <p>{historicalRunStatus(run.status)}</p><p className="text-muted-foreground">Workflow: {run.preset_id || "Unknown"} · started {run.started_at || "not recorded"} · completed {run.completed_at || "not recorded"}</p>
        </article>)}
        {!result.history.length ? <p className="text-sm text-muted-foreground">No imported runs on this page.</p> : null}
        <nav aria-label="Imported run pages" className="flex gap-4 text-sm text-primary">
          {page > 0 ? <Link href={`${detail}?page=${page - 1}`}>Previous runs</Link> : null}
          {result.hasMore ? <Link href={`${detail}?page=${page + 1}`}>More runs</Link> : null}
        </nav>
      </section>
      <ImportProvenance locationId={result.access.locationId} imported={result.imported} />
    </> : null}
  </main>;
}
