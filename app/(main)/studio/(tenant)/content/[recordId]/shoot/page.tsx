import { notFound } from "next/navigation";
import { studioRouteParams } from "@/lib/studio/route-context";
import { getStudioContentRecord } from "@/lib/studio/content";
import { getMacVideoStatus, getVideoAssemblyStatus } from "@/lib/studio/video-assembly";
import { videoAssemblyStatusLine } from "@/lib/studio/video-assembly-policy";
import { getVideoLoopState } from "@/lib/studio/video-loop";
import { getSoundModelState, getVoiceAvailability, listVoices } from "@/lib/studio/voices/service";
import { getGenerationSources, getMotionChoice, getSoundProviderChoices } from "@/lib/studio/voices/sources-store";
import { soundKeyAvailability } from "@/lib/studio/voices/sound-keys";
import { pickHostedSound, soundSourceLabel } from "@/lib/studio/voices/sound-providers";
import { resolveSource, type GenerationSources } from "@/lib/studio/voices/sources";
import { parseScript } from "@/lib/studio/video-assembly/script";
import { jobStepper } from "@/lib/studio/workspace/stepper";
import { ShootBoard } from "../../../../_components/shoot/shoot-board";

export const dynamic = "force-dynamic";

/** Film the script clip by clip: record in the browser or upload from a phone, then make the video from those shots. */
export default async function StudioShootPage({ params }: { params: Promise<{ recordId: string }> }) {
  const { locationId, recordId } = await studioRouteParams(params);
  const result = await getStudioContentRecord(locationId, recordId);
  if (!result) notFound();
  const { record, uploads } = result;
  const script = typeof record.payload.script === "string" ? record.payload.script : "";
  const [assembly, voices, availability, loop, mac, sources, soundChoices, soundKeys, soundModels, motion] = await Promise.all([
    getVideoAssemblyStatus(locationId, recordId), listVoices(locationId).catch(() => []), getVoiceAvailability(locationId), getVideoLoopState(locationId, recordId), getMacVideoStatus(locationId),
    getGenerationSources(locationId).catch((): GenerationSources => ({})), getSoundProviderChoices(locationId), soundKeyAvailability(locationId), getSoundModelState(locationId), getMotionChoice(locationId)]);
  const anyHostedSound = soundKeys.fal || soundKeys.elevenlabs;
  const soundLine = (kind: "music" | "effects") => { const r = resolveSource(kind, sources[kind], { localReady: true, hostedKey: anyHostedSound }); return soundSourceLabel(kind, r.source, pickHostedSound(soundChoices[kind], soundKeys), soundModels[kind]); };
  const steps = jobStepper({ narration: assembly.narration, assembly: assembly.view });
  const busy = Boolean(loop?.busy) || steps?.some(s => s.state === "active") === true;
  const files = uploads.filter(u => u.status === "uploaded" && u.content_type.startsWith("video/")).map(u => ({ id: u.id, name: u.original_filename, byteSize: Number(u.byte_size) }));
  return (
    <ShootBoard locationId={locationId} recordId={recordId} title={record.title} beats={parseScript(script)} files={files} archived={record.archived} busy={busy}
      statusLine={videoAssemblyStatusLine(assembly.view, assembly.macOnline, assembly.narration)} hasVideo={Boolean(loop?.versions.length)}
      makeProps={{ voices, availability, soundSources: { music: soundLine("music"), effects: soundLine("effects") }, motion }} />
  );
}
