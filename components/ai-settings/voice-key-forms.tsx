"use client";
import Link from "next/link";
import { useActionState, useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { providerLabels, type HostedVoiceProvider } from "@/lib/studio/voices/policy";
import { removeVoiceKeyAction, saveVoiceKeyAction } from "./voice-actions";

type State = { error?: string; saved?: string };
function Status({ state }: { state: State }) {
  if (state.error) return <p role="alert" className="text-sm text-destructive">{state.error}</p>;
  return state.saved ? <p role="status" className="text-sm text-muted-foreground">{state.saved}</p> : null;
}
function VoiceKeyForm({ locationId, provider, keyHint }: { locationId: string; provider: HostedVoiceProvider; keyHint: string | null }) {
  const name = providerLabels[provider];
  const [state, action, pending] = useActionState(saveVoiceKeyAction.bind(null, locationId, provider), {} as State);
  const [removeState, remove, removing] = useActionState(removeVoiceKeyAction.bind(null, locationId, provider), {} as State);
  const id = useId();
  return <div className="space-y-2">
    <form action={action} className="space-y-2">
      <Label htmlFor={`${id}-key`}>{keyHint ? `Replace ${name} API key (ends ${keyHint})` : `${name} API key`}</Label>
      <Input id={`${id}-key`} name="apiKey" type="password" autoComplete="off" spellCheck={false} required aria-describedby={`${id}-help`} />
      <p id={`${id}-help`} className="text-xs text-muted-foreground">Verified with {name} and stored encrypted. Narration is billed to your {name} account.</p>
      <Status state={state} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Checking…" : "Save key"}</Button>
    </form>
    <Status state={removeState} />
    {keyHint ? <form action={remove}><Button type="submit" variant="link" size="sm" className="h-auto px-0 text-destructive" disabled={removing}>{removing ? "Removing…" : "Remove key"}</Button></form> : null}
  </div>;
}

/** Voice providers: a Location connects its own Fish Audio and/or ElevenLabs key. Compact and disclosed under AI settings. */
export function VoiceProviderKeys({ locationId, hints, canManage }: { locationId: string; hints: Record<HostedVoiceProvider, string | null>; canManage: boolean }) {
  return <section aria-label="Voice providers" className="rounded-xl border p-4">
    <details>
      <summary className="min-h-11 cursor-pointer text-sm font-medium leading-[2.75rem]">Voice providers (narration for videos){hints.fish || hints.elevenlabs ? " · connected" : ""}</summary>
      <div className="mt-3 space-y-5">
        <p className="text-sm text-muted-foreground">Connect your own Fish Audio or ElevenLabs account to generate narration and clone voices. Choose and manage voices in <Link className="text-primary hover:underline" href="/studio/voices">Studio → Voices</Link>.</p>
        {canManage ? (["fish", "elevenlabs"] as const).map(p => <VoiceKeyForm key={p} locationId={locationId} provider={p} keyHint={hints[p]} />)
          : <p className="text-sm text-muted-foreground">Only a workspace admin can change voice provider keys.</p>}
      </div>
    </details>
  </section>;
}
