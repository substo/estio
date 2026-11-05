import Link from "next/link";
import { LIBRARY_PLATFORMS, libraryHref, platformLabels } from "@/lib/studio/library-presentation";
import { LibraryAddDialog } from "./library-add-dialog";
import { LibraryAutoEnrich } from "./library-auto-enrich";
import { LibraryCards, type LibraryCardRecord } from "./library-cards";

export function LibraryBrowse({ locationId, records, view, platform, page, hasNext }: {
  locationId: string; records: LibraryCardRecord[]; view: "sources" | "channels"; platform: string; page: number; hasNext: boolean;
}) {
  return <main className="mx-auto w-full min-w-0 max-w-6xl space-y-4 p-4 md:px-8 md:py-6">
    <header className="flex items-center justify-between gap-3"><h1 className="min-w-0 text-xl font-semibold tracking-tight sm:text-2xl">Research library</h1><LibraryAddDialog key={locationId} locationId={locationId} /></header>
    <div className="space-y-3">
      <nav aria-label="Library views" className="flex gap-5 border-b">{[{ value: "sources", label: "Videos & posts" }, { value: "channels", label: "Watched channels" }].map(tab => <Link key={tab.value} href={libraryHref(tab.value, platform)} aria-current={view === tab.value ? "page" : undefined} className={`border-b-2 pb-2 text-sm font-medium ${view === tab.value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{tab.label}</Link>)}</nav>
      <nav aria-label="Filter by source platform" className="flex flex-wrap gap-2">{["", ...LIBRARY_PLATFORMS].map(item => <Link key={item} href={libraryHref(view, item)} aria-current={platform === item ? "page" : undefined} className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${platform === item ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}>{item ? platformLabels[item as keyof typeof platformLabels] : "All platforms"}</Link>)}</nav>
    </div>
    <LibraryAutoEnrich key={`${locationId}:${view}:${platform}:${page}`} locationId={locationId} records={records} />
    {records.length ? <LibraryCards records={records} channels={view === "channels"} /> : <section className="space-y-3 rounded-xl border border-dashed px-5 py-10 text-center"><h2 className="font-medium">{platform || page > 0 ? "No sources in this view" : view === "channels" ? "Start your channel watchlist" : "Start your research collection"}</h2><p className="text-sm text-muted-foreground">{platform || page > 0 ? "Try another platform or view, or add a source." : "Save a video, post or channel to keep your inspiration together."}</p><LibraryAddDialog locationId={locationId} empty /></section>}
    {page > 0 || hasNext ? <nav className="flex justify-between gap-5 text-sm" aria-label="Library pages">{page > 0 ? <Link className="rounded-md border px-4 py-2 hover:bg-muted" href={libraryHref(view, platform, page - 1)}>Previous page</Link> : <span />}{hasNext ? <Link className="rounded-md border px-4 py-2 hover:bg-muted" href={libraryHref(view, platform, page + 1)}>Next page</Link> : null}</nav> : null}
  </main>;
}
