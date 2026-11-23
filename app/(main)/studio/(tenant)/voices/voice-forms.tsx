"use client";
import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CLONE_CONSENT_STATEMENT, providerLabels, type VoiceRow } from "@/lib/studio/voices/policy";
import { deleteVoiceAction, refreshVoicesAction, setDefaultVoiceAction } from "./actions";

type State = { error?: string; notice?: string };
const button = "inline-flex min-h-11 items-center rounded-md border px-3 font-medium hover:bg-accent disabled:opacity-60";
const Say = ({ s }: { s: State }) => s.error ? <p role="alert" className="text-destructive">{s.error}</p> : s.notice ? <p role="status" className="text-muted-foreground">{s.notice}</p> : null;

export function VoiceRowActions({ locationId, voice, canManage }: { locationId: string; voice: VoiceRow; canManage: boolean }) {
  const [def, setDef, settingDef] = useActionState(setDefaultVoiceAction.bind(null, locationId, voice.id), {} as State);
  const [del, remove, removing] = useActionState(deleteVoiceAction.bind(null, locationId, voice.id), {} as State);
  const [preview, setPreview] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const audio = useRef<HTMLAudioElement>(null);
  async function play() {
    setPreview({ busy: true });
    try {
      const response = await fetch("/api/studio/voices/preview", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Tenant": locationId }, body: JSON.stringify({ voiceId: voice.id }) });
      if (!response.ok) { setPreview({ busy: false, error: (await response.json().catch(() => ({}))).error ?? "Could not preview this voice." }); return; }
      const url = URL.createObjectURL(await response.blob());
      if (audio.current) { audio.current.src = url; await audio.current.play().catch(() => {}); }
      setPreview({ busy: false });
    } catch { setPreview({ busy: false, error: "Could not preview this voice." }); }
  }
  return <div className="flex flex-wrap items-center gap-2">
    {voice.provider !== "local" ? <button type="button" onClick={play} disabled={preview.busy} className={button}>{preview.busy ? "Loading…" : "Preview"}</button> : null}
    {canManage && !voice.isDefault ? <form action={setDef}><button type="submit" disabled={settingDef} className={button}>Make default</button></form> : null}
    {canManage && voice.provider !== "local" ? <form action={remove} onSubmit={event => { if (!confirm(voice.kind === "clone" ? "Remove this voice? A voice cloned in Studio is also deleted at the provider." : "Remove this voice from Studio? It stays in your provider account.")) event.preventDefault(); }}><button type="submit" disabled={removing} className={`${button} text-destructive`}>Remove</button></form> : null}
    <audio ref={audio} hidden />
    <Say s={def} /><Say s={del} />{preview.error ? <p role="alert" className="text-destructive">{preview.error}</p> : null}
  </div>;
}

export function RefreshButton({ locationId, provider }: { locationId: string; provider: string }) {
  const [state, action, pending] = useActionState(refreshVoicesAction.bind(null, locationId, provider), {} as State);
  return <form action={action} className="inline-flex flex-wrap items-center gap-2"><button type="submit" disabled={pending} className={button}>{pending ? "Refreshing…" : `Refresh ${providerLabels[provider as keyof typeof providerLabels] ?? provider} voices`}</button><Say s={state} /></form>;
}

/** Clone from an uploaded sample. Disclosed: the voice list stays the first thing on the page. */
export function AddVoice({ locationId, providers }: { locationId: string; providers: Array<"fish" | "elevenlabs"> }) {
  const router = useRouter();
  const [state, setState] = useState<State>({}); const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setState({});
    try {
      const response = await fetch("/api/studio/voices/clone", { method: "POST", headers: { "X-Studio-Tenant": locationId }, body: new FormData(event.currentTarget) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setState({ error: body.error ?? "The voice could not be created." });
      else { setState({ notice: "Voice created." }); (event.target as HTMLFormElement).reset(); router.refresh(); }
    } catch { setState({ error: "The voice could not be created. Check your connection." }); }
    setBusy(false);
  }
  if (!providers.length) return <p className="text-sm text-muted-foreground">Add a Fish Audio or ElevenLabs key in AI settings to clone a voice.</p>;
  return <details className="rounded-xl border p-4 text-sm">
    <summary className="min-h-11 cursor-pointer font-medium leading-[2.75rem]">Add a voice (clone from a sample)</summary>
    <form onSubmit={submit} className="mt-3 space-y-3">
      <label className="block space-y-1"><span>Provider</span><select name="provider" className="block min-h-11 w-full rounded-md border bg-background px-3">{providers.map(p => <option key={p} value={p}>{providerLabels[p]}</option>)}</select></label>
      <label className="block space-y-1"><span>Voice name</span><input name="name" required maxLength={80} className="block min-h-11 w-full rounded-md border bg-background px-3" /></label>
      <label className="block space-y-1"><span>Persona (optional)</span><input name="persona" maxLength={80} placeholder="Host, narrator, support agent…" className="block min-h-11 w-full rounded-md border bg-background px-3" /></label>
      <label className="block space-y-1"><span>Language code (optional)</span><input name="language" maxLength={8} placeholder="en" className="block min-h-11 w-40 rounded-md border bg-background px-3" /></label>
      <label className="block space-y-1"><span>Voice sample</span><input name="sample" type="file" required accept="audio/*" className="block w-full" />
        <span className="block text-xs text-muted-foreground">One clean recording of a single speaker, 30 seconds to 2 minutes works best. The sample goes to the provider and is not kept by Studio.</span></label>
      <label className="flex items-start gap-2"><input type="checkbox" name="attested" required className="mt-1 size-4" /><span>{CLONE_CONSENT_STATEMENT}</span></label>
      <button type="submit" disabled={busy} className={button}>{busy ? "Creating…" : "Create voice"}</button>
      <Say s={state} />
    </form>
  </details>;
}
