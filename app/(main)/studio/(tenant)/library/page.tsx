import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { listStudioLibrary } from "@/lib/studio/library";
import { safeStudioSourceUrl } from "@/lib/studio/library-policy";
import { LibraryRecordForm } from "../../_components/library-record-form";

export const dynamic = "force-dynamic";

export default async function StudioLibraryPage({ params, searchParams }: {
  params: Promise<{  }>; searchParams: Promise<{ page?: string }>;
}) {
  const { locationId } = await studioRouteParams(params);
  const query = await searchParams;
  const result = await listStudioLibrary(locationId, Number(query.page || 0));
  if (!result) notFound();
  const root = `/studio`;
  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6 md:p-10">
      <header className="space-y-2">
        <nav className="flex flex-wrap gap-4 text-sm"><Link href={root} className="text-muted-foreground hover:underline">{result.access.locationName}</Link><Link href={`${root}/content`} className="text-muted-foreground hover:underline">Content pipeline</Link></nav>
        <h1 className="text-3xl font-semibold tracking-tight">Research library</h1>
        <p className="text-muted-foreground">Keep sources, channel references, citations, and research notes together for this location.</p>
      </header>
      <section className="grid gap-4 sm:grid-cols-2" aria-label="Library records">
        {result.records.map((record) => {
          const url = safeStudioSourceUrl(record.source_url);
          return <article key={record.id} className="space-y-3 rounded-xl border bg-card p-5">
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground"><span>{record.kind === "channel" ? "Channel" : "Source"}</span><span>{record.approved ? "Approved" : "Needs review"}</span>{record.archived ? <span>Archived</span> : null}</div>
            <h2 className="font-medium"><Link href={`${root}/library/${record.id}`} className="hover:underline">{record.title}</Link></h2>
            {record.summary ? <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{record.summary}</p> : null}
            {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm text-primary hover:underline">{url}</a> : null}
          </article>;
        })}
        {!result.records.length ? <p className="text-sm text-muted-foreground">No sources saved on this page. Add a source below.</p> : null}
      </section>
      <nav className="flex gap-5 text-sm" aria-label="Library pages">
        {result.page > 0 ? <Link href={`${root}/library?page=${result.page - 1}`}>Previous page</Link> : null}
        {result.hasNext ? <Link href={`${root}/library?page=${result.page + 1}`}>Next page</Link> : null}
      </nav>
      <section className="max-w-3xl space-y-4"><h2 className="text-xl font-medium">Add a source or channel</h2><LibraryRecordForm locationId={locationId} recordId={randomUUID()} version={0} /></section>
    </main>
  );
}
