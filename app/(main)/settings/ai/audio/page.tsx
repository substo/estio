import { offersFor } from "@/lib/studio/ai/connections";
import { getConnections } from "@/lib/studio/ai/connections-store";
import { getSoundModelState, getVoiceAvailability } from "@/lib/studio/voices/service";
import { getGenerationSources, getSoundProviderChoices } from "@/lib/studio/voices/sources-store";
import { requireSettingsContext } from "../../_components/context";
import { AiTypeNav } from "../_components/ai-type-nav";
import { AudioActions } from "../_components/audio-actions";
import { PlatformStatus } from "../_components/platform-status";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI settings: Music and sound effects" };
const soundLabel: Record<string, string> = { fal: "fal.ai (Stable Audio 3 Small)", elevenlabs: "ElevenLabs" };

export default async function AiAudioPage() {
  const { locationId } = await requireSettingsContext();
  if (!locationId) return null;
  const [view, sources, soundChoices, soundModels] = await Promise.all([getConnections(locationId), getGenerationSources(locationId), getSoundProviderChoices(locationId), getSoundModelState(locationId)]);
  const connected = Object.fromEntries(view.states.map(s => [s.id, Boolean(s.hint)]));
  const hosted = (c: "music" | "effects") => [...new Map(offersFor(c, connected, view.prefs).map(o => [o.platform, { id: o.platform, label: soundLabel[o.platform] ?? o.platform }])).values()];
  return <main className="max-w-3xl space-y-4">
    <h1 className="text-2xl font-semibold tracking-tight">AI settings</h1>
    <AiTypeNav />
    <p className="text-sm text-muted-foreground">Background music and sound effects for made videos. Hosted generation is billed to your own provider account.</p>
    <PlatformStatus capabilities={["music", "effects"]} states={view.states} prefs={view.prefs} />
    <AudioActions locationId={locationId} kinds={["music", "effects"]} sources={sources} soundChoices={soundChoices} canManage={view.canManage}
      offers={{ voice: [], music: hosted("music"), effects: hosted("effects") }} localVoice modelInstalled={soundModels} />
  </main>;
}
