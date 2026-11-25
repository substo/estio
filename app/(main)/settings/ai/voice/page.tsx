import Link from "next/link";
import { VoiceProviderKeys } from "@/components/ai-settings/voice-key-forms";
import { getVoiceKeySummary } from "@/lib/studio/voices/keys";
import { requireSettingsContext } from "../../_components/context";
import { AiTypeNav } from "../_components/ai-type-nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI settings: Voice" };

export default async function AiVoicePage() {
  const { locationId } = await requireSettingsContext();
  if (!locationId) return null;
  const voice = await getVoiceKeySummary(locationId).catch(() => null);
  return <main className="max-w-3xl space-y-4">
    <h1 className="text-2xl font-semibold tracking-tight">AI settings</h1>
    <AiTypeNav />
    <p className="text-sm text-muted-foreground">Providers that speak your scripts. Where narration is made (this Mac or a hosted provider) is chosen under <Link className="text-primary hover:underline" href="/settings/ai/audio">Music and sound effects</Link>; the voices themselves are chosen, recorded and cloned in <Link className="text-primary hover:underline" href="/settings/voices">Voices</Link>.</p>
    {voice ? <VoiceProviderKeys locationId={locationId} canManage={voice.canManage} hints={{ fish: voice.keys.fish?.keyHint ?? null, elevenlabs: voice.keys.elevenlabs?.keyHint ?? null }} /> : <p className="text-sm text-muted-foreground">You do not have access to these settings.</p>}
  </main>;
}
