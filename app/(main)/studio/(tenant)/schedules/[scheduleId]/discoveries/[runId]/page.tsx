import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudioYoutubeScheduleRun } from "@/lib/studio/youtube-schedules";
import { RefreshScheduleHistory } from "../../../run-now-form";
export const dynamic = "force-dynamic";
export default async function YoutubeDiscoveryRunPage({ params }: { params: Promise<{ scheduleId: string; runId: string }> }) {
 const { workspaceId, scheduleId, runId } = await studioRouteParams(params); const data = await getStudioYoutubeScheduleRun(workspaceId, scheduleId, runId);
 if (!data) notFound();
 return <main className="mx-auto max-w-4xl space-y-5 p-6">
  <Link href={`/studio/schedules/${scheduleId}`} className="text-primary hover:underline">Back to schedule</Link>
  <h1 className="text-3xl font-semibold">YouTube discovery run</h1>
  <p>{data.job?.status ?? "Status unavailable"} · queued {data.run.created_at}</p>
  {data.job?.last_error_message ? <p>{data.job.last_error_message}</p> : null}<RefreshScheduleHistory />
  <p className="text-sm text-muted-foreground">Public research links shared with explicit recurring consent. Private profile grants and subscription selections are not part of this result. Existing research may have been reused without changing its title, approval or notes.</p>
  {data.run.result ? <><p>Observed {data.run.result.observedAt} · {data.run.result.links.length} links</p>
   <ul className="space-y-3">{data.run.result.links.map(link => <li key={link.videoId}><Link className="text-primary hover:underline" href={`/studio/library/${link.recordId}`}>Research link · {link.videoId}</Link> · {link.reused ? "Existing research preserved" : "Added as pending research"}</li>)}</ul>
  </> : <p>Results have not been saved. Check Jobs for retry or cancellation.</p>}
 </main>;
}
