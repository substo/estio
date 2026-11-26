"use client";
import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";
import { interpret } from "@/lib/studio/voices/assistant";
import { facetCounts, facetLabels, filterVoices, quickFilterLabels, splitByAvailability, tagLabel, voiceStatus, type Availability, type LibraryVoice, type QuickFilter } from "@/lib/studio/voices/library";
import { providerLabels, type VoiceProvider, type VoiceRow } from "@/lib/studio/voices/policy";
import { usePreview } from "@/components/voices/use-voice-preview";
import { deleteVoiceAction, refreshVoicesAction, setDefaultVoiceAction } from "./actions";

type State = { error?: string; notice?: string };
export const button = "inline-flex min-h-11 items-center rounded-md border px-3 font-medium hover:bg-accent disabled:opacity-60";
const chip = (on: boolean) => `inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium ${on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}`;
const Say = ({ s }: { s: State }) => s.error ? <p role="alert" className="text-destructive">{s.error}</p> : s.notice ? <p role="status" className="text-muted-foreground">{s.notice}</p> : null;

export function VoiceItem({ locationId, voice, availability, canManage }: { locationId: string; voice: VoiceRow; availability: Availability; canManage: boolean }) {
  const [def, setDef, settingDef] = useActionState(setDefaultVoiceAction.bind(null, locationId, voice.id), {} as State);
  const [del, remove, removing] = useActionState(deleteVoiceAction.bind(null, locationId, voice.id), {} as State);
  const preview = usePreview(locationId, voice.id);
  const status = voiceStatus(voice, availability);
  return <li className="space-y-2 p-4 text-sm">
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-medium">{voice.name}</span>
      <span className="text-muted-foreground">{providerLabels[voice.provider as VoiceProvider]}{voice.kind === "clone" ? " · cloned" : voice.kind === "designed" ? " · designed" : ""}{voice.language ? ` · ${voice.language}` : ""}{voice.persona ? ` · ${voice.persona}` : ""}</span>
      {voice.isDefault ? <span className="rounded-full border px-2 text-xs">Default</span> : null}
    </div>
    {voice.description ? <p className="text-muted-foreground">{voice.description}</p> : null}
    {voice.tags?.length ? <ul aria-label="Voice traits" className="flex flex-wrap gap-1">{voice.tags.map(t => <li key={t} className="rounded-full bg-muted px-2 py-0.5 text-xs">{tagLabel(t)}</li>)}</ul> : null}
    {status.usable ? <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => preview.run()} disabled={preview.state.busy} className={button}>{preview.state.busy ? "Loading…" : "Preview"}</button>
      {canManage && voice.provider === "local" && voice.kind === "clone" ? <button type="button" onClick={() => preview.run(true)} disabled={preview.state.busy} className={button}>Make a new sample</button> : null}
      {canManage && !voice.isDefault ? <form action={setDef}><button type="submit" disabled={settingDef} className={button}>Make default</button></form> : null}
      {canManage && (voice.provider !== "local" || voice.kind === "clone") ? <form action={remove} onSubmit={event => { if (!confirm(voice.provider === "local" ? "Remove this cloned voice? Its recording is deleted from Studio's private storage and from your Mac the next time it is cleaned up." : voice.kind !== "preset" ? "Remove this voice? A voice created in Studio is also deleted at the provider." : "Remove this voice from Studio? It stays in your provider account.")) event.preventDefault(); }}><button type="submit" disabled={removing} className={button}>Remove</button></form> : null}
    </div> : <p className="text-muted-foreground">{status.message} <Link className="text-primary hover:underline" href={status.need === "key" ? "/settings/ai" : "/settings/computer"}>{status.need === "key" ? "Add a key" : "Open Devices"}</Link></p>}
    {status.usable ? <p className="text-xs text-muted-foreground">The sample says: “Hi, this is how I sound in your videos.”{voice.provider === "local" && voice.kind === "clone" ? " If it sounds wrong, make a new sample: your Mac listens to the recording again." : ""}</p> : null}
    <audio ref={preview.audio} hidden />
    {preview.state.note ? <p role="status" className="text-muted-foreground">{preview.state.note}</p> : null}
    <Say s={def} /><Say s={del} />{preview.state.error ? <p role="alert" className="text-destructive">{preview.state.error}</p> : null}
  </li>;
}

function Refresh({ locationId, provider }: { locationId: string; provider: string }) {
  const [state, action, pending] = useActionState(refreshVoicesAction.bind(null, locationId, provider), {} as State);
  return <form action={action} className="inline-flex flex-wrap items-center gap-2"><button type="submit" disabled={pending} className={button}>{pending ? "Refreshing…" : `Refresh ${providerLabels[provider as VoiceProvider]}`}</button><Say s={state} /></form>;
}

/** Plain-language helper over the same tools as the page: find, compare, preview, set default, prefill the Design form. No model call, no cost. */
function VoiceAssistant({ locationId, voices, availability, canManage, apply }: { locationId: string; voices: VoiceRow[]; availability: Availability; canManage: boolean; apply: (f: { text: string; tags: string[]; quick: QuickFilter[] }) => void }) {
  const [input, setInput] = useState(""); const [log, setLog] = useState<Array<{ role: "you" | "assistant"; text: string; ids?: string[] }>>([]);
  function send(e: React.FormEvent) {
    e.preventDefault();
    const turn = interpret(input, voices as LibraryVoice[], availability);
    if (turn.action.kind === "filter") apply({ text: turn.action.text, tags: turn.action.tags, quick: turn.action.quick });
    if (turn.action.kind === "design") window.dispatchEvent(new CustomEvent("voices:design", { detail: turn.action.fields }));
    setLog(l => [...l, { role: "you", text: input }, { role: "assistant", text: turn.reply, ids: turn.voiceIds }]); setInput("");
  }
  return <details className="rounded-xl border p-4 text-sm">
    <summary className="min-h-11 cursor-pointer font-medium leading-[2.75rem]">Ask about voices</summary>
    <div className="mt-3 space-y-3">
      <ol aria-live="polite" className="space-y-3">{log.map((m, i) => <li key={i} className={m.role === "you" ? "text-right" : ""}>
        <p className={`inline-block whitespace-pre-line rounded-lg px-3 py-2 ${m.role === "you" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{m.text}</p>
        {m.ids?.length ? <ul className="mt-2 divide-y rounded-xl border text-left">{m.ids.map(id => voices.find(v => v.id === id)).filter((v): v is VoiceRow => !!v).map(v => <VoiceItem key={v.id} locationId={locationId} voice={v} availability={availability} canManage={canManage} />)}</ul> : null}
      </li>)}</ol>
      <form onSubmit={send} className="flex gap-2"><label className="sr-only" htmlFor="voice-assistant-input">Message</label>
        <input id="voice-assistant-input" value={input} onChange={e => setInput(e.target.value)} placeholder="Find a warm female narrator…" maxLength={300} className="block min-h-11 w-full rounded-md border bg-background px-3" />
        <button type="submit" className={button}>Ask</button></form>
      {!log.length ? <p className="text-xs text-muted-foreground">Try “find a calm male narrator”, “compare Liam and Alice”, “preview Ryan”, or “design a warm young woman with a British accent”. This helper runs in your browser and never spends credits.</p> : null}
    </div>
  </details>;
}

export function VoiceLibrary({ locationId, voices, availability, canManage, connected }: { locationId: string; voices: VoiceRow[]; availability: Availability; canManage: boolean; connected: string[] }) {
  const [text, setText] = useState(""); const [quick, setQuick] = useState<QuickFilter[]>([]); const [tags, setTags] = useState<string[]>([]);
  const toggle = <T,>(list: T[], v: T) => list.includes(v) ? list.filter(x => x !== v) : [...list, v];
  const shown = useMemo(() => filterVoices(voices as LibraryVoice[], availability, { text, quick, tags }) as VoiceRow[], [voices, availability, text, quick, tags]);
  const { usable, unavailable } = useMemo(() => splitByAvailability(shown as LibraryVoice[], availability) as { usable: VoiceRow[]; unavailable: VoiceRow[] }, [shown, availability]);
  const facets = useMemo(() => facetCounts(voices as LibraryVoice[]), [voices]);
  const active = text || quick.length || tags.length;
  const list = (items: VoiceRow[], label: string) => <ul aria-label={label} className="divide-y rounded-xl border">{items.map(v => <VoiceItem key={v.id} locationId={locationId} voice={v} availability={availability} canManage={canManage} />)}</ul>;
  return <section aria-label="Voice library" className="space-y-3">
    <VoiceAssistant locationId={locationId} voices={voices} availability={availability} canManage={canManage} apply={f => { setText(f.text); setQuick(f.quick); setTags(f.tags); }} />
    <div className="space-y-2">
      <label className="block"><span className="sr-only">Search voices</span>
        <input type="search" value={text} onChange={e => setText(e.target.value)} placeholder="Search by name or trait: warm, deep, female, narration…" className="block min-h-11 w-full rounded-md border bg-background px-3 text-sm" /></label>
      <div role="group" aria-label="Quick filters" className="flex flex-wrap gap-2">
        {(Object.keys(quickFilterLabels) as QuickFilter[]).map(f => <button key={f} type="button" aria-pressed={quick.includes(f)} onClick={() => setQuick(toggle(quick, f))} className={chip(quick.includes(f))}>{quickFilterLabels[f]}</button>)}
        {active ? <button type="button" onClick={() => { setText(""); setQuick([]); setTags([]); }} className="min-h-9 px-2 text-xs text-primary hover:underline">Clear filters</button> : null}
      </div>
      {facets.length ? <details className="text-sm"><summary className="min-h-11 cursor-pointer leading-[2.75rem] text-muted-foreground">Filter by trait{tags.length ? ` (${tags.length})` : ""}</summary>
        <div className="space-y-2 pb-2">{facets.map(f => <div key={f.facet} role="group" aria-label={facetLabels[f.facet]} className="flex flex-wrap items-center gap-2"><span className="w-16 text-xs text-muted-foreground">{facetLabels[f.facet]}</span>
          {f.values.map(v => <button key={v.tag} type="button" aria-pressed={tags.includes(v.tag)} onClick={() => setTags(toggle(tags, v.tag))} className={chip(tags.includes(v.tag))}>{tagLabel(v.tag)} <span className="ml-1 opacity-60">{v.count}</span></button>)}</div>)}</div></details> : null}
    </div>
    <p role="status" className="text-sm text-muted-foreground">{usable.length} available{unavailable.length ? ` · ${unavailable.length} not connected` : ""}</p>
    {usable.length ? list(usable, "Available voices") : <p className="rounded-xl border p-4 text-sm text-muted-foreground">{voices.length ? "No available voice matches. Clear a filter, or connect a provider below." : "No voices yet. Add a provider key in Settings → AI and refresh, or use the built-in voices on your Mac."}</p>}
    {unavailable.length ? <details className="rounded-xl border"><summary className="min-h-11 cursor-pointer px-4 leading-[2.75rem] text-sm font-medium">Not connected ({unavailable.length})</summary>{list(unavailable, "Voices that need a key or the on-device model")}</details> : null}
    {canManage ? <div className="flex flex-wrap gap-3">{connected.map(p => <Refresh key={p} locationId={locationId} provider={p} />)}<Refresh locationId={locationId} provider="local" /></div> : null}
  </section>;
}
