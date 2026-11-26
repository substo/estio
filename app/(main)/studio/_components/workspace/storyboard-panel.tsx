"use client";
/* eslint-disable @next/next/no-img-element -- previews are short-lived private links */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { drawStoryboardAction } from "../../(tenant)/content/actions";
import type { StoryboardView } from "@/lib/studio/storyboard";

export const BRAINSTORM_MESSAGE = "Let's plan the storyboard for this script. For each beat suggest one shot: its size and angle, where I am, what I'm doing and what is on screen. Keep my spoken words exactly as they are and write each shot as that beat's [visual note]. Start with the beats that have no visual note yet, and ask me before you change one that already has one.";

/** Step between the script and the edit: plan the shots with the agent, draw a preview of each on the creator's own Mac, then make the video from them. */
export function StoryboardPanel({ locationId, recordId, view, hasScript, archived, canPlan, onPlan, onMake }: {
  locationId: string; recordId: string; view: StoryboardView | null; hasScript: boolean; archived: boolean; canPlan: boolean; onPlan: () => void; onMake: () => void;
}) {
  const router = useRouter();
  const [vertical, setVertical] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ error?: string; notice?: string }>({});
  const working = view?.status === "queued" || view?.status === "running";
  const beats = view?.beats ?? [];
  const drawn = beats.filter(b => b.url).length, stale = beats.filter(b => b.stale).length;
  const draw = () => start(async () => { setResult(await drawStoryboardAction(locationId, recordId, vertical)); router.refresh(); });
  if (!hasScript) return <section aria-label="Storyboard" className="rounded-xl border p-5 text-sm"><h2 className="font-medium">Storyboard</h2><p className="mt-1 text-muted-foreground">Save a script first (Script mode). The storyboard is planned from it.</p></section>;
  return (
    <section aria-label="Storyboard" className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Storyboard</h2>
        <p className="text-sm text-muted-foreground">1. Plan the shots with the agent. 2. Draw a preview of each one. 3. Make the video: your footage goes where you have it, and these pictures stand in where you do not.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canPlan ? <button type="button" onClick={onPlan} className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Plan the shots with the agent</button> : null}
        <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={vertical} onChange={e => setVertical(e.target.checked)} className="size-4" />Vertical (9:16)</label>
        <button type="button" onClick={draw} disabled={pending || working || archived} className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          {working ? "Drawing…" : drawn ? "Draw the previews again" : "Draw previews"}</button>
      </div>
      <div aria-live="polite" className="space-y-1 text-sm">
        {working ? <p role="status" className="text-muted-foreground">Your Mac is drawing the pictures with your ChatGPT login. This takes about a minute per picture; they appear here as soon as it is done.</p> : null}
        {result.error ? <p role="alert" className="text-destructive">{result.error}</p> : null}
        {!result.error && view?.error ? <p role="alert" className="text-destructive">The last drawing did not finish: {view.error}</p> : null}
        {result.notice && !result.error ? <p className="text-muted-foreground">{result.notice}</p> : null}
        {stale ? <p className="text-amber-700 dark:text-amber-400">{stale === 1 ? "One picture was drawn before the script changed" : `${stale} pictures were drawn before the script changed`}. Draw the previews again, or the video leaves those beats out.</p> : null}
        {view?.truncated ? <p className="text-muted-foreground">Only the first six beats get a picture.</p> : null}
      </div>
      <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {beats.map(b => (
          <li key={b.n} className="space-y-2 rounded-xl border p-3">
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md bg-muted text-xs text-muted-foreground">
              {b.url ? <img src={b.url} alt={`Preview of beat ${b.n}`} className="size-full object-contain" /> : working ? "Drawing…" : "No picture yet"}
            </div>
            <p className="text-sm font-medium">Beat {b.n}{b.stale ? <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">changed since drawn</span> : null}</p>
            <p className="line-clamp-3 text-sm">{b.narration}</p>
            <p className="text-xs text-muted-foreground">{b.direction ? `Shot: ${b.direction}` : "No shot planned yet: the preview shows you speaking this line."}</p>
          </li>))}
      </ol>
      {drawn && !working ? <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 text-sm">
        <p className="min-w-0 flex-1">Happy with the previews? Next, upload your footage and press Make video.</p>
        <button type="button" onClick={onMake} className="inline-flex min-h-11 items-center rounded-md border px-3 font-medium hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Go to Edit</button>
      </div> : null}
    </section>
  );
}
