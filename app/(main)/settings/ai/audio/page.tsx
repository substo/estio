import { getVoiceKeySummary } from "@/lib/studio/voices/keys";
import { getSoundModelState, getVoiceAvailability } from "@/lib/studio/voices/service";
import { getGenerationSources, getSoundProviderChoices } from "@/lib/studio/voices/sources-store";
import { getFalKeyHint, soundKeyAvailability } from "@/lib/studio/voices/sound-keys";
import { requireSettingsContext } from "../../_components/context";
import { AiTypeNav } from "../_components/ai-type-nav";
import { GenerationSourcesCard } from "../_components/generation-sources";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI settings: Music and sound effects" };

export default async function AiAudioPage() {
  const { locationId } = await requireSettingsContext();
  if (!locationId) return null;
  const [keys, availability, sources, soundChoices, soundKeys, falHint, soundModels] = await Promise.all([getVoiceKeySummary(locationId), getVoiceAvailability(locationId), getGenerationSources(locationId), getSoundProviderChoices(locationId), soundKeyAvailability(locationId), getFalKeyHint(locationId), getSoundModelState(locationId)]);
  return <main className="max-w-3xl space-y-4">
    <h1 className="text-2xl font-semibold tracking-tight">AI settings</h1>
    <AiTypeNav />
    <GenerationSourcesCard locationId={locationId} sources={sources} canManage={keys?.canManage === true}
      hostedKey={{ voice: Boolean(keys?.keys.elevenlabs || keys?.keys.fish), music: soundKeys.fal || soundKeys.elevenlabs, effects: soundKeys.fal || soundKeys.elevenlabs }}
      sound={{ choices: soundChoices, keys: soundKeys, falHint, models: soundModels }} localVoice={availability.local === "ready"} />
  </main>;
}
