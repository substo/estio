import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { libraryPresentation, platformLabels } from "@/lib/studio/library-presentation";
import { validatedYoutubeCreator } from "@/lib/studio/library-import-metadata";
import { studioRouteParams } from "@/lib/studio/route-context";
import { listPendingStudioUploads } from "@/lib/studio/uploads";
import { getLatestKnowledgeOutline } from "@/lib/studio/knowledge-extraction";
import { getStudioLibraryRecord } from "@/lib/studio/library";
import { getVideoStatus } from "@/lib/studio/video-transcription";
import { canonicalYoutubeVideo } from "@/lib/studio/video-transcription-policy";
import { LibrarySourceAction } from "../../../_components/library-source-action";
import { StudioAttachments } from "../../../_components/studio-attachments";
import { StudioUploadForm } from "../../../_components/studio-upload-form";
import { StudioUploads } from "../../../_components/studio-uploads";
import { VideoTranscriptionPanel } from "../../../_components/video-transcription-panel";
import { LibraryRecordForm } from "../../../_components/library-record-form";
import { RelatedYoutubeVideos } from "../../../_components/related-youtube-videos";
import { LibraryPlatformIcon } from "../../../_components/library-cards";
import { SourcePlayer } from "../../../_components/source-player";
import { ExpandableText } from "../../../_components/expandable-text";
import { SourceSectionNav } from "../../../_components/source-section-nav";
import { SourceAssistant } from "../../../_components/source-assistant";

export const dynamic = "force-dynamic";
const linkButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const primaryLink = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const card = "scroll-mt-16 space-y-3 rounded-xl border bg-card p-4 md:p-5";

export default async function StudioLibraryRecordPage({ params }: { params: Promise<{ recordId: string }> }) {
  const { locationId, recordId } = await studioRouteParams(params);
  const result = await getStudioLibraryRecord(locationId, recordId);
  if (!result) notFound();
  const { record, links, files, uploads, findings, hasMoreFindings } = result;
  const view = libraryPresentation(record);
  const creator = validatedYoutubeCreator(record.payload.channelUrl);
  const value = (key: string) => typeof record.payload[key] === 'string' ? record.payload[key] as string : '';
  const youtube = canonicalYoutubeVideo(view.url);
  const isSource = record.kind === "reference";
  const active = isSource && !record.archived;
  const [pendingUploads, latestOutline, videoStatus] = await Promise.all([
    listPendingStudioUploads(locationId, recordId),
    active ? getLatestKnowledgeOutline(locationId, recordId) : null,
    active && youtube ? getVideoStatus(locationId, recordId).catch(() => null) : null,
  ]);
  const hasTranscript = Boolean(value('transcript').trim());
  const contentLinks = links.filter(link => link.kind === "content");
  const otherLinks = links.filter(link => link.kind !== "content");
  const notes = value('notes');
  const summaryNote = value('summary') || record.summary || '';
  const creatorLine = view.creator ? (creator ? <a href={creator.channelUrl} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{view.creator}</a> : <span className="font-medium">{view.creator}</span>) : null;

  const header = <header className="space-y-2">
    <h1 className="text-balance text-xl font-semibold leading-tight tracking-tight md:text-2xl">{record.title}</h1>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"><LibraryPlatformIcon platform={view.platform} />{platformLabels[view.platform]}</span>
      {creatorLine}
      {record.archived ? <span className="rounded-full bg-muted px-2.5 py-1 text-xs">Archived</span> : null}
      {view.url ? <a href={view.url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex min-h-9 items-center gap-1.5 font-medium text-foreground hover:underline">Open original<ExternalLink aria-hidden="true" className="h-4 w-4" /><span className="sr-only">(new tab)</span></a> : null}
    </div>
  </header>;
  const breadcrumb = <nav aria-label="Breadcrumb" className="flex gap-2 text-sm text-muted-foreground"><Link href="/studio/library" className="hover:underline">Research library</Link><span aria-hidden="true">/</span><span className="truncate">{isSource ? "Source" : "Channel"}</span></nav>;
  const footer = <>
    {record.payload.discovery ? <details className={card}><summary className="cursor-pointer font-medium">Recorded discovery provenance</summary><p className="mt-2 text-sm text-muted-foreground">Historical source information, preserved for review.</p><pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-lg border p-4 text-xs">{JSON.stringify(record.payload.discovery, null, 2)}</pre></details> : null}
    <section aria-label="Linked records and files" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">Linked records</h2><Link href={`/studio/records/${recordId}/links`} className="text-sm font-medium text-primary hover:underline">Manage linked records</Link></div>
      {otherLinks.length ? <ul className="space-y-1 text-sm">{otherLinks.map(linked => <li key={linked.id}><Link className="text-primary hover:underline" href={`/studio/library/${linked.id}`}>{linked.title}</Link></li>)}</ul> : <p className="text-sm text-muted-foreground">No other linked records.</p>}
      {!record.archived && !isSource && record.kind !== "channel" ? <Link href={`/studio/records/${recordId}/extract`} className="text-sm text-primary hover:underline">Extract knowledge from saved text</Link> : null}
    </section>
    <StudioAttachments locationId={locationId} files={files} />
    <StudioUploads locationId={locationId} uploads={uploads} />
    <StudioUploadForm key={recordId} locationId={locationId} recordId={recordId} pendingUploads={pendingUploads} />
  </>;
  const edit = <details id="edit-source" className={card}><summary className="cursor-pointer font-medium">Edit source, transcript and notes</summary><div className="mt-4"><LibraryRecordForm locationId={locationId} recordId={recordId} version={record.version} kind={record.kind} title={record.title} payload={record.payload} /></div></details>;

  if (!isSource) return <main className="mx-auto w-full min-w-0 max-w-4xl space-y-5 p-4 md:p-6">
    {breadcrumb}{header}
    <p className="text-sm text-muted-foreground">Saved videos linked to this channel appear below. Watching in Studio does not subscribe on YouTube or enable recurring discovery. Discovery approval remains manager controlled.</p>
    {contentLinks.length ? null : null}{edit}{footer}
  </main>;

  return <main className="mx-auto w-full min-w-0 max-w-7xl space-y-4 p-4 pb-24 md:p-6 lg:pb-6">
    {breadcrumb}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <div className="min-w-0 space-y-5">
        <SourcePlayer title={record.title} thumbnail={view.thumbnail} videoId={youtube?.videoId ?? null} url={view.url} portrait={view.portrait} />
        {header}
        <ExpandableText text={value('description')} empty="No source description saved. Refresh the source or add evidence through Edit." />
        {view.url ? <div className="flex flex-wrap gap-2"><LibrarySourceAction locationId={locationId} url={view.url} />{creator && !links.some(link => link.kind === 'channel') ? <LibrarySourceAction locationId={locationId} url={creator.channelUrl} sourceId={recordId} sourceVersion={record.version} /> : null}</div> : null}
        <SourceSectionNav only={active ? undefined : ["transcript", "notes"]} />

        <section id="transcript" aria-labelledby="h-transcript" className={card}>
          <h2 id="h-transcript" className="font-semibold">Transcript</h2>
          {hasTranscript ? <><p className="text-sm text-muted-foreground">Saved. Check it against the original before using its claims.</p><details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Read saved transcript</summary><p className="mt-3 max-h-[60dvh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed">{value('transcript')}</p></details></>
            : <p className="text-sm text-muted-foreground">No transcript saved. A link or description does not establish what the video says. {youtube ? "Transcribe it on your Mac, or " : ""}add a verbatim transcript through Edit.</p>}
          {videoStatus ? <VideoTranscriptionPanel locationId={locationId} recordId={recordId} canTranscribe status={videoStatus} hasTranscript={hasTranscript} /> : null}
          <h3 className="pt-2 text-sm font-medium">AI summary</h3>
          <p className="whitespace-pre-wrap break-words text-sm">{value('aiSummary') || view.statusMessage || 'No AI summary saved. Request a summary after saving source evidence.'}</p>
          {value('aiSummary') ? <p className="text-xs text-muted-foreground">Basis: {value('summaryBasis') === 'transcript' ? 'Saved transcript excerpt (first 20,000 characters), with available description.' : value('summaryBasis') === 'description' ? 'Source description only; video contents were not watched.' : 'Basis not recorded; verify against the source.'}</p> : null}
        </section>

        {active ? <>
          <section id="script" aria-labelledby="h-script" className={card}>
            <h2 id="h-script" className="font-semibold">Script</h2>
            <p className="text-sm text-muted-foreground">Turn what works here into your own script. Ideas keep this source linked as research; nothing is copied or approved.</p>
            <div className="flex flex-wrap gap-2">
              {youtube ? <Link href={`/studio/library/${recordId}/template`} className={hasTranscript ? primaryLink : linkButton}>Extract script template</Link> : null}
              <a href="#source-assistant" className={linkButton}>Draft an idea with the assistant</a>
            </div>
            {contentLinks.length ? <div><h3 className="text-sm font-medium">Ideas and scripts from this source</h3><ul className="mt-1 space-y-1 text-sm">{contentLinks.map(linked => <li key={linked.id}><Link className="text-primary hover:underline" href={`/studio/content/${linked.id}`}>{linked.title}</Link></li>)}</ul></div> : <p className="text-sm text-muted-foreground">No ideas created from this source yet.</p>}
          </section>

          <section id="knowledge" aria-labelledby="h-knowledge" className={card}>
            <h2 id="h-knowledge" className="font-semibold">Knowledge</h2>
            <p className="text-sm text-muted-foreground">Explore topics and cited takeaways, then approve what you want to keep.</p>
            <div className="flex flex-wrap gap-2">{latestOutline ? <Link href={`/studio/knowledge/extractions/${latestOutline.id}`} className={primaryLink}>Open knowledge review</Link> : <Link href={`/studio/records/${recordId}/extract`} className={hasTranscript ? primaryLink : linkButton}>Extract knowledge</Link>}</div>
            {findings.length ? <ul className="space-y-2 break-words text-sm">{findings.map(finding => <li key={finding.id}><Link href={`/studio/knowledge/${finding.id}`} className="text-primary hover:underline">{finding.statement}</Link> <span className="text-muted-foreground">({finding.status})</span></li>)}</ul> : <p className="text-sm text-muted-foreground">No knowledge findings saved for this source.</p>}
            {hasMoreFindings ? <Link href="/studio/knowledge?status=all" className="block text-sm text-primary hover:underline">Browse more knowledge findings</Link> : null}
          </section>

          <section id="related" aria-label="Related videos" className="scroll-mt-16"><RelatedYoutubeVideos key={`${locationId}:${recordId}`} anchorId={recordId} /></section>
        </> : null}

        <section id="notes" aria-labelledby="h-notes" className={card}>
          <h2 id="h-notes" className="font-semibold">My notes</h2>
          {notes ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{notes}</p> : <p className="text-sm text-muted-foreground">Nothing yet. Tell the assistant your reaction and choose Save to My notes, or write here through Edit.</p>}
          {summaryNote ? <div><h3 className="text-xs font-medium text-muted-foreground">Saved summary note</h3><p className="whitespace-pre-wrap break-words text-sm">{summaryNote}</p></div> : null}
        </section>
        {edit}
        {footer}
      </div>
      <SourceAssistant locationId={locationId} sourceId={recordId} sourceTitle={record.title} ideaId={randomUUID()} canRelated={active} archived={record.archived} />
    </div>
  </main>;
}
