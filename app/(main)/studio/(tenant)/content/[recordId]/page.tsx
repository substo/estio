import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { listPendingStudioUploads } from "@/lib/studio/uploads";
import { notFound } from "next/navigation";
import { StudioAttachments } from "../../../_components/studio-attachments";
import { StudioUploadForm } from "../../../_components/studio-upload-form";
import { StudioUploads } from "../../../_components/studio-uploads";
import { getStudioContentRecord } from "@/lib/studio/content";
import { ContentRecordForm } from "../../../_components/content-record-form";

export const dynamic = "force-dynamic";

export default async function StudioContentRecordPage({ params }: { params: Promise<{ recordId: string }> }) {
  const { workspaceId, recordId } = await studioRouteParams(params);
  const result = await getStudioContentRecord(workspaceId, recordId);
  if (!result) notFound();
  const { record, links, files, uploads } = result;
  const pendingUploads = await listPendingStudioUploads(workspaceId, recordId);
  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6 md:p-10">
      <header className="space-y-2"><nav className="flex gap-4 text-sm"><Link href={`/studio/content`} className="text-muted-foreground hover:underline">Content pipeline</Link><Link href={`/studio/library`} className="text-muted-foreground hover:underline">Research library</Link></nav><h1 className="text-3xl font-semibold tracking-tight">{record.title}</h1></header>
      {record.payload.stage === "idea" && !record.archived ? <Link href={`/studio/content/${recordId}/script-briefs`} className="inline-block text-sm text-primary hover:underline">Generate a source-backed script brief</Link> : null}
      <ContentRecordForm workspaceId={workspaceId} recordId={recordId} version={record.version} title={record.title} payload={record.payload} />
      {!record.archived ? <Link href={`/studio/records/${recordId}/extract`} className="mr-4 inline-block text-sm text-primary hover:underline">Extract knowledge from saved text</Link> : null}
      <Link href={`/studio/records/${recordId}/links`} className="inline-block text-sm text-primary hover:underline">Manage linked records</Link>
      {links.length ? <section className="space-y-2"><h2 className="font-medium">Linked research and content</h2><ul className="space-y-2 text-sm">{links.map((linked) => <li key={linked.id}><Link className="text-primary hover:underline" href={`/studio/${linked.kind === "content" ? "content" : "library"}/${linked.id}`}>{linked.title}</Link><span className="ml-2 text-muted-foreground">{linked.kind}</span></li>)}</ul></section> : null}
      <StudioAttachments workspaceId={workspaceId} files={files} />
      <StudioUploads workspaceId={workspaceId} uploads={uploads} />
      <StudioUploadForm key={recordId} workspaceId={workspaceId} recordId={recordId} pendingUploads={pendingUploads} />
    </main>
  );
}
