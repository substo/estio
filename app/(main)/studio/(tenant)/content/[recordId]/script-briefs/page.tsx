import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudioContentRecord } from "@/lib/studio/content";
import { IdeaReviewStartForm } from "../../idea-reviews/start-form";
export const dynamic = "force-dynamic";
export default async function StartScriptBrief({ params }: { params: Promise<{ recordId: string }> }) {
  const { workspaceId, recordId } = await studioRouteParams(params); const data = await getStudioContentRecord(workspaceId, recordId);
  if (!data) notFound(); const { record } = data;
  const eligible = record.payload.stage === "idea" && !record.archived;
  return <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10"><header className="space-y-2">
    <Link href={`/studio/content/${recordId}`} className="text-sm text-primary hover:underline">Back to content</Link>
    <h1 className="text-3xl font-semibold">Script brief: {record.title}</h1>
    <p className="text-muted-foreground">Generate a saved advisory brief and first script from this idea and its linked research excerpts. At least one linked record must contain saved research text. Applying the draft is a separate action that clears approval and moves it to script stage.</p>
  </header>
    {eligible ? <IdeaReviewStartForm workspaceId={workspaceId} workflow="script_brief" ideas={[record]} /> : <p>Choose an unarchived item at idea stage before generating a brief.</p>}
    <Link href={`/studio/content/script-briefs`} className="text-sm text-primary hover:underline">Recent script briefs</Link>
  </main>;
}
