import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { listStudioRecordLinks } from "@/lib/studio/record-links";
import { recordLinkKind, recordLinkPage, type RecordLinkKind } from "@/lib/studio/record-link-policy";
import { RecordLinkButton } from "./link-button";
export const dynamic = "force-dynamic";
export default async function RecordLinksPage({ params, searchParams }: {
  params: Promise<{ recordId: string }>;
  searchParams: Promise<{ linksPage?: string | string[]; candidatesPage?: string | string[]; kind?: string | string[] }>;
}) {
  const { workspaceId, recordId } = await studioRouteParams(params);
  const query = await searchParams;
  const pages = { links: recordLinkPage(query.linksPage), candidates: recordLinkPage(query.candidatesPage) };
  const kind = recordLinkKind(query.kind);
  const result = await listStudioRecordLinks(workspaceId, recordId, pages, kind);
  if (!result) notFound();
  const canEdit = !(await auth()).actor;
  const root = `/studio`;
  const detail = `${root}/records/${result.record.id}/links`;
  const recordHref = (record: { id: string; kind: string }) => `${root}/${record.kind === "content" ? "content" : "library"}/${record.id}`;
  const href = (links: number, candidates: number, nextKind: RecordLinkKind = kind) => `${detail}?${new URLSearchParams({ linksPage: String(links), candidatesPage: String(candidates), kind: nextKind })}`;
  return <main className="mx-auto max-w-5xl space-y-8 p-6 md:p-10">
    <Link href={recordHref(result.record)} className="text-sm text-primary hover:underline">Back to {result.record.title}</Link>
    <header className="space-y-2"><h1 className="text-3xl font-semibold">Linked records</h1><p>{result.record.title} · version {result.record.version}</p>
      <p className="text-sm text-muted-foreground">Choose records this item links to. Links are one-way. Unlinking keeps both records and their original imported provenance.</p>
      {!canEdit ? <p className="text-sm text-muted-foreground">Return to your own account to change links.</p> : null}
    </header>
    <section className="space-y-4" aria-label="Current linked records">
      <h2 className="text-xl font-medium">Current links</h2>
      {result.links.map(link => <article key={link.id} className="flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-card p-5">
        <div><Link href={recordHref(link)} className="font-medium text-primary hover:underline">{link.title}</Link><p className="text-sm text-muted-foreground">{link.kind}{link.archived ? " · archived" : ""}</p></div>
        {canEdit ? <RecordLinkButton key={`${link.id}:${result.record.version}`} workspaceId={result.access.workspace.id} sourceId={result.record.id} targetId={link.id} version={result.record.version} operation="remove" title={link.title} /> : null}
      </article>)}
      {!result.links.length ? <p className="text-sm text-muted-foreground">No current links on this page.</p> : null}
      <nav aria-label="Current link pages" className="flex gap-4 text-sm text-primary">{pages.links > 0 ? <Link href={href(pages.links - 1, pages.candidates)}>Previous links</Link> : null}{result.hasMoreLinks ? <Link href={href(pages.links + 1, pages.candidates)}>More links</Link> : null}</nav>
    </section>
    <section className="space-y-4" aria-label="Available records to link">
      <h2 className="text-xl font-medium">Choose a record</h2>
      <p className="text-sm text-muted-foreground">Up to 100 outgoing links can be added. Existing imported links are retained until you explicitly unlink them. Archived records are labeled and remain available.</p>
      <nav aria-label="Candidate record types" className="flex flex-wrap gap-3 text-sm">
        {([ ["all", "All records"], ["reference", "Sources"], ["channel", "Channels"], ["content", "Content"] ] as const).map(([value, label]) => <Link key={value} href={href(pages.links, 0, value)} aria-current={kind === value ? "page" : undefined} className={`rounded-md border px-3 py-2 ${kind === value ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{label}</Link>)}
      </nav>
      {result.candidates.map(candidate => <article key={candidate.id} className="flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-card p-5">
        <div><Link href={recordHref(candidate)} className="font-medium text-primary hover:underline">{candidate.title}</Link><p className="text-sm text-muted-foreground">{candidate.kind}{candidate.archived ? " · archived" : ""}</p></div>
        {candidate.linked ? <p className="text-sm text-muted-foreground">Already linked</p> : canEdit ? <RecordLinkButton key={`${candidate.id}:${result.record.version}`} workspaceId={result.access.workspace.id} sourceId={result.record.id} targetId={candidate.id} version={result.record.version} operation="add" title={candidate.title} /> : null}
      </article>)}
      {!result.candidates.length ? <p className="text-sm text-muted-foreground">No matching records on this page.</p> : null}
      <nav aria-label="Candidate pages" className="flex gap-4 text-sm text-primary">{pages.candidates > 0 ? <Link href={href(pages.links, pages.candidates - 1)}>Previous records</Link> : null}{result.hasMoreCandidates ? <Link href={href(pages.links, pages.candidates + 1)}>More records</Link> : null}</nav>
    </section>
  </main>;
}
