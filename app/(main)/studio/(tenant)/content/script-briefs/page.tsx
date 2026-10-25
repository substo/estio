import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listStudioTextRuns } from "@/lib/studio/idea-review";
export const dynamic = "force-dynamic";
export default async function ScriptBriefs({ params }: { params: Promise<{  }> }) {
  const { workspaceId } = await studioRouteParams(params); const history = await listStudioTextRuns(workspaceId,"script_brief"); if (!history) notFound();
  return <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10"><Link href={`/studio/content`} className="text-sm text-primary hover:underline">Content pipeline</Link>
    <h1 className="text-3xl font-semibold">Recent script briefs</h1><p className="text-muted-foreground">Open an idea to generate a source-backed brief. Generation never changes the content record.</p>
    {history.reviews.map(r => <p key={r.id}><Link href={`/studio/content/script-briefs/${r.id}`} className="text-primary hover:underline">{new Date(r.created_at).toLocaleString("en-GB",{timeZone:"Asia/Nicosia"})}</Link> · {r.completed_at ? "Draft saved" : "View processing status"}</p>)}
    {!history.reviews.length ? <p>No script briefs yet.</p> : null}
  </main>;
}
