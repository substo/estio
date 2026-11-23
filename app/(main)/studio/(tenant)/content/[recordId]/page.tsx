import { scriptNextAction } from "@/lib/studio/reference-workflow";
import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { listPendingStudioUploads } from "@/lib/studio/uploads";
import { notFound } from "next/navigation";
import { StudioAttachments } from "../../../_components/studio-attachments";
import { StudioUploadForm } from "../../../_components/studio-upload-form";
import { StudioUploads } from "../../../_components/studio-uploads";
import { getStudioContentRecord } from "@/lib/studio/content";
import { ContentRecordForm } from "../../../_components/content-record-form";
import { getStudioScriptTemplateChoices } from "@/lib/studio/script-templates";
import { MakeVideo } from "../../../_components/make-video";
import { VideoPanel } from "../../../_components/video-panel";
import { getVideoLoopState } from "@/lib/studio/video-loop";
import { getVideoAssemblyStatus } from "@/lib/studio/video-assembly";
import { getVoiceAvailability, listVoices } from "@/lib/studio/voices/service";
import { videoAssemblyStatusLine } from "@/lib/studio/video-assembly-policy";
import { RelatedYoutubeVideos } from "../../../_components/related-youtube-videos";

export const dynamic = "force-dynamic";

export default async function StudioContentRecordPage({ params }: { params: Promise<{ recordId: string }> }) {
  const { locationId, recordId } = await studioRouteParams(params);
  const result = await getStudioContentRecord(locationId, recordId);
  if (!result) notFound();
  const { record, links, files, uploads } = result;
  const next = scriptNextAction(record, links);
  const inspiration = record.payload.knowledgeInspiration as { outlineId?: unknown; sourceId?: unknown } | undefined;
  const inspirationId = typeof inspiration?.outlineId === "string"
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(inspiration.outlineId)
    && links.some(link => link.id === inspiration.sourceId) ? inspiration.outlineId : null;
  const [assembly, allVoices, availability, loop] = await Promise.all([getVideoAssemblyStatus(locationId, recordId), listVoices(locationId).catch(() => []), getVoiceAvailability(locationId), getVideoLoopState(locationId, recordId)]);
  const [pendingUploads, templates] = await Promise.all([
    listPendingStudioUploads(locationId, recordId),
    getStudioScriptTemplateChoices(locationId, record.script_template_version_id),
  ]);
  return (
    <main className="mx-auto max-w-4xl space-y-8 p-6 md:p-10">
      <header className="space-y-2"><nav className="flex gap-4 text-sm"><Link href={`/studio/content`} className="text-muted-foreground hover:underline">Content pipeline</Link><Link href={`/studio/library`} className="text-muted-foreground hover:underline">Research library</Link></nav><h1 className="text-3xl font-semibold tracking-tight">{record.title}</h1></header>
      <section aria-label="Script next steps" className="space-y-3 rounded-xl border p-5 text-sm">
        <h2 className="font-medium">Next steps for this piece</h2>
        <p>{next.message}</p>
        {!record.archived && record.payload.creation ? <Link href={`/studio/content/create?draft=${recordId}`} className="inline-flex min-h-11 items-center rounded-md border px-3 font-medium hover:bg-accent">Continue in Studio</Link> : null}
        {inspirationId ? <Link href={`/studio/knowledge/extractions/${inspirationId}`} className="inline-block text-primary underline">Open cited inspiration</Link> : null}
        <p className="text-muted-foreground">{links.length} outgoing linked records · {links.filter(link => link.hasScriptEvidence).length} with text available to the script service. Evidence availability is not factual verification or approval.</p>
        {!record.archived ? <div className="flex flex-wrap gap-4">
          {next.kind === "generate" && !record.payload.creation ? <Link href={`/studio/content/${recordId}/script-briefs`} className="text-primary hover:underline">Generate a source-backed script brief</Link> : null}
          <Link href={`/studio/records/${recordId}/links?kind=reference`} className="text-primary hover:underline">Choose research / optional reference videos</Link>
          <Link href="/studio/library" className="text-primary hover:underline">Browse or save another source</Link>
        </div> : null}
        <p className="text-muted-foreground">For filming, include the final script, shot instructions, on-screen examples and any claims still needing verification.</p>
      </section>
      <ContentRecordForm key={`${recordId}:${record.version}`} locationId={locationId} recordId={recordId} version={record.version} title={record.title} payload={record.payload}
        templateOptions={templates.options} pinnedTemplateId={record.script_template_version_id}
        templateSelectionSaved={record.script_template_selected} canSelectTemplate={templates.canSelect && !record.archived} />
      {!record.archived && record.payload.stage === "idea" ? <RelatedYoutubeVideos key={`${locationId}:${recordId}`} anchorId={recordId} /> : null}
      {!record.archived ? <Link href={`/studio/records/${recordId}/extract`} className="mr-4 inline-block text-sm text-primary hover:underline">Extract knowledge from saved text</Link> : null}
      <Link href={`/studio/records/${recordId}/links`} className="inline-block text-sm text-primary hover:underline">Manage linked records</Link>
      {links.length ? <section className="space-y-2"><h2 className="font-medium">Linked research and content</h2><ul className="space-y-2 text-sm">{links.map((linked) => <li key={linked.id}><Link className="text-primary hover:underline" href={`/studio/${linked.kind === "content" ? "content" : "library"}/${linked.id}`}>{linked.title}</Link><span className="ml-2 text-muted-foreground">{linked.kind}</span></li>)}</ul></section> : null}
      {loop ? <VideoPanel key={loop.versions[0]?.id ?? "none"} locationId={locationId} recordId={recordId} state={loop} /> : null}
      {!record.archived && typeof record.payload.script === "string" && record.payload.script.trim() ? <MakeVideo locationId={locationId} recordId={recordId} voices={allVoices} availability={availability} status={videoAssemblyStatusLine(assembly.view, assembly.macOnline, assembly.narration)} active={assembly.view?.status === "queued" || assembly.view?.status === "running" || assembly.narration?.status === "running"} /> : null}
      <StudioAttachments locationId={locationId} files={files} />
      <StudioUploads locationId={locationId} uploads={uploads} />
      <StudioUploadForm key={recordId} locationId={locationId} recordId={recordId} pendingUploads={pendingUploads} />
    </main>
  );
}
