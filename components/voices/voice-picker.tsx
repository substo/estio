"use client";
import Link from "next/link";
import { useId, useMemo } from "react";
import { usePreview } from "./use-voice-preview";
import { splitByAvailability, tagLabel, voiceStatus, type Availability } from "@/lib/studio/voices/library";
import { hostedVoiceNote, providerLabels, type VoiceRow } from "@/lib/studio/voices/policy";

const kindLabel = (v: VoiceRow) => v.kind === "clone" ? "cloned" : v.kind === "designed" ? "designed" : null;
function Row({ locationId, voice, selected, usable, need, onPick, name }: { locationId: string; voice: VoiceRow; selected: boolean; usable: boolean; need?: string; onPick: (id: string) => void; name: string }) {
  const preview = usePreview(locationId, voice.id), id = useId();
  const tags = (voice.tags ?? []).slice(0, 4);
  return <li className={`rounded-lg border p-2 ${selected ? "border-primary bg-primary/5" : ""} ${usable ? "" : "opacity-70"}`}>
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="flex min-h-11 flex-1 cursor-pointer items-start gap-2">
        <input id={id} type="radio" name={name} value={voice.id} checked={selected} disabled={!usable} onChange={() => onPick(voice.id)} className="mt-1.5 size-4" />
        <span className="min-w-0"><span className="block font-medium">{voice.name}{voice.isDefault ? <span className="ml-2 rounded bg-muted px-1.5 text-xs font-normal">default</span> : null}</span>
          <span className="block text-xs text-muted-foreground">{providerLabels[voice.provider]}{kindLabel(voice) ? ` · ${kindLabel(voice)}` : ""}{voice.language ? ` · ${voice.language}` : ""}{tags.length ? ` · ${tags.map(tagLabel).join(", ")}` : ""}</span>
          {voice.description ? <span className="mt-0.5 block text-xs text-muted-foreground">{voice.description}</span> : null}</span>
      </label>
      {usable ? <button type="button" onClick={preview.run} disabled={preview.state.busy} aria-label={`Preview ${voice.name}`} className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent disabled:opacity-60">{preview.state.busy ? "Loading…" : "Preview"}</button> : null}
    </div>
    {!usable && need ? <p className="pl-6 text-xs text-muted-foreground">{need}</p> : null}
    <audio ref={preview.audio} hidden />
    {preview.state.note ? <p role="status" className="pl-6 text-xs text-muted-foreground">{preview.state.note}</p> : null}
    {preview.state.error ? <p role="alert" className="pl-6 text-xs text-destructive">{preview.state.error}</p> : null}
  </li>;
}

/** Choose the voice for a video. Available voices first; voices that need a key or an install are listed below, disabled, with the step that unlocks them.
 *  Submits the chosen id under `name` (default "voiceId"), so it works inside a plain form or a dialog. Reusable on any page. */
export function VoicePicker({ locationId, voices, availability, value, onChange, name = "voiceId", manageHref = "/settings/voices?from=studio" }: {
  locationId: string; voices: VoiceRow[]; availability: Availability; value: string; onChange: (id: string) => void; name?: string; manageHref?: string }) {
  const { usable, unavailable } = useMemo(() => splitByAvailability(voices.map(v => ({ ...v, tags: v.tags ?? [] })), availability), [voices, availability]);
  const chosen = voices.find(v => v.id === value);
  if (!voices.length) return <p className="text-sm text-muted-foreground">No voices yet. <Link className="text-primary hover:underline" href={manageHref}>Set up voices</Link> first.</p>;
  return <fieldset className="space-y-2">
    <legend className="sr-only">Voice</legend>
    {usable.length ? <ul className="max-h-72 space-y-1 overflow-y-auto pr-1" aria-label="Available voices">{usable.map(v => <Row key={v.id} locationId={locationId} voice={v} selected={v.id === value} usable onPick={onChange} name={name} />)}</ul>
      : <p className="text-sm text-muted-foreground">No voice is ready to use. Add a key in Settings → AI or install the on-device model under Devices.</p>}
    {unavailable.length ? <details className="text-sm"><summary className="min-h-11 cursor-pointer leading-[2.75rem] text-muted-foreground">Not connected ({unavailable.length})</summary>
      <ul className="space-y-1">{unavailable.map(v => <Row key={v.id} locationId={locationId} voice={v} selected={false} usable={false} need={(() => { const st = voiceStatus(v, availability); return st.usable ? undefined : st.message; })()} onPick={onChange} name={name} />)}</ul></details> : null}
    <p className="text-xs text-muted-foreground">{chosen?.provider === "local" ? "Generated on your Mac. Free, slower." : chosen ? hostedVoiceNote : ""} <Link className="text-primary hover:underline" href={manageHref}>Manage voices</Link></p>
  </fieldset>;
}
