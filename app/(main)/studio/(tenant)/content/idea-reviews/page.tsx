import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listStudioContent } from "@/lib/studio/content";
import { listStudioIdeaReviews } from "@/lib/studio/idea-review";
import { IdeaReviewStartForm } from "./start-form";
export const dynamic = "force-dynamic";
export default async function IdeaReviewsPage({ params }: { params: Promise<{  }> }) {
  const { locationId } = await studioRouteParams(params);
  const [content, history] = await Promise.all([listStudioContent(locationId), listStudioIdeaReviews(locationId)]);
  if (!content || !history) notFound();
  const candidates = content.records.filter(r => r.stage === "idea" && !r.archived);
  return <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10">
    <header className="space-y-2"><Link href={`/studio/content`} className="text-sm text-primary hover:underline">Content pipeline</Link>
      <h1 className="text-3xl font-semibold">Idea review</h1><p className="text-muted-foreground">Compare audience relevance, evidence, timeliness, differentiation and production ease. Get one recommendation and its main verification gap for human review.</p></header>
    <p className="text-sm text-muted-foreground">Choose from the {Math.min(50, candidates.length)} most recently updated ideas. Recommendations are advisory and do not change content or approvals.</p>
    <IdeaReviewStartForm locationId={locationId} ideas={candidates.slice(0, 50)} />
    <section className="space-y-3"><h2 className="text-xl font-medium">Recent reviews</h2>
      {history.reviews.map(r => <p key={r.id} className="text-sm"><Link href={`/studio/content/idea-reviews/${r.id}`} className="text-primary hover:underline">{new Date(r.created_at).toLocaleString("en-GB", { timeZone: "Asia/Nicosia" })}</Link> · {r.completed_at ? "Result saved" : "View processing status"}</p>)}
      {!history.reviews.length ? <p className="text-sm text-muted-foreground">No reviews yet.</p> : null}
    </section>
  </main>;
}
