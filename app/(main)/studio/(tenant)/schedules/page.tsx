import { studioRouteParams } from "@/lib/studio/route-context";
import { randomUUID } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listStudioSchedules } from "@/lib/studio/schedules";
import { knowledgePage } from "@/lib/studio/knowledge-policy";
import { scheduleFrequency, schedulePresets } from "@/lib/studio/schedule-policy";
import { ScheduleForm } from "./schedule-form";

export const dynamic = "force-dynamic";
export default async function SchedulesPage({ params, searchParams }: {
  params: Promise<{  }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { workspaceId } = await studioRouteParams(params);
  const page = knowledgePage((await searchParams).page);
  const result = await listStudioSchedules(workspaceId, page);
  if (!result) notFound();
  const canEdit = !(await auth()).actor;
  const newId = randomUUID();
  const base = `/studio/schedules`;
  return <main className="mx-auto max-w-5xl space-y-6 p-6 md:p-10">
    <Link href={`/studio`} className="text-sm text-primary hover:underline">Studio overview</Link>
    <h1 className="text-3xl font-semibold">Schedules</h1>
    <p className="text-muted-foreground">Plan research and content workflows for {result.access.workspace.name}. New schedules are inactive. Open a saved schedule to run it once now, then turn it on to repeat at its frequency. Saving a draft turns its schedule off. Text runs require paid consent; YouTube discovery requires your own profile connection and link-sharing consent.</p>
    <p className="text-sm text-muted-foreground">YouTube discovery will require authorized subscriptions or approved public channels/search. Personalized home-feed scraping is not supported.</p>
    {canEdit ? <ScheduleForm key={newId} workspaceId={workspaceId} id={newId} /> : <p>Return to your own account to change schedule drafts.</p>}
    {result.schedules.length === 0 ? <p>No saved drafts on this page.</p> : null}
    {result.schedules.map(schedule => <section key={`${schedule.id}:${schedule.version}`} className="space-y-2">
      <p className="flex flex-wrap items-center gap-3 text-sm"><span className="font-medium">{schedulePresets[schedule.preset_id]}</span>
        <span className={schedule.active ? "rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground" : "rounded-full border px-2 py-0.5 text-xs"}>Active: {schedule.active ? "On" : "Off"}</span>
        <span className="text-muted-foreground">{scheduleFrequency(schedule)}</span>
        <Link href={`${base}/${schedule.id}`} className="rounded-md border px-3 py-1 text-primary hover:underline">{schedule.active ? "Run now or turn off" : "Run now or turn on"}</Link></p>
      {canEdit ? <ScheduleForm workspaceId={workspaceId} id={schedule.id} schedule={schedule} /> : <p>{schedule.focus}</p>}
      <p className="text-xs text-muted-foreground">Saved definition · version {schedule.version} · <Link href={`${base}/${schedule.id}`} className="text-primary hover:underline">Runs and history</Link></p>
    </section>)}
    <nav aria-label="Schedule pages" className="flex gap-4 text-sm text-primary">
      {page > 0 ? <Link href={`${base}?page=${page - 1}`}>Previous</Link> : null}
      {result.hasMore ? <Link href={`${base}?page=${page + 1}`}>Next</Link> : null}
    </nav>
  </main>;
}
