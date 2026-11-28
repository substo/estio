import { AgentDraftProvider, DraftPanel } from "../../../_components/agent-workspace";
import { agentSessionKey } from "@/lib/studio/agent-policy";
import { agentRouteScope, getAgentConversation, getAgentSourceCitation, latestSourceDraft } from "@/lib/studio/agent";
import { getKnowledgeSourceCitation } from "@/lib/studio/citation-source";
import { proposalFocusQuery, readProposalFocus, transcriptPassage } from "@/lib/studio/citation-navigation";
import { recordLinkId } from "@/lib/studio/record-link-policy";
import { getCreationPage } from "@/lib/studio/creation";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { libraryPresentation, platformLabels } from "@/lib/studio/library-presentation";
import { validatedYoutubeCreator } from "@/lib/studio/library-import-metadata";
import { studioRouteParams } from "@/lib/studio/route-context";
import { listPendingStudioUploads } from "@/lib/studio/uploads";
import { getImportedKnowledgeState, getKnowledgeExtractionInputs, getKnowledgeOutline, getLatestKnowledgeOutline } from "@/lib/studio/knowledge-extraction";
import { getStudioLibraryRecord } from "@/lib/studio/library";
import { readVideoNotQueuedReason } from "@/lib/studio/video-state-text";
import { getVideoStatus } from "@/lib/studio/video-transcription";
import { canonicalYoutubeVideo } from "@/lib/studio/video-transcription-policy";
import { LibrarySourceAction } from "../../../_components/library-source-action";
import { StudioAttachments } from "../../../_components/studio-attachments";
import { StudioUploadForm } from "../../../_components/studio-upload-form";
import { StudioUploads } from "../../../_components/studio-uploads";
import { TranscriptLines } from "../../../_components/transcript-lines";
import { VideoSlidesSection, VideoTranscriptionPanel } from "../../../_components/video-transcription-panel";
import { LibraryRecordForm } from "../../../_components/library-record-form";
import { RelatedYoutubeVideos } from "../../../_components/related-youtube-videos";
import { LibraryPlatformIcon } from "../../../_components/library-cards";
import { SourcePlayer } from "../../../_components/source-player";
import { SourceDetailsPanel } from "../../../_components/source-details-panel";
import { readSourceDetails } from "@/lib/studio/source-details";
import { HighlightsProvider, HighlightsSection, JumpBar, Section, SummarySection } from "../../../_components/source-sections";
import { getSourceHighlights, getSummaryFailure } from "@/lib/studio/source-page";
import { summaryView } from "@/lib/studio/source-highlights";
import { SourceTabs, type SourceTab } from "../../../_components/source-tabs";
import { KnowledgeOutlineDetail } from "../../knowledge/extractions/outline-detail";
import { SourceWorkArea, SourceWorkspaceProvider } from "../../../_components/source-workspace";
import { NotesPanel } from "../../../_components/notes-panel";
import { IdeaPanel } from "../../../_components/idea-panel";
import { SourceTemplatePanel } from "../../../_components/source-template-panel";
import { InfoTip } from "../../../_components/info-tip";
import { SourceKnowledgeActions } from "../../../_components/source-knowledge-actions";
import { SourceAssistant } from "../../../_components/source-assistant";

export const dynamic = "force-dynamic";
const card = "scroll-mt-16 space-y-3 rounded-xl border bg-card p-4 md:p-5";

export default async function StudioLibraryRecordPage({ params, searchParams }: { params: Promise<{ recordId: string }>; searchParams: Promise<{ knowledgeReview?: string; draft?: string; mode?: string; stage?: string; new?: string;
  citationTurn?: string; citationProposal?: string; citationItem?: string; citationEvidence?: string;
  proposalTurn?: string; proposalIndex?: string; transcriptionSetup?: string; knowledgeSetup?: string }> }) {
  const { locationId, recordId } = await studioRouteParams(params);
  const result = await getStudioLibraryRecord(locationId, recordId);
  if (!result) notFound();
  const { access, record, links, files, uploads, findings, hasMoreFindings } = result;
  const view = libraryPresentation(record);
  const creator = validatedYoutubeCreator(record.payload.channelUrl);
  const value = (key: string) => typeof record.payload[key] === 'string' ? record.payload[key] as string : '';
  const youtube = canonicalYoutubeVideo(view.url);
  const isSource = record.kind === "reference";
  const active = isSource && !record.archived;
  const query = await searchParams;
  const focusedProposal = readProposalFocus(query.proposalTurn, query.proposalIndex);
  const citedProposal = readProposalFocus(query.citationTurn, query.citationProposal);
  const citationRequested = isSource && (query.citationTurn !== undefined || query.citationEvidence !== undefined);
  const citationItem = typeof query.citationItem === "string" && /^[a-zA-Z0-9:-]{1,80}$/.test(query.citationItem) ? query.citationItem : null;
  const agentCitation = isSource && citedProposal && citationItem
    ? getAgentSourceCitation(locationId, recordId, citedProposal, citationItem).catch(() => null) : null;
  const knowledgeCitation = isSource && typeof query.citationEvidence === "string" && recordLinkId(query.citationEvidence)
    ? getKnowledgeSourceCitation(access, recordId, query.citationEvidence).catch(() => null) : null;
  const requestedDraft = links.find(link => link.id === query.draft && link.kind === "content")?.id;
  const creationData = async () => {
    if (!active) return null;
    // Create starts fresh. An explicit ?draft= (deep link or Resume) reopens that draft and any active turn.
    const draftId = requestedDraft;
    const data = await getCreationPage(locationId, draftId, recordId) ?? (draftId ? await getCreationPage(locationId, undefined, recordId) : null);
    if (!data) return null;
    const conversation = data.record ? await getAgentConversation(locationId, data.record.id, focusedProposal?.turnId) : { turns: [], plan: [], target: null };
    const resume = !draftId && !query.new ? await latestSourceDraft(locationId, recordId) : null;
    return { ...data, conversation, resume, scope: await agentRouteScope(locationId) };
  };
  const summary = summaryView(record.payload, Boolean(value('transcript').trim()), Boolean(value('description').trim()));
  const [pendingUploads, latestOutline, videoStatus, knowledgeInputs, knowledgeAuto, creation, fromAgent, fromKnowledge, highlights, summaryFailure, sourceDetails] = await Promise.all([
    listPendingStudioUploads(locationId, recordId),
    active ? getLatestKnowledgeOutline(locationId, recordId) : null,
    active && youtube ? getVideoStatus(locationId, recordId).catch(() => null) : null,
    active ? getKnowledgeExtractionInputs(locationId, recordId).catch(() => null) : null,
    active ? getImportedKnowledgeState(locationId, recordId).catch(() => null) : null,
    creationData(),
    agentCitation,
    knowledgeCitation,
    active ? getSourceHighlights(locationId, recordId).catch(() => []) : [],
    summary.state === "failed" ? getSummaryFailure(locationId, recordId).catch(() => null) : null,
    active && youtube && record.source_url ? readSourceDetails(access, recordId, record.source_url).catch(() => null) : null,
  ]);
  const requestedReview = query.knowledgeReview;
  const requestedOutline = active && typeof requestedReview === "string" && requestedReview !== latestOutline?.id
    ? await getKnowledgeOutline(locationId, requestedReview).catch(() => null) : null;
  const outline = requestedOutline?.sourceId === recordId ? requestedOutline
    : latestOutline ? await getKnowledgeOutline(locationId, latestOutline.id).catch(() => null) : null;
  const sessionKey = agentSessionKey(creation?.record?.id, query.new);
  const hasTranscript = Boolean(value('transcript').trim());
  const contentLinks = links.filter(link => link.kind === "content");
  const otherLinks = links.filter(link => link.kind !== "content");
  const notes = value('notes');
  const summaryNote = value('summary') || record.summary || '';
  const watchedChannel = otherLinks.find(link => link.kind === "channel" && !link.archived);
  const creatorLine = view.creator ? (creator ? <a href={creator.channelUrl} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{view.creator}</a> : <span className="font-medium">{view.creator}</span>) : null;

  const header = <header className="space-y-2">
    <h1 className="text-balance text-xl font-semibold leading-tight tracking-tight md:text-2xl">{record.title}</h1>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"><LibraryPlatformIcon platform={view.platform} />{platformLabels[view.platform]}</span>
      {creatorLine || (active && creator) ? <div className="flex min-w-0 items-center gap-0.5">
        {creatorLine}
        {isSource && creator && (active || watchedChannel) ? <LibrarySourceAction locationId={locationId}
          url={creator.channelUrl} sourceId={recordId} sourceVersion={record.version} savedChannelId={watchedChannel?.id} /> : null}
      </div> : null}
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

  const panelHead = (title: string, status: React.ReactNode, tip?: React.ReactNode, action?: React.ReactNode) => <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{title}</h2>{status}{tip}<div className="ml-auto flex items-center gap-2">{action}</div></div>;

  const quotation = fromAgent?.quote ?? fromKnowledge?.quote;
  const onScreen = fromAgent?.onScreen ?? fromKnowledge?.onScreen ?? false;
  const passage = quotation && !onScreen ? transcriptPassage(value("transcript"), quotation, fromAgent?.offset ?? null) : null;
  const returnToProposal = fromAgent ? `/studio/content/create?draft=${fromAgent.recordId}&${proposalFocusQuery(fromAgent.focus)}` : null;
  const citationPanel = citationRequested ? <section aria-label="Cited passage" className="space-y-2 rounded-lg border bg-card p-4 text-sm">
    <h3 className="font-medium">Cited passage</h3>
    {passage ? <p className="whitespace-pre-wrap break-words leading-relaxed">{passage.before}<mark className="rounded bg-amber-200 text-amber-950 dark:bg-amber-400 dark:text-amber-950">{passage.quote}</mark>{passage.after}</p>
      : quotation ? <>
        <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3">{quotation}</blockquote>
        <p className="text-muted-foreground">{onScreen ? "This quote was saved as on-screen text." : "The saved quote doesn’t match a single passage in the current transcript."}</p>
      </> : <p className="text-muted-foreground">This citation is unavailable. You can still read the source below.</p>}
    {returnToProposal ? <Link href={returnToProposal} className="inline-flex min-h-10 items-center font-medium text-primary underline">Return to proposal</Link> : null}
  </section> : null;

  const transcriptionCard = videoStatus ? <VideoTranscriptionPanel key={recordId} locationId={locationId} recordId={recordId}
    status={videoStatus} hasTranscript={hasTranscript} initialIssue={readVideoNotQueuedReason(query.transcriptionSetup)} /> : null;
  const sourcePanel = <div className="space-y-4">
    <JumpBar items={[{ id: "summary", label: "Summary" }, { id: "details", label: "Details" }, { id: "comments", label: "Comments" },
      { id: "transcript", label: "Transcript" }, { id: "slides", label: "Slides" }, ...(highlights.length ? [{ id: "highlights", label: "Highlights" }] : [])]} />
    <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)] md:items-start">
      <SourcePlayer title={record.title} thumbnail={view.thumbnail} videoId={youtube?.videoId ?? null} url={view.url} portrait={view.portrait} />
      <div className="min-w-0">{header}</div>
    </div>
    {transcriptionCard}
    <SummarySection locationId={locationId} recordId={recordId} view={summary} failure={summaryFailure} evidence={`${hasTranscript ? "t" : ""}${value('description').trim() ? "d" : ""}`} />
    <HighlightsSection />
    {citationPanel}
    <SourceDetailsPanel key={`${locationId}:${recordId}:${view.url}`} locationId={locationId} recordId={recordId} initial={sourceDetails}
      canFetch={active && Boolean(youtube)} youtube={Boolean(youtube)} legacy={videoStatus?.meta ?? null} description={value('description')}
      channelUrl={creator?.channelUrl ?? null} channel={view.creator ?? null} />
    <Section id="transcript" title="Transcript" defaultOpen={hasTranscript || citationRequested} count={hasTranscript ? "Saved" : undefined}>
      <p className="text-xs text-muted-foreground">A transcript is what the video actually says. Check it against the original before relying on its claims.</p>
      {hasTranscript ? <><TranscriptLines text={value('transcript')} videoId={youtube?.videoId ?? null} />
          {value('previousTranscript').trim() ? <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">Earlier saved transcript (replaced by the Mac transcript)</summary><p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">{value('previousTranscript')}</p></details> : null}</>
        : <details id="paste-source-transcript" className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">Paste a transcript instead</summary><div className="mt-3"><LibraryRecordForm locationId={locationId} recordId={recordId} version={record.version} kind={record.kind} title={record.title} payload={record.payload} transcriptOnly /></div></details>}
    </Section>
    {videoStatus?.frames.length && videoStatus.framesFrom ? <VideoSlidesSection status={videoStatus} transcript={value('transcript')} /> : <Section id="slides" title="Slides" defaultOpen={false}><p className="text-sm text-muted-foreground">No slides saved.</p></Section>}
  </div>;
  const scriptPanel = <div className="space-y-4">
    {panelHead("Script", null, <InfoTip label="About scripts">Ideas keep this source linked as research; nothing is copied or approved. Use the assistant's Idea or Script template modes to create them.</InfoTip>)}
    <IdeaPanel locationId={locationId} sourceId={recordId} ideaId={randomUUID()} archived={record.archived} />
    {contentLinks.length ? <ul className="space-y-1 text-sm">{contentLinks.map(linked => <li key={linked.id}><Link className="text-primary hover:underline" href={creation && !linked.archived && linked.stagedSourceId === recordId ? `?mode=create&draft=${linked.id}` : `/studio/content/${linked.id}`}>{linked.title}</Link></li>)}</ul> : <p className="text-sm text-muted-foreground">No ideas or scripts from this source yet.</p>}
    {youtube ? <SourceTemplatePanel locationId={locationId} sourceId={recordId} /> : null}
  </div>;
  const outlinePending = outline?.batches.some(batch => !batch.result && ["queued", "running"].includes(batch.status)) ?? false;
  const knowledgePending = outlinePending || knowledgeAuto?.status === "queued" || knowledgeAuto?.status === "running";
  const knowledgePanel = <div className="space-y-3">
    <h2 className="font-semibold">Knowledge</h2>
    <SourceKnowledgeActions evidence={knowledgeInputs} auto={outline ? null : knowledgeAuto} outlinePending={outlinePending}
      allowExtract={!outline || outline.stale} setupFailed={query.knowledgeSetup === "unavailable"} />
    {outline ? <KnowledgeOutlineDetail outline={outline} query={{}} embedded framesFailed={videoStatus?.latest?.visual_status === "failed"} /> : null}
    {findings.length ? <details open={!outline} className="space-y-2"><summary className="cursor-pointer font-medium">Saved knowledge ({findings.length}{hasMoreFindings ? "+" : ""})</summary>
      <ul className="space-y-2 break-words text-sm">{findings.map(finding => <li key={finding.id}><Link href={`/studio/knowledge/${finding.id}`} className="text-primary hover:underline">{finding.statement}</Link> <span className="text-muted-foreground">({finding.status})</span></li>)}</ul>
      {hasMoreFindings ? <Link href="/studio/knowledge?status=all" className="text-sm text-primary hover:underline">Browse more</Link> : null}
    </details> : null}
  </div>;
  const notesPanel = <NotesPanel locationId={locationId} sourceId={recordId} version={record.version} notes={notes} archived={record.archived} />;
  const moreLinks = <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">Linked records and files</summary><div className="mt-3 space-y-5">{footer}</div></details>;
  const tabs: SourceTab[] = [
    { id: "transcript", label: "Source", panel: sourcePanel },
    ...(active ? [
      { id: "knowledge", label: "Knowledge", pending: knowledgePending, badge: findings.length ? String(findings.length) : undefined, panel: knowledgePanel },
      { id: "script", label: "Script", badge: contentLinks.length ? String(contentLinks.length) : undefined, panel: scriptPanel },
      { id: "related", label: "Related videos", panel: <RelatedYoutubeVideos key={`${locationId}:${recordId}`} anchorId={recordId} /> },
    ] : []),
    { id: "notes", label: "My notes", panel: notesPanel },
    { id: "more", label: "Files", panel: moreLinks },
  ];

  return <SourceWorkspaceProvider startInCreation={Boolean(creation) && query.mode === "create"} draftId={creation?.record?.id}><AgentDraftProvider sourceId={isSource ? recordId : null} recordId={creation?.record?.id ?? null} sessionKey={sessionKey} initialRecord={creation?.record ?? null} initialPlan={creation?.conversation.plan ?? []} initialTarget={creation?.conversation.target ?? null}><main className="mx-auto w-full min-w-0 max-w-7xl space-y-3 p-4 pb-24 md:p-6 lg:pb-6">
    {breadcrumb}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <SourceWorkArea creation={creation && <DraftPanel />}
        research={<HighlightsProvider locationId={locationId} recordId={recordId} initial={highlights}>
          <SourceTabs tabs={tabs} />
        </HighlightsProvider>} />
      <SourceAssistant canCreate={Boolean(creation)} locationId={locationId} sourceId={recordId} sourceTitle={record.title} version={record.version} hasEvidence={hasTranscript || Boolean(value('description').trim())} canRelated={active} archived={record.archived} canTemplate={Boolean(youtube) && hasTranscript} agent={creation ? { source: { id: recordId, version: record.version, title: record.title, hasText: hasTranscript || Boolean(value('description').trim()) }, turns: creation.conversation.turns, focusProposal: focusedProposal, newDraftHref: `/studio/library/${recordId}?mode=create&new=${randomUUID().slice(0, 8)}`, sessionKey, scope: creation.scope, resume: creation.resume ? { id: creation.resume.id, title: creation.resume.title, turns: creation.resume.turns, updatedAt: creation.resume.updatedAt, href: `/studio/library/${recordId}?mode=create&draft=${creation.resume.id}` } : null } : undefined} />
    </div>
  </main></AgentDraftProvider></SourceWorkspaceProvider>;
}
