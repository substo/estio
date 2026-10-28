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
  const pendingUploads = await listPendingStudioUploads(locationId, recordId);
  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6 md:p-10">
      <header className="space-y-2"><nav className="flex gap-4 text-sm"><Link href={`/studio/library`} className="text-muted-foreground hover:underline">Research library</Link><Link href={`/studio/content`} className="text-muted-foreground hover:underline">Content pipeline</Link></nav><h1 className="text-3xl font-semibold tracking-tight">{record.title}</h1></header>
      <LibraryRecordForm locationId={locationId} recordId={recordId} version={record.version} kind={record.kind} title={record.title} payload={record.payload} />
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
