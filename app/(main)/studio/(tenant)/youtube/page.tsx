import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudioYoutubeSettings } from "@/lib/studio/youtube";
import { YoutubeDiscovery } from "./discovery";
export const dynamic = "force-dynamic";
export default async function YoutubeDiscoveryPage({ params }: { params: Promise<{  }> }) {
  const { locationId } = await studioRouteParams(params);
  const result = await getStudioYoutubeSettings(locationId).catch(() => null); if (!result) notFound();
  return <main className="mx-auto max-w-5xl space-y-6 p-6 md:p-10">
    <Link href={`/studio`} className="text-sm text-primary hover:underline">Studio overview</Link>
    <h1 className="text-3xl font-semibold">YouTube discovery</h1>
    <p className="text-muted-foreground">Find public research links through search, approved channels, saved URLs, or channels from your own subscriptions. This is not a personalized home feed.</p>
    <p className="text-sm text-muted-foreground">Saving shares your chosen link, research title, and discovery source with this location. Saving a result asks your own paired Mac to transcribe it locally (audio, captions fallback, slides and OCR); it waits if the Mac is offline and never uses a paid service. Approved channels may be transcribed automatically after a relevance check; other discovery sources are suggestions only. It does not authorize reuse. Existing saved notes are preserved when a video is saved again.</p>
    <YoutubeDiscovery locationId={result.access.locationId} channels={result.channels} canManage={result.canManage} connected={result.connected} />
  </main>;
}
