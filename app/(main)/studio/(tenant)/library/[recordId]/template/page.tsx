import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { studioRouteParams } from "@/lib/studio/route-context";
import { getLatestVideoTemplateReview, getVideoTemplateCoverage, getVideoTemplateInput } from "@/lib/studio/video-template";
import { VideoTemplateStartForm } from "./start-form";

export const dynamic = "force-dynamic";

export default async function StartVideoTemplatePage({ params }: { params: Promise<{ recordId: string }> }) {
  const { locationId, recordId } = await studioRouteParams(params);
  const [source, state] = await Promise.all([getVideoTemplateInput(locationId, recordId), auth()]);
  if (!source) notFound();
  const [input, recent] = await Promise.all([
    getVideoTemplateCoverage(locationId, source.id, source.version),
    getLatestVideoTemplateReview(locationId, source.id),
  ]);
  return <main className="mx-auto max-w-3xl space-y-5 p-6 md:p-10">
    <Link href={`/studio/library/${recordId}`} className="text-sm text-primary underline">Back to source</Link>
    <h1 className="text-3xl font-semibold">Extract script template</h1>
    <p className="break-words font-medium">{source.title}</p>
    {recent ? <Link className="block text-sm text-primary underline" href={`/studio/content/templates/from-video/${recent.id}`}>Open latest extraction</Link> : null}
    {input.coverage ? <>
      <p className="text-sm text-muted-foreground">Studio proposes reusable writing beats from saved speech and on-screen text. You can edit the draft before a Location Admin reviews it.</p>
      <p className="text-sm">Using {input.coverage.selectedSpeech} of {input.coverage.speechUnits} timestamped speech passages
        {input.coverage.ocrUnits ? ` and ${input.coverage.selectedOcr} of ${input.coverage.ocrUnits} saved OCR passages.` : ". No saved OCR is available."}</p>
      {input.coverage.selectedUnits < input.coverage.totalUnits ? <p className="text-sm text-muted-foreground">Long evidence is sampled across the video. Some moments will be missing from the review.</p> : null}
      {state.actor ? <p className="text-sm">Sign in as yourself to start an extraction.</p> :
        <VideoTemplateStartForm sourceId={source.id} version={Number(source.version)} />}
    </> : <p className="text-sm">{input.error}</p>}
  </main>;
}
