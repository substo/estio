import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listKnowledgeExtractions } from "@/lib/studio/knowledge-extraction";

export const dynamic = "force-dynamic";

export default async function Extractions({ params }: { params: Promise<Record<string, never>> }) {
  const { locationId } = await studioRouteParams(params);
  const reviews = await listKnowledgeExtractions(locationId);
  if (!reviews) notFound();
  return <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 md:p-10">
    <Link href="/studio/knowledge" className="text-sm text-primary underline">Knowledge</Link>
    <h1 className="text-2xl font-semibold sm:text-3xl">Recent knowledge extractions</h1>
    {reviews.length ? <ul className="divide-y rounded-xl border">
      {reviews.map(review => <li key={review.id} className="space-y-1 p-4">
        <Link href={`/studio/knowledge/extractions/${review.id}`} className="break-words font-medium text-primary underline">{review.title || "Saved source"}</Link>
        <p className="text-sm text-muted-foreground">{new Date(review.created_at).toLocaleDateString("en-GB", { timeZone: "Asia/Nicosia" })} · {review.outline ? "Full source review" : "Historical range"}</p>
      </li>)}
    </ul> : <p>No extractions yet. Open a source in the <Link href="/studio/library" className="text-primary underline">Research Library</Link> to start.</p>}
  </main>;
}
