"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { GENERATION_KINDS, kindLabels, resolveSource, type GenerationKind, type GenerationSources, type SourceChoice } from "@/lib/studio/voices/sources";
import type { HostedSoundProvider, SoundProviderChoices } from "@/lib/studio/voices/sound-providers";
import { setGenerationSourceAction, setSoundProviderAction, testSoundAction } from "../actions";

const hints: Record<GenerationKind, string> = {
  voice: "Narration for your videos. A voice you pick for a video can still be from either provider.",
  music: "The instrumental bed under the video.",
  effects: "Short sounds such as a soft whoosh on titles.",
};
export interface HostedOffer { id: string; label: string }
type Pick = { source: SourceChoice | "auto"; provider?: string };

function ActionCard({ locationId, kind, choice, provider, offers, localReady, modelInstalled, canManage }: {
  locationId: string; kind: GenerationKind; choice: SourceChoice | undefined; provider: HostedSoundProvider | undefined; offers: HostedOffer[]; localReady: boolean; modelInstalled: boolean; canManage: boolean;
}) {
  const [pick, setPick] = useState<Pick>({ source: choice ?? "auto", provider: provider ?? offers[0]?.id });
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [test, setTest] = useState<{ ok: boolean; message: string; ms: number; dataUrl?: string } | null>(null);
  const effective = resolveSource(kind, pick.source === "auto" ? undefined : pick.source, { localReady, hostedKey: offers.length > 0 });
  const hostedProvider = effective.source === "hosted" ? (offers.find(o => o.id === pick.provider) ?? offers[0]) : undefined;
  const options: { key: string; label: string; apply: () => Pick }[] = [
    { key: "auto", label: "Automatic", apply: () => ({ source: "auto", provider: pick.provider }) },
    { key: "local", label: "On this Mac", apply: () => ({ source: "local", provider: pick.provider }) },
    ...(kind === "voice" ? (offers.length ? [{ key: "hosted", label: offers.map(o => o.label).join(" or "), apply: () => ({ source: "hosted" as const, provider: pick.provider }) }] : [])
      : offers.map(o => ({ key: `hosted:${o.id}`, label: o.label, apply: () => ({ source: "hosted" as const, provider: o.id }) }))),
  ];
  const activeKey = pick.source === "auto" ? "auto" : pick.source === "local" ? "local" : kind === "voice" ? "hosted" : `hosted:${hostedProvider?.id ?? pick.provider}`;
  const choose = (o: (typeof options)[number]) => {
    const previous = pick, next = o.apply(); setPick(next); setError(""); setTest(null);
    start(async () => {
      const a = await setGenerationSourceAction(locationId, kind, next.source, {});
      if (a.error) { setPick(previous); setError(a.error); return; }
      if (kind !== "voice" && next.source === "hosted" && next.provider) { const b = await setSoundProviderAction(locationId, kind, next.provider, {}); if (b.error) { setPick(previous); setError(b.error); } }
    });
  };
  const canTest = kind !== "voice" && effective.source === "hosted" && hostedProvider;
  return <li className="space-y-2 rounded-lg border p-4">
    <div><h3 className="font-medium">{kindLabels[kind]}</h3><p className="text-xs text-muted-foreground">{hints[kind]}</p></div>
    <div role="radiogroup" aria-label={`${kindLabels[kind]} source`} className="flex flex-wrap gap-2">
      {options.map(o => { const active = o.key === activeKey;
        return <button key={o.key} type="button" role="radio" aria-checked={active} disabled={!canManage} onClick={() => choose(o)}
          className={`min-h-11 rounded-md border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>{o.label}</button>; })}
    </div>
    <p className="text-xs text-muted-foreground" aria-live="polite">{pick.source === "auto" ? "Automatic: " : ""}{effective.source === "hosted" && hostedProvider && kind !== "voice" ? `${kindLabels[kind]}: ${hostedProvider.label}` : effective.label}{pending ? " · saving…" : ""}</p>
    {offers.length === 0 ? <p className="text-xs text-muted-foreground">No hosted platform is connected and switched on for this. <Link href="/settings/ai/connections" className="text-primary hover:underline">Connections</Link></p> : null}
    {effective.source === "local" && kind !== "voice" ? <p className="text-xs text-muted-foreground">{modelInstalled ? "Made with Stable Audio 3 Small on this Mac." : <>Made with the built-in synth on this Mac: free and instant, but basic. For real {kind === "music" ? "music" : "sound effects"}, <Link className="text-primary hover:underline" href="/settings/computer">install Stable Audio 3 Small on your Mac</Link> (about 3.5 GB; you accept Stability AI&apos;s and Google&apos;s terms).</>}</p> : null}
    <p className="text-xs text-muted-foreground">{kind === "voice" ? "If a provider fails, the video page shows its reason." : "If the platform fails or has no credit, the video is still made: this is made on this Mac instead."}</p>
    {canTest && canManage ? <div className="space-y-1">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => start(async () => setTest(await testSoundAction(locationId, kind, hostedProvider.id)))}>Test (one short clip)</Button>
      {test ? test.ok && test.dataUrl ? <div className="space-y-1"><audio controls src={test.dataUrl} className="w-full max-w-sm" /><p className="text-xs text-muted-foreground">Made in {(test.ms / 1000).toFixed(1)} s with {hostedProvider.label}.</p></div> : <p role="alert" className="text-sm text-destructive">{test.message}</p> : null}
    </div> : null}
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
  </li>;
}

/** Where each kind of audio is made. The hosted choices are only the platforms you have connected and switched on for it; the change shows at once and saves in the background. */
export function AudioActions({ locationId, kinds, sources, soundChoices, canManage, offers, localVoice, modelInstalled }: {
  locationId: string; kinds: GenerationKind[]; sources: GenerationSources; soundChoices: SoundProviderChoices; canManage: boolean;
  offers: Record<GenerationKind, HostedOffer[]>; localVoice: boolean; modelInstalled: { music: boolean; effects: boolean };
}) {
  return <section aria-label="What makes it" className="space-y-2"><h2 className="text-base font-semibold">What makes it</h2>
    <ul className="space-y-3">{GENERATION_KINDS.filter(k => kinds.includes(k)).map(kind => <ActionCard key={kind} locationId={locationId} kind={kind} choice={sources[kind]} provider={kind === "voice" ? undefined : soundChoices[kind] as HostedSoundProvider | undefined}
      offers={offers[kind]} localReady={kind === "voice" ? localVoice : true} modelInstalled={kind === "voice" ? false : modelInstalled[kind]} canManage={canManage} />)}</ul>
  </section>;
}
