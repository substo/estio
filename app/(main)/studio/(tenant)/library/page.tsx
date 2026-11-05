import { studioRouteParams } from "@/lib/studio/route-context";
import { notFound } from "next/navigation";
import { listStudioLibrary } from "@/lib/studio/library";
import { LIBRARY_PLATFORMS } from "@/lib/studio/library-presentation";
import { LibraryBrowse } from "../../_components/library-browse";

export const dynamic = "force-dynamic";

export default async function StudioLibraryPage({ params, searchParams }: {
  params: Promise<{}>; searchParams: Promise<{ page?: string; view?: string; platform?: string }>;
}) {
  const { locationId } = await studioRouteParams(params);
  const query = await searchParams;
  const view = query.view === "channels" ? "channels" : "sources";
  const platform = LIBRARY_PLATFORMS.find(item => item === query.platform) || "";
  const result = await listStudioLibrary(locationId, Number(query.page || 0), { kind: view === "channels" ? "channel" : "reference", platform: platform || undefined });
  if (!result) notFound();
  return <LibraryBrowse locationId={locationId} records={result.records} view={view} platform={platform} page={result.page} hasNext={result.hasNext} />;
}
