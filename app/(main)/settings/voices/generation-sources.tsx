"use client";
import { useState, useTransition } from "react";
import { GENERATION_KINDS, hostedProviderLabel, kindLabels, resolveSource, type GenerationKind, type GenerationSources, type SourceChoice } from "@/lib/studio/voices/sources";
import type { HostedSoundProvider, SoundKeys, SoundProviderChoices } from "@/lib/studio/voices/sound-providers";
import { setGenerationSourceAction } from "./actions";
import { SoundProviderPanel } from "./sound-provider-panel";

export interface SoundPanelData { choices: SoundProviderChoices; keys: SoundKeys; falHint: string | null; models: { music: boolean; effects: boolean } }

const hints: Record<GenerationKind, string> = {
  voice: "Narration for your videos. A voice you pick for a video can still be from either.",
  music: "The instrumental bed under the video.",
  effects: "Short sounds such as a soft whoosh on titles.",
};
function Row({ locationId, kind, choice, canManage, localReady, hostedKey, sound }: { locationId: string; kind: GenerationKind; choice: SourceChoice | undefined; canManage: boolean; localReady: boolean; hostedKey: boolean; sound: SoundPanelData }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const effective = resolveSource(kind, choice, { localReady, hostedKey });
  const options: { value: SourceChoice | "auto"; label: string }[] = [
    { value: "auto", label: "Automatic" }, { value: "local", label: "On this Mac" }, { value: "hosted", label: hostedKey ? hostedProviderLabel[kind] : `${hostedProviderLabel[kind]} (add a key)` }];
  return (
    <div className="grid gap-1 border-t py-3 sm:grid-cols-[10rem_1fr] sm:items-center">
      <div><p className="text-sm font-medium">{kindLabels[kind]}</p><p className="text-xs text-muted-foreground">{hints[kind]}</p></div>
      <div>
        <div role="radiogroup" aria-label={`${kindLabels[kind]} source`} className="flex flex-wrap gap-2">
          {options.map(o => {
            const active = (choice ?? "auto") === o.value;
            return <button key={o.value} type="button" role="radio" aria-checked={active} disabled={!canManage || pending}
              onClick={() => { setError(""); start(async () => { const r = await setGenerationSourceAction(locationId, kind, o.value, {}); if (r.error) setError(r.error); }); }}
              className={`min-h-11 rounded-md border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${active ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>{o.label}</button>;
          })}
        </div>
        <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">{choice ? "" : "Automatic: "}{effective.label}{effective.source === "hosted" && !hostedKey ? ". Add a key in Settings → AI." : ""}</p>
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        {kind !== "voice" ? <SoundProviderPanel locationId={locationId} kind={kind} effective={effective.source} canManage={canManage} chosen={sound.choices[kind] as HostedSoundProvider | undefined} keys={sound.keys} falHint={sound.falHint} modelInstalled={sound.models[kind]} /> : null}
      </div>
    </div>
  );
}
export function GenerationSourcesCard({ locationId, sources, canManage, hostedKey, localVoice, sound }: { locationId: string; sources: GenerationSources; canManage: boolean; hostedKey: Record<GenerationKind, boolean>; localVoice: boolean; sound: SoundPanelData }) {
  return (
    <section aria-labelledby="gen-sources" className="rounded-lg border p-4">
      <h2 id="gen-sources" className="text-base font-semibold">Where audio is made</h2>
      <p className="mb-1 text-sm text-muted-foreground">Choose per kind. Automatic uses this Mac when it can, otherwise your hosted key. Hosted generation is billed to your own provider account and may be limited on a free plan.</p>
      {GENERATION_KINDS.map(kind => <Row key={kind} locationId={locationId} kind={kind} choice={sources[kind]} canManage={canManage} localReady={kind === "voice" ? localVoice : true} hostedKey={hostedKey[kind]} sound={sound} />)}
    </section>
  );
}
