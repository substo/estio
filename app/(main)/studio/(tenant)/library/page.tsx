import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { notFound } from "next/navigation";
import { listStudioLibrary } from "@/lib/studio/library";
import { LIBRARY_PLATFORMS, libraryHref, platformLabels } from "@/lib/studio/library-presentation";
import { LibraryImportForm } from "../../_components/library-import-form";
import { LibraryAutoEnrich } from "../../_components/library-auto-enrich";
import { LibraryCards } from "../../_components/library-cards";

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
  return <main className="mx-auto w-full min-w-0 max-w-6xl space-y-6 p-4 md:p-10">
    <header className="space-y-2">
      <nav className="flex flex-wrap gap-4 text-sm"><Link href="/studio" className="text-muted-foreground hover:underline">{result.access.locationName}</Link><Link href="/studio/content" className="text-muted-foreground hover:underline">Content pipeline</Link></nav>
      <h1 className="text-3xl font-semibold tracking-tight">Research library</h1>
      <p className="text-sm text-muted-foreground">Save what inspires you. Keep your sources and creators close.</p>
    </header>
    <LibraryImportForm locationId={locationId} />
    <LibraryAutoEnrich key={`${locationId}:${view}:${platform}:${result.page}`} locationId={locationId} records={result.records} />
    <div className="space-y-4">
      <nav aria-label="Library views" className="flex gap-6 border-b">{[{ value: "sources", label: "Videos & posts" }, { value: "channels", label: "Watched channels" }].map(tab => <Link key={tab.value} href={libraryHref(tab.value, platform)} aria-current={view === tab.value ? "page" : undefined} className={`border-b-2 px-1 pb-3 text-sm font-medium ${view === tab.value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{tab.label}</Link>)}</nav>
      <nav aria-label="Filter by source platform" className="flex flex-wrap gap-2">{["", ...LIBRARY_PLATFORMS].map(item => <Link key={item} href={libraryHref(view, item)} aria-current={platform === item ? "page" : undefined} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${platform === item ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}>{item ? platformLabels[item as keyof typeof platformLabels] : "All platforms"}</Link>)}</nav>
    </div>
    {result.records.length ? <LibraryCards records={result.records} channels={view === "channels"} /> : <section className="rounded-xl border border-dashed px-6 py-14 text-center"><h2 className="font-medium">{view === "channels" ? "No watched channels yet" : "No saved sources yet"}</h2><p className="mt-2 text-sm text-muted-foreground">{platform ? "Try another platform, or add a matching source above." : view === "channels" ? "Paste a channel URL or @handle above to start your watchlist." : "Paste a video or post URL above to start your collection."}</p></section>}
    <nav className="flex justify-between gap-5 text-sm" aria-label="Library pages">{result.page > 0 ? <Link className="rounded-md border px-4 py-2 hover:bg-muted" href={libraryHref(view, platform, result.page - 1)}>Previous page</Link> : <span />}{result.hasNext ? <Link className="rounded-md border px-4 py-2 hover:bg-muted" href={libraryHref(view, platform, result.page + 1)}>Next page</Link> : null}</nav>
  </main>;
}
