import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudioScheduleRun } from "@/lib/studio/schedule-history";
import { historicalRunStatus } from "@/lib/studio/schedule-history-policy";
import { ImportProvenance } from "../../../import-provenance";

export const dynamic = "force-dynamic";
const text = (value: unknown) => typeof value === "string" ? value : "";
export default async function ScheduleRunPage({ params }: {
  params: Promise<{ scheduleId: string; runId: string }>;
}) {
  const { locationId, scheduleId, runId } = await studioRouteParams(params);
  const result = await getStudioScheduleRun(locationId, scheduleId, runId);
  if (!result) notFound();
  const { run } = result;
  return <main className="mx-auto max-w-5xl space-y-6 p-6 md:p-10">
    <Link href={`/studio/schedules/${run.schedule_id}`} className="text-sm text-primary hover:underline">Back to schedule history</Link>
    <h1 className="text-3xl font-semibold">Imported local run</h1>
    <p className="text-sm text-muted-foreground">{result.access.locationName} · {run.id} · source position {run.source_index + 1}</p>
    <p>{historicalRunStatus(text(run.payload.status))}. This is historical evidence; no hosted job is running or queued from this entry.</p>
    <p className="text-sm">Workflow: {text(run.payload.presetId)} · started {text(run.payload.startedAt) || "not recorded"} · completed {text(run.payload.completedAt) || "not recorded"}</p>
    {([ ["output", "Exact saved output"], ["error", "Exact saved error"] ] as const).map(([field, label]) => <section key={field} className="space-y-3" aria-label={label}>
      <h2 className="text-xl font-medium">{label}</h2>
      {text(run.payload[field]) !== "" ? <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl border bg-muted p-5 text-sm">{text(run.payload[field])}</pre> : <p className="text-sm text-muted-foreground">No text saved.</p>}
    </section>)}
    <details className="text-sm"><summary className="cursor-pointer">Exact imported run metadata</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3">{JSON.stringify(run.payload, null, 2)}</pre></details>
    <ImportProvenance locationId={result.access.locationId} imported={result.imported} />
  </main>;
}
