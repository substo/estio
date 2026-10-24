import { randomUUID } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listStudioSchedules } from "@/lib/studio/schedules";
import { knowledgePage } from "@/lib/studio/knowledge-policy";
import { schedulePresets } from "@/lib/studio/schedule-policy";
import { ScheduleForm } from "./schedule-form";

export const dynamic = "force-dynamic";
export default async function SchedulesPage({ params, searchParams }: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { workspaceId } = await params;
  const page = knowledgePage((await searchParams).page);
  const result = await listStudioSchedules(workspaceId, page);
  if (!result) notFound();
  const canEdit = !(await auth()).actor;
  const newId = randomUUID();
  const base = `/studio/workspace/${result.access.workspace.id}/schedules`;
  return <main className="mx-auto max-w-5xl space-y-6 p-6 md:p-10">
    <Link href={`/studio/workspace/${result.access.workspace.id}`} className="text-sm text-primary hover:underline">Back to workspace</Link>
    <h1 className="text-3xl font-semibold">Schedules</h1>
    <p className="text-muted-foreground">Plan research and content workflows for {result.access.workspace.name}. Saving keeps schedules inactive and pauses prior activation. Open a saved schedule to authorize its workflow. Text runs require paid consent; YouTube discovery requires your own profile grant and explicit recurring public-link sharing consent.</p>
    <p className="text-sm text-muted-foreground">YouTube discovery will require authorized subscriptions or approved public channels/search. Personalized home-feed scraping is not supported.</p>
    {canEdit ? <ScheduleForm key={newId} workspaceId={workspaceId} id={newId} /> : <p>Return to your own account to change schedule drafts.</p>}
    {result.schedules.length === 0 ? <p>No saved drafts on this page.</p> : null}
    {result.schedules.map(schedule => <section key={`${schedule.id}:${schedule.version}`} className="space-y-2">
      {canEdit ? <ScheduleForm workspaceId={workspaceId} id={schedule.id} schedule={schedule} /> : <p>{schedulePresets[schedule.preset_id]} · {schedule.interval_hours === 24 ? `Daily ${schedule.daily_time} ${schedule.time_zone}` : "Every seven days"} · {schedule.focus}</p>}
      <p className="text-xs text-muted-foreground">Saved definition · version {schedule.version} · <Link href={`${base}/${schedule.id}`} className="text-primary hover:underline">Execution, history and provenance</Link></p>
    </section>)}
    <nav aria-label="Schedule pages" className="flex gap-4 text-sm text-primary">
      {page > 0 ? <Link href={`${base}?page=${page - 1}`}>Previous</Link> : null}
      {result.hasMore ? <Link href={`${base}?page=${page + 1}`}>Next</Link> : null}
    </nav>
  </main>;
}
