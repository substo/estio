import { auth } from "@clerk/nextjs/server";
import { agentRouteScope, getAgentConversation } from "@/lib/studio/agent";
import { StudioCommandError } from "@/lib/studio/command-error";
import { expose } from "@/lib/studio/creation";
import { scriptNextAction } from "@/lib/studio/reference-workflow";
import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import { listPendingStudioUploads } from "@/lib/studio/uploads";
import { notFound } from "next/navigation";
import { StudioAttachments } from "../../../_components/studio-attachments";
import { StudioUploadForm } from "../../../_components/studio-upload-form";
import { getStudioContentRecord } from "@/lib/studio/content";
import { getStudioScriptTemplateChoices } from "@/lib/studio/script-templates";
import { ContentWorkspace } from "../../../_components/workspace/content-workspace";
import { getVideoLoopState } from "@/lib/studio/video-loop";
import { getMacVideoStatus, getVideoAssemblyStatus } from "@/lib/studio/video-assembly";
import { getSoundModelState, getVoiceAvailability, listVoices } from "@/lib/studio/voices/service";
import { getGenerationSources, getMotionChoice, getSoundProviderChoices } from "@/lib/studio/voices/sources-store";
import { getStoryboard } from "@/lib/studio/storyboard";
import { getClipSuggestions } from "@/lib/studio/clip-suggestions-server";
import { classifyUpload } from "@/lib/studio/workspace/assets";
import { parseScript } from "@/lib/studio/video-assembly/script";
import { soundKeyAvailability } from "@/lib/studio/voices/sound-keys";
import { pickHostedSound, soundSourceLabel } from "@/lib/studio/voices/sound-providers";
import { resolveSource, type GenerationSources } from "@/lib/studio/voices/sources";
import { RelatedYoutubeVideos } from "../../../_components/related-youtube-videos";

export const dynamic = "force-dynamic";

export default async function StudioContentRecordPage({ params, searchParams }: { params: Promise<{ recordId: string }>; searchParams: Promise<{ mode?: string }> }) {
  const { locationId, recordId } = await studioRouteParams(params);
  const { mode } = await searchParams;
  const result = await getStudioContentRecord(locationId, recordId);
  if (!result) notFound();
  const { access, record, links, files, uploads } = result;
  const session = await auth();
  const writingAgent = !record.archived && !session.actor && session.userId === access.userId
    ? Promise.all([getAgentConversation(locationId, recordId), agentRouteScope(locationId)])
      .then(([conversation, scope]) => ({ ...conversation, scope, record: expose(record) }))
      .catch(error => {
        if (!(error instanceof StudioCommandError && error.status === 403)) {
          console.error("[studio-content] Could not load the writing conversation");
        }
        return null;
      })
    : null;
  const next = scriptNextAction(record, links);
  const inspiration = record.payload.knowledgeInspiration as { outlineId?: unknown; sourceId?: unknown } | undefined;
  const inspirationId = typeof inspiration?.outlineId === "string"
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(inspiration.outlineId)
    && links.some(link => link.id === inspiration.sourceId) ? inspiration.outlineId : null;
  const [assembly, allVoices, availability, loop, mac, sources] = await Promise.all([getVideoAssemblyStatus(locationId, recordId), listVoices(locationId).catch(() => []), getVoiceAvailability(locationId), getVideoLoopState(locationId, recordId), getMacVideoStatus(locationId), getGenerationSources(locationId).catch((): GenerationSources => ({}))]);
  const [soundChoices, soundKeys, soundModels, motion] = await Promise.all([getSoundProviderChoices(locationId), soundKeyAvailability(locationId), getSoundModelState(locationId), getMotionChoice(locationId)]);
  const anyHostedSound = soundKeys.fal || soundKeys.elevenlabs;
  const soundLine = (kind: "music" | "effects") => { const r = resolveSource(kind, sources[kind], { localReady: true, hostedKey: anyHostedSound }); return soundSourceLabel(kind, r.source, pickHostedSound(soundChoices[kind], soundKeys), soundModels[kind]); };
  const soundSources = { music: soundLine("music"), effects: soundLine("effects") };
  const [pendingUploads, templates] = await Promise.all([
    listPendingStudioUploads(locationId, recordId),
    getStudioScriptTemplateChoices(locationId, record.script_template_version_id),
  ]);
  const script = typeof record.payload.script === "string" ? record.payload.script : "";
  const storyboard = script.trim() ? await getStoryboard(locationId, recordId, script).catch(() => null) : null;
  const clips = script.trim() ? await getClipSuggestions(locationId, recordId).catch(() => ({ suggestions: [], videos: 0 })) : { suggestions: [], videos: 0 };
  const assets = uploads.map(u => ({ id: u.id, name: u.original_filename, contentType: u.content_type, byteSize: Number(u.byte_size), createdAt: new Date(u.created_at).toISOString(), status: u.status,
    note: u.transcript ? `Transcribed · ${Math.round(u.transcript.duration_seconds / 60)} min` : null }));
  const pending = pendingUploads.map(u => ({ id: u.id, name: u.original_filename, byteSize: Number(u.byte_size) }));
  const nextSteps = (
    <section aria-label="Script next steps" className="space-y-3 rounded-xl border p-5 text-sm">
      <h2 className="font-medium">Next steps for this piece</h2>
      <p>{next.message}</p>
      {!record.archived && record.payload.creation ? <Link href={`/studio/content/create?draft=${recordId}`} className="inline-flex min-h-11 items-center rounded-md border px-3 font-medium hover:bg-accent">Continue the guided draft</Link> : null}
      {inspirationId ? <Link href={`/studio/knowledge/extractions/${inspirationId}`} className="inline-block text-primary underline">Open cited inspiration</Link> : null}
      <p className="text-muted-foreground">{links.length} outgoing linked records · {links.filter(link => link.hasScriptEvidence).length} with text available to the script service. Evidence availability is not factual verification or approval.</p>
      {!record.archived ? <div className="flex flex-wrap gap-4">
        {next.kind === "generate" && !record.payload.creation ? <Link href={`/studio/content/${recordId}/script-briefs`} className="text-primary hover:underline">Generate a source-backed script brief</Link> : null}
        <Link href={`/studio/records/${recordId}/links?kind=reference`} className="text-primary hover:underline">Choose research / optional reference videos</Link>
        <Link href="/studio/library" className="text-primary hover:underline">Browse or save another source</Link>
      </div> : null}
      <p className="text-muted-foreground">For filming, include the final script, shot instructions, on-screen examples and any claims still needing verification.</p>
    </section>
  );
  const detailsExtra = (
    <div className="space-y-6">
      {nextSteps}
      {!record.archived && record.payload.stage === "idea" ? <RelatedYoutubeVideos key={`${locationId}:${recordId}`} anchorId={recordId} /> : null}
      {!record.archived ? <Link href={`/studio/records/${recordId}/extract`} className="mr-4 inline-block text-sm text-primary hover:underline">Extract knowledge from saved text</Link> : null}
      <Link href={`/studio/records/${recordId}/links`} className="inline-block text-sm text-primary hover:underline">Manage linked records</Link>
      {links.length ? <section className="space-y-2"><h2 className="font-medium">Linked research and content</h2><ul className="space-y-2 text-sm">{links.map(linked => <li key={linked.id}><Link className="text-primary hover:underline" href={`/studio/${linked.kind === "content" ? "content" : "library"}/${linked.id}`}>{linked.title}</Link><span className="ml-2 text-muted-foreground">{linked.kind}</span></li>)}</ul></section> : null}
      <StudioAttachments locationId={locationId} files={files} />
    </div>
  );
  return (
    <ContentWorkspace locationId={locationId} recordId={recordId} title={record.title} archived={record.archived} hasScript={Boolean(script.trim())} initialMode={mode ?? null}
      form={{ locationId, recordId, version: record.version, title: record.title, payload: record.payload, templateOptions: templates.options, pinnedTemplateId: record.script_template_version_id,
        templateSelectionSaved: record.script_template_selected, canSelectTemplate: templates.canSelect && !record.archived, voices: allVoices, locked: record.archived,
        quoteMedia: assets.filter(file => file.status === "uploaded" && file.contentType.startsWith("video/") && classifyUpload(file.name) === "footage").map(({ id, name }) => ({ id, name })) }}
      uploads={assets} pending={pending} loop={loop} assembly={assembly.view} narration={assembly.narration} mac={mac} voices={allVoices} availability={availability} soundSources={soundSources} motion={motion} beats={parseScript(script).map(b => b.narration)}
      uploadSlot={<StudioUploadForm key={recordId} compact locationId={locationId} recordId={recordId} pendingUploads={pendingUploads}
        attention={assets.filter(a => a.status !== "uploaded").map(a => ({ id: a.id, name: a.name, why: "Upload did not finish" }))} />}
      nextSteps={nextSteps} detailsExtra={detailsExtra} writingAgent={await writingAgent} storyboard={storyboard} clips={clips} />
  );
}
