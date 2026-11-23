import Link from "next/link";
import { notFound } from "next/navigation";
import { studioRouteParams } from "@/lib/studio/route-context";
import { getStudioAccess } from "@/lib/studio/access";
import { getVoiceKeySummary } from "@/lib/studio/voices/keys";
import { ensureLocalVoices, listVoices } from "@/lib/studio/voices/service";
import { hostedVoiceNote, providerLabels, type VoiceProvider } from "@/lib/studio/voices/policy";
import { AddVoice, RefreshButton, VoiceRowActions } from "./voice-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Voices" };

export default async function VoicesPage({ params }: { params: Promise<{}> }) {
  const { locationId } = await studioRouteParams(params);
  if (!await getStudioAccess(locationId)) notFound();
  const [first, keys] = await Promise.all([listVoices(locationId), getVoiceKeySummary(locationId)]);
  const canManage = keys?.canManage === true;
  // The on-device speakers need no key: list them the first time an admin opens the page.
  const voices = canManage && !first.some(v => v.provider === "local") ? await ensureLocalVoices(locationId).then(() => listVoices(locationId)).catch(() => first) : first;
  const connected = (["fish", "elevenlabs"] as const).filter(p => keys?.keys[p]);
  return <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10">
    <Link href="/studio" className="text-sm text-primary hover:underline">Studio overview</Link>
    <h1 className="text-3xl font-semibold">Voices</h1>
    <p className="text-sm text-muted-foreground">The voices your videos can use. Pick a default, preview a voice, or clone one from a sample. {hostedVoiceNote} Keys are managed in <Link className="text-primary hover:underline" href="/settings/ai">AI settings</Link>.</p>
    {voices.length ? <ul aria-label="Voices" className="divide-y rounded-xl border">
      {voices.map(v => <li key={v.id} className="space-y-2 p-4 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-3"><span className="font-medium">{v.name}</span>
          <span className="text-muted-foreground">{providerLabels[v.provider as VoiceProvider]}{v.kind === "clone" ? " · cloned" : ""}{v.language ? ` · ${v.language}` : ""}{v.persona ? ` · ${v.persona}` : ""}</span>
          {v.isDefault ? <span className="rounded-full border px-2 text-xs">Default</span> : null}</div>
        <VoiceRowActions locationId={locationId} voice={v} canManage={canManage} />
      </li>)}
    </ul> : <p className="rounded-xl border p-4 text-sm text-muted-foreground">No voices yet. {canManage ? "Add a provider key in AI settings and refresh, or use the built-in voices on your Mac." : "Ask a workspace admin to set up voices."}</p>}
    {canManage ? <div className="flex flex-wrap gap-3">
      {connected.map(p => <RefreshButton key={p} locationId={locationId} provider={p} />)}
      <RefreshButton locationId={locationId} provider="local" />
    </div> : null}
    {canManage ? <AddVoice locationId={locationId} providers={[...connected]} /> : null}
  </main>;
}
