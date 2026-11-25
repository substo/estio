import Link from "next/link";
import { offersFor } from "@/lib/studio/ai/connections";
import { getConnections } from "@/lib/studio/ai/connections-store";
import { getVoiceAvailability } from "@/lib/studio/voices/service";
import { getGenerationSources, getSoundProviderChoices } from "@/lib/studio/voices/sources-store";
import { requireSettingsContext } from "../../_components/context";
import { AiTypeNav } from "../_components/ai-type-nav";
import { AudioActions } from "../_components/audio-actions";
import { PlatformStatus } from "../_components/platform-status";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI settings: Voice" };
const label: Record<string, string> = { elevenlabs: "ElevenLabs", fish: "Fish Audio" };

export default async function AiVoicePage() {
  const { locationId } = await requireSettingsContext();
  if (!locationId) return null;
  const [view, availability, sources, soundChoices] = await Promise.all([getConnections(locationId), getVoiceAvailability(locationId), getGenerationSources(locationId), getSoundProviderChoices(locationId)]);
  const connected = Object.fromEntries(view.states.map(s => [s.id, Boolean(s.hint)]));
  const voiceOffers = [...new Map(offersFor("voice", connected, view.prefs).map(o => [o.platform, { id: o.platform, label: label[o.platform] ?? o.platform }])).values()];
  return <main className="max-w-3xl space-y-4">
    <h1 className="text-2xl font-semibold tracking-tight">AI settings</h1>
    <AiTypeNav />
    <p className="text-sm text-muted-foreground">Who speaks your scripts. The voices themselves are chosen, recorded and cloned in <Link className="text-primary hover:underline" href="/settings/voices">Voices</Link>.</p>
    <PlatformStatus capabilities={["voice"]} states={view.states} prefs={view.prefs} />
    <AudioActions locationId={locationId} kinds={["voice"]} sources={sources} soundChoices={soundChoices} canManage={view.canManage}
      offers={{ voice: voiceOffers, music: [], effects: [] }} localVoice={availability.local === "ready"} modelInstalled={{ music: false, effects: false }} />
  </main>;
}
