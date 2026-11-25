"use client";
import Link from "next/link";
import { useActionState, useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hostedOptions, pickHostedSound, soundProvider, type HostedSoundProvider, type SoundKeys, type SoundKind } from "@/lib/studio/voices/sound-providers";
import { removeFalKeyAction, saveFalKeyAction, setSoundProviderAction } from "../actions";

type State = { error?: string; notice?: string };
const kindWord: Record<SoundKind, string> = { music: "music", effects: "sound effects" };
function FalKeyForm({ locationId, hint }: { locationId: string; hint: string | null }) {
  const [state, action, pending] = useActionState(saveFalKeyAction.bind(null, locationId), {} as State);
  const [removed, remove, removing] = useActionState(removeFalKeyAction.bind(null, locationId), {} as State);
  const id = useId();
  return <div className="space-y-2 rounded-md border bg-muted/30 p-3">
    <form action={action} className="space-y-2">
      <Label htmlFor={`${id}-fal`}>{hint ? `Replace fal.ai API key (ends ${hint})` : "fal.ai API key"}</Label>
      <Input id={`${id}-fal`} name="apiKey" type="password" autoComplete="off" spellCheck={false} required aria-describedby={`${id}-fal-help`} />
      <p id={`${id}-fal-help`} className="text-xs text-muted-foreground">Create one at fal.ai (Dashboard, Keys). It is checked with fal.ai and stored encrypted for this workspace. Each clip is billed to your fal.ai account.</p>
      {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : state.notice ? <p role="status" className="text-sm text-muted-foreground">{state.notice}</p> : null}
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Checking…" : "Save key"}</Button>
    </form>
    {removed.error ? <p role="alert" className="text-sm text-destructive">{removed.error}</p> : null}
    {hint ? <form action={remove}><Button type="submit" variant="link" size="sm" className="h-auto px-0 text-destructive" disabled={removing}>{removing ? "Removing…" : "Remove key"}</Button></form> : null}
  </div>;
}

/** Under a music or sound-effects row: what makes it on this Mac (and whether the model is installed), or which hosted provider to use, with price, free tier and key state. */
export function SoundProviderPanel({ locationId, kind, effective, canManage, chosen, keys, falHint, modelInstalled }: {
  locationId: string; kind: SoundKind; effective: "local" | "hosted" | "none"; canManage: boolean;
  chosen: HostedSoundProvider | undefined; keys: SoundKeys; falHint: string | null; modelInstalled: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  if (effective === "local" || effective === "none") {
    const model = soundProvider("stable-audio-3-small")!;
    return <div className="mt-2 space-y-1 text-xs text-muted-foreground">
      <p>{modelInstalled ? `Made with ${model.label.replace(" (this Mac)", "")} on this Mac.` : "Made with the built-in synth on this Mac: free and instant, but basic."}</p>
      {!modelInstalled ? <p>For real {kindWord[kind]} on this Mac, install Stable Audio 3 Small (free to run, about 3.5 GB, tight on 8 GB of memory). You accept Stability AI&apos;s and Google&apos;s terms when you install it. <Link className="text-primary hover:underline" href="/settings/computer">Install it on your Mac</Link>.</p> : null}
    </div>;
  }
  const active = pickHostedSound(chosen, keys);
  return <div className="mt-2 space-y-2">
    <div role="radiogroup" aria-label={`Hosted provider for ${kindWord[kind]}`} className="grid gap-2 sm:grid-cols-2">
      {hostedOptions(kind).map(p => {
        const on = active === p.id, hasKey = keys[p.id];
        return <button key={p.id} type="button" role="radio" aria-checked={on} disabled={!canManage || pending}
          onClick={() => { setError(""); start(async () => { const r = await setSoundProviderAction(locationId, kind, p.id, {}); if (r.error) setError(r.error); }); }}
          className={`min-h-11 rounded-md border p-2 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${on ? "border-primary bg-primary/5" : "bg-background hover:bg-muted"}`}>
          <span className="block font-medium">{p.label}{hasKey ? "" : " (add a key)"}</span>
          <span className="block text-xs text-muted-foreground">{p.price}</span>
          <span className="block text-xs text-muted-foreground">{p.freeTier}</span>
        </button>;
      })}
    </div>
    {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    {active === null && !keys.fal ? <p className="text-xs text-muted-foreground">No hosted key yet: add one below, or the Mac makes it instead.</p> : null}
    {canManage ? <FalKeyForm locationId={locationId} hint={falHint} /> : null}
    {!keys.elevenlabs ? <p className="text-xs text-muted-foreground">An ElevenLabs key is added in <Link className="text-primary hover:underline" href="/settings/ai/voice">Settings → AI → Voice</Link>.</p> : null}
  </div>;
}
