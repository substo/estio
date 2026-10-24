import Link from "next/link";
import { notFound } from "next/navigation";
import { listStudioTextRuns } from "@/lib/studio/idea-review";
export const dynamic = "force-dynamic";
export default async function ScriptBriefs({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params; const history = await listStudioTextRuns(workspaceId,"script_brief"); if (!history) notFound();
  return <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10"><Link href={`/studio/workspace/${workspaceId}/content`} className="text-sm text-primary hover:underline">Content pipeline</Link>
    <h1 className="text-3xl font-semibold">Recent script briefs</h1><p className="text-muted-foreground">Open an idea to generate a source-backed brief. Generation never changes the content record.</p>
    {history.reviews.map(r => <p key={r.id}><Link href={`/studio/workspace/${workspaceId}/content/script-briefs/${r.id}`} className="text-primary hover:underline">{new Date(r.created_at).toLocaleString("en-GB",{timeZone:"Asia/Nicosia"})}</Link> · {r.completed_at ? "Draft saved" : "View processing status"}</p>)}
    {!history.reviews.length ? <p>No script briefs yet.</p> : null}
  </main>;
}
