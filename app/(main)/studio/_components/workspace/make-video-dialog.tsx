"use client";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { makeVideoAction } from "../../(tenant)/content/actions";
import { hostedVoiceNote, providerLabels, type VoiceRow } from "@/lib/studio/voices/policy";

/** The one place the options for a new video live: voice, music, vertical. Opens from the top bar, so the page itself carries no form. */
export function MakeVideoDialog({ locationId, recordId, voices, disabledReason, busy, trigger }: {
  locationId: string; recordId: string; voices: VoiceRow[]; disabledReason: string | null; busy: boolean; trigger?: "primary" | "inline";
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(makeVideoAction.bind(null, locationId, recordId), {} as { error?: string; notice?: string });
  const preferred = voices.find(v => v.isDefault) ?? voices[0];
  const [voiceover, setVoiceover] = useState(false);
  const [voiceId, setVoiceId] = useState(preferred?.id ?? "");
  const chosen = voices.find(v => v.id === voiceId);
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
          {voiceover ? <div className="space-y-1 pl-6">
            {voices.length ? <>
              <label className="block space-y-1"><span>Voice</span>
                <select name="voiceId" value={voiceId} onChange={e => setVoiceId(e.target.value)} className="block min-h-11 w-full rounded-md border bg-background px-3">
                  {voices.map(v => <option key={v.id} value={v.id}>{v.name} - {providerLabels[v.provider]}{v.kind === "clone" ? " (cloned)" : ""}{v.isDefault ? " · default" : ""}</option>)}
                </select></label>
              <p className="text-xs text-muted-foreground">{chosen?.description ? `${chosen.description} ` : ""}{chosen?.provider === "local" ? "Generated on your Mac. Free, slower." : hostedVoiceNote} <Link className="text-primary hover:underline" href="/settings/voices?from=studio">Manage voices</Link></p>
            </> : <p className="text-muted-foreground">No voices yet. <Link className="text-primary hover:underline" href="/settings/voices?from=studio">Set up voices</Link> first.</p>}
          </div> : null}
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="music" /> Add a music bed</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="portrait" /> Vertical (9:16)</label>
          <button type="submit" disabled={pending || (voiceover && !voices.length)} className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-medium text-primary-foreground disabled:opacity-60">{pending ? (voiceover ? "Preparing narration…" : "Sending…") : "Make video"}</button>
          {state.error ? <p role="alert" className="text-destructive">{state.error}</p> : null}
          {state.notice ? <p role="status">{state.notice}</p> : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
