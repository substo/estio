import Link from "next/link";
import { notFound } from "next/navigation";
import { getVoiceKeySummary } from "@/lib/studio/voices/keys";
import { ensureLocalVoices, getVoiceAvailability, listVoices } from "@/lib/studio/voices/service";
import { requireSettingsContext } from "../_components/context";
import { CreateVoice } from "./create-voice";
import { VoiceLibrary } from "./voice-library";

export const dynamic = "force-dynamic";
export const metadata = { title: "Voices" };

export default async function VoicesPage() {
  const { locationId, access, tenantHost } = await requireSettingsContext();
  if (tenantHost) notFound();
  if (!locationId || !access) return null;
  const [first, keys, availability] = await Promise.all([listVoices(locationId), getVoiceKeySummary(locationId), getVoiceAvailability(locationId)]);
  const canManage = keys?.canManage === true;
  // The on-device speakers need no key: list them the first time an admin opens the page.
  const voices = canManage && !first.some(v => v.provider === "local") ? await ensureLocalVoices(locationId).then(() => listVoices(locationId)).catch(() => first) : first;
  const connected = (["fish", "elevenlabs"] as const).filter(p => keys?.keys[p]);
  return <main className="max-w-3xl space-y-4">
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">Voices</h1>
      <p className="text-sm text-muted-foreground">The voices your videos can use. Set a default once; you can still pick another voice for each video. Hosted voices are billed to your own provider account. Keys are in <Link className="text-primary hover:underline" href="/settings/ai">Settings → AI</Link>; the on-device model is in <Link className="text-primary hover:underline" href="/settings/computer">Devices</Link>.</p>
    </div>
    <VoiceLibrary locationId={locationId} voices={voices} availability={availability} canManage={canManage} connected={[...connected]} />
    {canManage ? <CreateVoice locationId={locationId} providers={[...connected]} local={availability.local} /> : null}
  </main>;
}
