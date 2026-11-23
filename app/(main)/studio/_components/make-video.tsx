"use client";
import { useActionState } from "react";
import { makeVideoAction } from "../(tenant)/content/actions";
import { AutoRefresh } from "./auto-refresh";

/** Compact, disclosed: the piece's own script and uploaded footage go to the paired Mac; the page keeps its normal layout. */
export function MakeVideo({ locationId, recordId, status, active }: { locationId: string; recordId: string; status: string | null; active: boolean }) {
  const [state, action, pending] = useActionState(makeVideoAction.bind(null, locationId, recordId), {} as { error?: string; notice?: string });
  return (
    <section aria-label="Make video" className="space-y-2 text-sm">
      <AutoRefresh active={active} />
      <details className="rounded-xl border p-4">
        <summary className="min-h-11 cursor-pointer font-medium leading-[2.75rem]">Make video from this script</summary>
        <form action={action} className="mt-3 space-y-3">
          <p className="text-muted-foreground">Your Mac cuts the footage uploaded below to the saved script, adds captions, titles and sound, and saves the edit back here. No paid fallback.</p>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="voiceover" /> Generate the voiceover (ElevenLabs, uses your key)</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="music" /> Add a music bed</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="portrait" /> Vertical (9:16)</label>
          <button type="submit" disabled={pending || active} className="inline-flex min-h-11 items-center rounded-md border px-3 font-medium hover:bg-accent disabled:opacity-60">{pending ? "Sending…" : "Make video"}</button>
          {state.error ? <p role="alert" className="text-destructive">{state.error}</p> : null}
          {state.notice ? <p role="status">{state.notice}</p> : null}
        </form>
      </details>
      {status ? <p role="status" className="text-muted-foreground">{status}</p> : null}
    </section>
  );
}
