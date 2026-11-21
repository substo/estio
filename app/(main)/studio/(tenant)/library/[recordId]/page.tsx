import { AgentDraftProvider, DraftPanel } from "../../../_components/agent-workspace";
import { getAgentConversation, latestSourceDraft } from "@/lib/studio/agent";
import { getCreationPage } from "@/lib/studio/creation";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, ExternalLink } from "lucide-react";
import { libraryPresentation, platformLabels } from "@/lib/studio/library-presentation";
import { validatedYoutubeCreator } from "@/lib/studio/library-import-metadata";
import { studioRouteParams } from "@/lib/studio/route-context";
import { listPendingStudioUploads } from "@/lib/studio/uploads";
import { getKnowledgeExtractionInputs, getKnowledgeOutline, getLatestKnowledgeOutline } from "@/lib/studio/knowledge-extraction";
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
import { SourceTabs, type SourceTab } from "../../../_components/source-tabs";
import { KnowledgeOutlineDetail } from "../../knowledge/extractions/outline-detail";
import { SourceWorkArea, SourceWorkspaceProvider } from "../../../_components/source-workspace";
import { NotesPanel } from "../../../_components/notes-panel";
import { IdeaPanel } from "../../../_components/idea-panel";
import { SourceTemplatePanel } from "../../../_components/source-template-panel";
import { InfoTip } from "../../../_components/info-tip";
import { SourceAssistant } from "../../../_components/source-assistant";

export const dynamic = "force-dynamic";
const card = "scroll-mt-16 space-y-3 rounded-xl border bg-card p-4 md:p-5";

export default async function StudioLibraryRecordPage({ params, searchParams }: { params: Promise<{ recordId: string }>; searchParams: Promise<{ knowledgeReview?: string; draft?: string; mode?: string; stage?: string; new?: string }> }) {
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
  const query = await searchParams;
  const requestedDraft = links.find(link => link.id === query.draft && link.kind === "content")?.id;
  const creationData = async () => {
    if (!active) return null;
    // Create continues this source's latest conversation after a reload; "new" starts a fresh draft.
    const draftId = requestedDraft ?? (query.new === "1" ? undefined : await latestSourceDraft(locationId, recordId) ?? undefined);
    const data = await getCreationPage(locationId, draftId, recordId) ?? (draftId ? await getCreationPage(locationId, undefined, recordId) : null);
    if (!data) return null;
    const conversation = data.record ? await getAgentConversation(locationId, data.record.id) : { turns: [], plan: [] };
    return { ...data, conversation };
  };
  const [pendingUploads, latestOutline, videoStatus, knowledgeInputs, creation] = await Promise.all([
    listPendingStudioUploads(locationId, recordId),
    active ? getLatestKnowledgeOutline(locationId, recordId) : null,
    active && youtube ? getVideoStatus(locationId, recordId).catch(() => null) : null,
    active ? getKnowledgeExtractionInputs(locationId, recordId).catch(() => null) : null,
    creationData(),
  ]);
  const requestedReview = query.knowledgeReview;
  const requestedOutline = active && typeof requestedReview === "string" && requestedReview !== latestOutline?.id
    ? await getKnowledgeOutline(locationId, requestedReview).catch(() => null) : null;
  const outline = requestedOutline?.sourceId === recordId ? requestedOutline
    : latestOutline ? await getKnowledgeOutline(locationId, latestOutline.id).catch(() => null) : null;
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

  if (!isSource) return <main className="mx-auto w-full min-w-0 max-w-4xl space-y-5 p-4 md:p-6">
    {breadcrumb}{header}
    <p className="text-sm text-muted-foreground">Saved videos linked to this channel appear below. Watching in Studio does not subscribe on YouTube or enable recurring discovery. Discovery approval remains manager controlled.</p>
    {footer}
  </main>;

  const statusChip = (ok: boolean, text: string) => <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${ok ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"}`}>{ok ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : null}{text}</span>;
  const summaryText = value('aiSummary') || summaryNote;
  const basis = value('summaryBasis') === 'transcript' ? 'Based on the saved transcript excerpt (first 20,000 characters) and description.' : value('summaryBasis') === 'description' ? 'Based on the description only; the video was not watched.' : 'Basis not recorded; verify against the source.';
  const panelHead = (title: string, status: React.ReactNode, tip?: React.ReactNode, action?: React.ReactNode) => <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{title}</h2>{status}{tip}<div className="ml-auto flex items-center gap-2">{action}</div></div>;

  const transcriptPanel = <div className="space-y-4">
    {panelHead("Transcript", statusChip(hasTranscript, hasTranscript ? "Saved" : "Not saved"), <InfoTip label="About the transcript">A transcript is what the video actually says. Check it against the original before relying on its claims.</InfoTip>)}
    {videoStatus ? <VideoTranscriptionPanel locationId={locationId} recordId={recordId} canTranscribe status={videoStatus} hasTranscript={hasTranscript} /> : null}
    {hasTranscript ? <p className="whitespace-pre-wrap break-words rounded-lg border bg-card p-4 text-sm leading-relaxed">{value('transcript')}</p>
      : <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">Paste a transcript instead</summary><div className="mt-3"><LibraryRecordForm locationId={locationId} recordId={recordId} version={record.version} kind={record.kind} title={record.title} payload={record.payload} /></div></details>}
    <div className="space-y-2 border-t pt-4">
      {panelHead("AI summary", summaryText ? <InfoTip label="About the summary">{value('aiSummary') ? basis : 'Not generated by AI.'}</InfoTip> : null, null, view.url && active ? <LibrarySourceAction locationId={locationId} url={view.url} label={summaryText ? "Update summary" : "Summarize"} /> : null)}
      <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{summaryText || view.statusMessage || "No summary yet."}</p>
    </div>
  </div>;
  const scriptPanel = <div className="space-y-4">
    {panelHead("Script", null, <InfoTip label="About scripts">Ideas keep this source linked as research; nothing is copied or approved. Use the assistant's Idea or Script template modes to create them.</InfoTip>)}
    <IdeaPanel locationId={locationId} sourceId={recordId} ideaId={randomUUID()} archived={record.archived} />
    {contentLinks.length ? <ul className="space-y-1 text-sm">{contentLinks.map(linked => <li key={linked.id}><Link className="text-primary hover:underline" href={creation && !linked.archived && linked.stagedSourceId === recordId ? `?mode=create&draft=${linked.id}` : `/studio/content/${linked.id}`}>{linked.title}</Link></li>)}</ul> : <p className="text-sm text-muted-foreground">No ideas or scripts from this source yet.</p>}
    {youtube ? <SourceTemplatePanel locationId={locationId} sourceId={recordId} /> : null}
  </div>;
  const knowledgePanel = <div className="space-y-3">
    {panelHead("Knowledge", null, <InfoTip label="About knowledge">Cited takeaways you approve before they are kept. Use the assistant's Knowledge mode to extract them.</InfoTip>)}
    {outline ? <KnowledgeOutlineDetail outline={outline} query={{}} embedded framesFailed={videoStatus?.latest?.visual_status === "failed"} /> : null}
    {findings.length ? <><h3 className="font-medium">Saved knowledge</h3><ul className="space-y-2 break-words text-sm">{findings.map(finding => <li key={finding.id}><Link href={`/studio/knowledge/${finding.id}`} className="text-primary hover:underline">{finding.statement}</Link> <span className="text-muted-foreground">({finding.status})</span></li>)}</ul></> : outline ? null : <p className="text-sm text-muted-foreground">No knowledge saved for this source.</p>}
    {hasMoreFindings ? <Link href="/studio/knowledge?status=all" className="block text-sm text-primary hover:underline">Browse more</Link> : null}
  </div>;
  const notesPanel = <NotesPanel locationId={locationId} sourceId={recordId} version={record.version} notes={notes} archived={record.archived} />;
  const moreLinks = <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">Linked records and files</summary><div className="mt-3 space-y-5">{footer}</div></details>;
  const tabs: SourceTab[] = [
    { id: "transcript", label: "Transcript", badge: hasTranscript ? undefined : undefined, panel: transcriptPanel },
    ...(active ? [
      { id: "script", label: "Script", badge: contentLinks.length ? String(contentLinks.length) : undefined, panel: scriptPanel },
      { id: "knowledge", label: "Knowledge", badge: findings.length ? String(findings.length) : undefined, panel: knowledgePanel },
      { id: "related", label: "Related videos", panel: <RelatedYoutubeVideos key={`${locationId}:${recordId}`} anchorId={recordId} /> },
    ] : []),
    { id: "notes", label: "My notes", panel: notesPanel },
    { id: "more", label: "Files", panel: moreLinks },
  ];

  return <SourceWorkspaceProvider startInCreation={Boolean(creation) && query.mode === "create"} draftId={creation?.record?.id}><AgentDraftProvider recordId={creation?.record?.id ?? randomUUID()} initialRecord={creation?.record ?? null} initialPlan={creation?.conversation.plan ?? []}><main className="mx-auto w-full min-w-0 max-w-7xl space-y-3 p-4 pb-24 md:p-6 lg:pb-6">
    {breadcrumb}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <SourceWorkArea creation={creation && <DraftPanel />}
        research={<div className="flex min-w-0 flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:items-start">
          <SourcePlayer title={record.title} thumbnail={view.thumbnail} videoId={youtube?.videoId ?? null} url={view.url} portrait={view.portrait} />
          <div className="min-w-0 space-y-3">
            {header}
            {creator && !links.some(link => link.kind === 'channel') && view.url ? <LibrarySourceAction locationId={locationId} url={creator.channelUrl} sourceId={recordId} sourceVersion={record.version} /> : null}
            <ExpandableText text={value('description')} empty="none saved." />
          </div>
        </div>
        <SourceTabs tabs={tabs} />
      </div>} />
      <SourceAssistant canCreate={Boolean(creation)} locationId={locationId} sourceId={recordId} sourceTitle={record.title} version={record.version} hasEvidence={hasTranscript || Boolean(value('description').trim())} canRelated={active} archived={record.archived} knowledgeInputs={knowledgeInputs?.inputs ?? []} canTemplate={Boolean(youtube) && hasTranscript} agent={creation ? { source: { id: recordId, version: record.version, title: record.title, hasText: hasTranscript || Boolean(value('description').trim()) }, turns: creation.conversation.turns, newDraftHref: `/studio/library/${recordId}?mode=create&new=1` } : undefined} />
    </div>
  </main></AgentDraftProvider></SourceWorkspaceProvider>;
}
