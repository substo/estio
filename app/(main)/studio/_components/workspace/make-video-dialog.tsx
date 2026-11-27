"use client";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { makeVideoAction } from "../../(tenant)/content/actions";
import { VoicePicker } from "@/components/voices/voice-picker";
import { voiceStatus, type Availability } from "@/lib/studio/voices/library";
import type { VoiceRow } from "@/lib/studio/voices/policy";
import { DEFAULT_MOTION_CHOICE, MOTION_PREVIEW_IDS, MOTION_PREVIEW_LABELS, MOTION_STYLES, MOTION_STYLE_IDS, describeMotionStyle, previewOf, type MotionChoice, type MotionPreviewId, type MotionStyleId } from "@/lib/studio/video-assembly/motion-style";
import { DEFAULT_MODEL_PREFS, JOB_TYPES, JOB_TYPE_LABELS, encodePick, modelChoices, routeLabel, type ModelPrefs } from "@/lib/studio/video-assembly/model-prefs";
import { MotionPreview } from "./motion-preview";

/** The one place the options for a new video live: voice, music, vertical. Opens from the top bar, so the page itself carries no form. */
export function MakeVideoDialog({ locationId, recordId, voices, availability, soundSources, motion, modelPrefs, disabledReason, busy, trigger }: {
  locationId: string; recordId: string; voices: VoiceRow[]; availability?: Availability; soundSources?: { music: string; effects: string }; motion?: MotionChoice; modelPrefs?: ModelPrefs; disabledReason: string | null; busy: boolean; trigger?: "primary" | "inline";
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(makeVideoAction.bind(null, locationId, recordId), {} as { error?: string; notice?: string });
  // Without availability (older callers) every voice counts as usable.
  const avail: Availability = availability ?? { fish: true, elevenlabs: true, local: "ready", localClone: true };
  const ready = voices.filter(v => voiceStatus(v, avail).usable), preferred = ready.find(v => v.isDefault) ?? ready[0];
  const [voiceover, setVoiceover] = useState(false);
  const [music, setMusic] = useState(false);
  const [voiceId, setVoiceId] = useState(preferred?.id ?? "");
  const saved = motion ?? DEFAULT_MOTION_CHOICE;
  const [style, setStyle] = useState<MotionStyleId>(saved.style);
  const [accent, setAccent] = useState(saved.accent ?? MOTION_STYLES[saved.style].accent);
  const [accentChosen, setAccentChosen] = useState(Boolean(saved.accent));
  const [notes, setNotes] = useState(saved.notes ?? "");
  const [preview, setPreview] = useState<MotionPreviewId>(previewOf(saved));
  const models = modelPrefs ?? DEFAULT_MODEL_PREFS;
  const [picks, setPicks] = useState(() => Object.fromEntries(JOB_TYPES.map(t => [t, encodePick(models.jobs[t])])) as Record<(typeof JOB_TYPES)[number], string>);
  const [keepDesigner, setKeepDesigner] = useState(models.keepDesigner);
  useEffect(() => { if (state.notice && !state.error) setOpen(false); }, [state]);
  const blocked = Boolean(disabledReason) || busy;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" disabled={blocked} title={disabledReason ?? undefined} className={`inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${trigger === "inline" ? "border hover:bg-accent" : "bg-primary text-primary-foreground hover:opacity-90"}`}>{busy ? "Making video…" : "Make video"}</button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Make video from this script</DialogTitle>
          <DialogDescription>Your Mac cuts the footage you added to the saved script, with captions, titles and sound, and saves the result here.</DialogDescription></DialogHeader>
        <form action={action} className="space-y-3 text-sm">
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="voiceover" checked={voiceover} onChange={e => setVoiceover(e.target.checked)} /> Generate the voiceover from the script</label>
          {voiceover ? <div className="pl-6"><VoicePicker locationId={locationId} voices={voices} availability={avail} value={voiceId} onChange={setVoiceId} /></div> : null}
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="music" checked={music} onChange={e => setMusic(e.target.checked)} /> Add a music bed and sound effects</label>
          {music && soundSources ? <p className="pl-6 text-xs text-muted-foreground">{soundSources.music}. {soundSources.effects}. <Link href="/settings/ai/audio" className="underline underline-offset-2">Change</Link></p> : null}
          <fieldset className="space-y-2 rounded-md border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Look of titles and callouts</legend>
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="motion-style">Style</label>
              <select id="motion-style" name="motionStyle" value={style} onChange={e => { const next = e.target.value as MotionStyleId; setStyle(next); if (!accentChosen) setAccent(MOTION_STYLES[next].accent); }} className="min-h-11 rounded-md border bg-background px-2">
                {MOTION_STYLE_IDS.map(id => <option key={id} value={id}>{MOTION_STYLES[id].label}</option>)}
              </select>
              <label className="flex min-h-11 items-center gap-2 text-xs">Accent <input type="color" name="motionAccent" value={accent} onChange={e => { setAccent(e.target.value); setAccentChosen(true); }} className="h-9 w-11 rounded border" /></label>
            </div>
            <p className="text-xs">{MOTION_STYLES[style].summary}</p>
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{describeMotionStyle({ style, accent }).map(line => <li key={line}>{line}</li>)}</ul>
            <label className="flex min-h-11 flex-wrap items-center gap-2 text-xs">Check graphics first on
              <select name="motionPreview" value={preview} onChange={e => setPreview(e.target.value as MotionPreviewId)} className="min-h-11 rounded-md border bg-background px-2 text-sm">
                {MOTION_PREVIEW_IDS.map(id => <option key={id} value={id}>{MOTION_PREVIEW_LABELS[id]}</option>)}
              </select></label>
            <MotionPreview choice={{ style, accent }} accent={accent} mode={preview} />
            <label className="block text-xs">Your notes on the look (optional)
              <textarea name="motionNotes" value={notes} onChange={e => setNotes(e.target.value)} maxLength={300} rows={2} placeholder="e.g. Use our brand blue, keep titles short, no all-caps" className="mt-1 w-full rounded-md border bg-background p-2 text-sm" /></label>
          </fieldset>
          <details className="rounded-md border p-3" data-testid="model-options">
            <summary className="min-h-11 cursor-pointer text-xs font-medium leading-[2.75rem] text-muted-foreground">Options · Models <span className="font-normal">(Mac subscription; nothing here is paid)</span></summary>
            <div className="space-y-2 pt-1">
              {JOB_TYPES.map(type => {
                const value = picks[type], pick = value === "default" ? { provider: "default" as const } : { provider: value.startsWith("codex:") ? "codex" as const : "claude" as const, model: value.slice(value.indexOf(":") + 1) };
                const wired = JOB_TYPE_LABELS[type].agent;
                return (
                  <div key={type} className="text-xs">
                    <label className="block font-medium" htmlFor={`model-${type}`}>{JOB_TYPE_LABELS[type].label} <span className="font-normal text-muted-foreground">· {JOB_TYPE_LABELS[type].hint}</span></label>
                    <select id={`model-${type}`} name={`model_${type}`} value={value} onChange={e => setPicks(p => ({ ...p, [type]: e.target.value }))} className="mt-1 min-h-11 w-full rounded-md border bg-background px-2 text-sm">
                      <option value="default">Mac default (recommended)</option>
                      {modelChoices(type).map(m => <option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`}>{m.provider === "codex" ? "Codex" : "Claude"} · {m.label}</option>)}
                    </select>
                    <span className="mt-0.5 block text-muted-foreground">Route: {routeLabel(pick)}{wired ? "" : ". Saved; script and text jobs still follow the route chosen in Settings → AI."}</span>
                  </div>
                );
              })}
              <label className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" name="keepDesigner" checked={keepDesigner} onChange={e => setKeepDesigner(e.target.checked)} /> Keep the model that designed a graphic for its revisions</label>
              <p className="text-xs text-muted-foreground">After each video this page shows which model actually ran.</p>
            </div>
          </details>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="portrait" /> Force vertical (9:16); otherwise match the footage</label>
          <button type="submit" disabled={pending || (voiceover && !voices.some(v => v.id === voiceId && voiceStatus(v, avail).usable))} className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-medium text-primary-foreground disabled:opacity-60">{pending ? (voiceover ? "Preparing narration…" : "Sending…") : "Make video"}</button>
          {state.error ? <p role="alert" className="text-destructive">{state.error}</p> : null}
          {state.notice ? <p role="status">{state.notice}</p> : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
