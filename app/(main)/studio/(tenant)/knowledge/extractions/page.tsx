import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listKnowledgeExtractions } from "@/lib/studio/knowledge-extraction";

export const dynamic = "force-dynamic";

export default async function Extractions({ params, searchParams }: { params: Promise<Record<string, never>>; searchParams: Promise<{ source?: string }> }) {
  const { locationId } = await studioRouteParams(params);
  const requestedSource = (await searchParams).source;
  const sourceId = typeof requestedSource === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestedSource)
    ? requestedSource.toLowerCase() : undefined;
  const reviews = await listKnowledgeExtractions(locationId, sourceId);
  if (!reviews) notFound();
  return <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6 md:p-10">
    <Link href={sourceId ? `/studio/library/${sourceId}#knowledge` : "/studio/knowledge"} className="text-sm text-primary underline">{sourceId ? "Back to source" : "Knowledge"}</Link>
    <h1 className="text-2xl font-semibold sm:text-3xl">{sourceId ? "Extraction history for this source" : "Recent knowledge extractions"}</h1>
    {reviews.length ? <ul className="divide-y rounded-xl border">
      {reviews.map(review => <li key={review.id} className="space-y-1 p-4">
        <Link href={`/studio/knowledge/extractions/${review.id}`} className="break-words font-medium text-primary underline">{review.title || "Saved source"}</Link>
        <p className="text-sm text-muted-foreground">{new Date(review.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Nicosia" })} · {review.outline ? "Full source review" : "Historical range"}</p>
      </li>)}
    </ul> : <p>No extractions yet. Open a source in the <Link href="/studio/library" className="text-primary underline">Research Library</Link> to start.</p>}
  </main>;
}
