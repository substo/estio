"use client";
import Link from "next/link";
import { useActionState, useState } from "react";
import { makeVideoAction } from "../(tenant)/content/actions";
import { VoicePicker } from "@/components/voices/voice-picker";
import { voiceStatus, type Availability } from "@/lib/studio/voices/library";
import type { VoiceRow } from "@/lib/studio/voices/policy";
import { AutoRefresh } from "./auto-refresh";

/** Compact, disclosed: the piece's own script and uploaded footage go to the paired Mac; the page keeps its normal layout. */
/** `voices` is every voice in the Location; the picker groups them into Available and Not connected using `availability`. */
export function MakeVideo({ locationId, recordId, status, active, voices, availability }: { locationId: string; recordId: string; status: string | null; active: boolean; voices: VoiceRow[]; availability: Availability }) {
  const [state, action, pending] = useActionState(makeVideoAction.bind(null, locationId, recordId), {} as { error?: string; notice?: string });
  const ready = voices.filter(v => voiceStatus(v, availability).usable), preferred = ready.find(v => v.isDefault) ?? ready[0];
  const [voiceover, setVoiceover] = useState(false);
  const [voiceId, setVoiceId] = useState(preferred?.id ?? "");
  return (
    <section aria-label="Make video" className="space-y-2 text-sm">
      <AutoRefresh active={active} />
      <details className="rounded-xl border p-4">
        <summary className="min-h-11 cursor-pointer font-medium leading-[2.75rem]">Make video from this script</summary>
        <form action={action} className="mt-3 space-y-3">
          <p className="text-muted-foreground">Your Mac cuts the footage uploaded below to the saved script, adds captions, titles and sound, and saves the edit back here.</p>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="voiceover" checked={voiceover} onChange={e => setVoiceover(e.target.checked)} /> Generate the voiceover from the script</label>
          {voiceover ? <div className="pl-6"><VoicePicker locationId={locationId} voices={voices} availability={availability} value={voiceId} onChange={setVoiceId} /></div> : null}
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="music" /> Add a music bed</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="portrait" /> Vertical (9:16)</label>
          <button type="submit" disabled={pending || active || (voiceover && !voices.some(v => v.id === voiceId && voiceStatus(v, availability).usable))} className="inline-flex min-h-11 items-center rounded-md border px-3 font-medium hover:bg-accent disabled:opacity-60">{pending ? (voiceover ? "Preparing narration…" : "Sending…") : "Make video"}</button>
          {state.error ? <p role="alert" className="text-destructive">{state.error}</p> : null}
          {state.notice ? <p role="status">{state.notice}</p> : null}
        </form>
      </details>
      {status ? <p role="status" className="text-muted-foreground">{status}</p> : null}
    </section>
  );
}
