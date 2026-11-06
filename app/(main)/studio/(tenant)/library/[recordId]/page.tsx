import { libraryPresentation } from "@/lib/studio/library-presentation";
import { validatedYoutubeCreator } from "@/lib/studio/library-import-metadata";
import { LibrarySourceAction } from "../../../_components/library-source-action";
import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { listPendingStudioUploads } from "@/lib/studio/uploads";
import { notFound } from "next/navigation";
import { StudioAttachments } from "../../../_components/studio-attachments";
import { StudioUploadForm } from "../../../_components/studio-upload-form";
import { StudioUploads } from "../../../_components/studio-uploads";
import { getStudioLibraryRecord } from "@/lib/studio/library";
import { LibraryRecordForm } from "../../../_components/library-record-form";

export const dynamic = "force-dynamic";

export default async function StudioLibraryRecordPage({ params }: { params: Promise<{ recordId: string }> }) {
  const { locationId, recordId } = await studioRouteParams(params);
  const result = await getStudioLibraryRecord(locationId, recordId);
  if (!result) notFound();
  const { record, links, files, uploads } = result;
  const view = libraryPresentation(record);
  const creator = validatedYoutubeCreator(record.payload.channelUrl);
  const value = (key: string) => typeof record.payload[key] === 'string' ? record.payload[key] as string : '';
  const pendingUploads = await listPendingStudioUploads(locationId, recordId);
  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6 md:p-10">
      <header className="space-y-2"><nav className="flex gap-4 text-sm"><Link href={`/studio/library`} className="text-muted-foreground hover:underline">Research library</Link><Link href={`/studio/content`} className="text-muted-foreground hover:underline">Content pipeline</Link></nav><h1 className="text-3xl font-semibold tracking-tight">{record.title}</h1></header>
      {view.url ? <a href={view.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">Open original source</a> : null}
      {record.kind !== 'channel' ? <>
        <section><h2 className="font-medium">Source description</h2><p className="whitespace-pre-wrap text-sm">{value('description') || 'No source description saved. Refresh the source or add evidence through Edit.'}</p></section>
        <section><h2 className="font-medium">AI summary</h2><p className="whitespace-pre-wrap text-sm">{value('aiSummary') || view.statusMessage || 'No AI summary saved. Request a summary after saving source evidence.'}</p>{value('aiSummary') ? <p className="text-xs text-muted-foreground">Basis: {value('summaryBasis') === 'transcript' ? 'Saved transcript excerpt (first 20,000 characters), with available description.' : value('summaryBasis') === 'description' ? 'Source description only; video contents were not watched.' : 'Basis not recorded; verify against the source.'}</p> : null}</section>
        <section><h2 className="font-medium">Saved transcript</h2>{value('transcript') ? <details><summary>Read saved transcript</summary><p className="whitespace-pre-wrap text-sm">{value('transcript')}</p></details> : <p className="text-sm text-muted-foreground">No transcript saved on this source. Uploaded transcripts appear below; use Edit to save source text for analysis.</p>}</section>
        <section><h2 className="font-medium">Research notes</h2><p className="whitespace-pre-wrap text-sm">{[value('summary') || record.summary, value('notes')].filter(Boolean).join('\n\n') || 'No human research notes saved. Add notes through Edit.'}</p></section>
        {creator && !links.some(link => link.kind === 'channel') ? <LibrarySourceAction locationId={locationId} url={creator.channelUrl} sourceId={recordId} sourceVersion={record.version} /> : null}
        {view.url ? <LibrarySourceAction locationId={locationId} url={view.url} /> : null}
      </> : <p className="text-sm text-muted-foreground">Saved videos linked to this channel appear below. Watching in Studio does not subscribe on YouTube or enable recurring discovery. Discovery approval remains manager controlled.</p>}
      <details><summary className="cursor-pointer font-medium">Edit source and research notes</summary><div className="mt-4"><LibraryRecordForm locationId={locationId} recordId={recordId} version={record.version} kind={record.kind} title={record.title} payload={record.payload} /></div></details>
      {record.payload.discovery ? <section className="space-y-2"><h2 className="font-medium">Recorded discovery provenance</h2><p className="text-sm text-muted-foreground">Historical source information, preserved for review.</p><pre className="overflow-auto whitespace-pre-wrap rounded-lg border p-4 text-xs">{JSON.stringify(record.payload.discovery, null, 2)}</pre></section> : null}
      {!record.archived && record.kind !== "channel" ? <Link href={`/studio/records/${recordId}/extract`} className="mr-4 inline-block text-sm text-primary hover:underline">Extract knowledge from saved text</Link> : null}
      <Link href={`/studio/records/${recordId}/links`} className="inline-block text-sm text-primary hover:underline">Manage linked records</Link>
      {links.length ? <section><h2 className="font-medium">Linked records</h2><ul className="mt-2 space-y-1 text-sm">{links.map((linked) => <li key={linked.id}><Link className="text-primary hover:underline" href={`/studio/${linked.kind === "content" ? "content" : "library"}/${linked.id}`}>{linked.title}</Link></li>)}</ul></section> : null}
      <StudioAttachments locationId={locationId} files={files} />
      <StudioUploads locationId={locationId} uploads={uploads} />
      <StudioUploadForm key={recordId} locationId={locationId} recordId={recordId} pendingUploads={pendingUploads} />
    </main>
  );
}
