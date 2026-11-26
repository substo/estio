"use client";
/* eslint-disable @next/next/no-img-element -- previews are short-lived private links */
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveClipAction, drawStoryboardAction, transcribeUploadAction } from "../../(tenant)/content/actions";
import type { ClipSuggestion, ClipVideo } from "@/lib/studio/clip-suggestions";
import type { StoryboardView } from "@/lib/studio/storyboard";

export const BRAINSTORM_MESSAGE = "Let's plan the storyboard for this script together. Tell me how many pictures it needs and which beats they belong to: not every beat needs one, so say why for each you pick. Write a shot only for those beats, as that beat's [visual note]: its size and angle, where I am, what I'm doing and what is on screen. Keep my spoken words exactly as they are, and ask me before you change a visual note that already exists.";

/** Step between the script and the edit: plan the shots with the agent, draw a preview of each on the creator's own Mac, then make the video from them. */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function StoryboardPanel({ locationId, recordId, view, hasScript, archived, canPlan, onPlan, onMake, clips }: {
  locationId: string; recordId: string; view: StoryboardView | null; hasScript: boolean; archived: boolean; canPlan: boolean; onPlan: () => void; onMake: () => void; clips: { suggestions: ClipSuggestion[]; videos: ClipVideo[] };
}) {
  const [clipResult, setClipResult] = useState<{ error?: string; notice?: string }>({});
  const [adding, setAdding] = useState<string | null>(null);
  const approve = (c: ClipSuggestion) => { setAdding(c.blockId); start(async () => { setClipResult(await approveClipAction(locationId, recordId, { blockId: c.blockId, uploadId: c.uploadId, start: c.start, end: c.end })); setAdding(null); router.refresh(); }); };
  const router = useRouter();
  const transcribe = (uploadId: string) => { setAdding(uploadId); start(async () => { setClipResult(await transcribeUploadAction(locationId, recordId, uploadId)); setAdding(null); router.refresh(); }); };
  const transcribing = clips.videos.some(v => v.status === "queued" || v.status === "running") && !clips.videos.every(v => v.transcribed);
  useEffect(() => { if (!transcribing) return; const t = setInterval(() => router.refresh(), 8000); return () => clearInterval(t); }, [transcribing, router]);   // the page reads the finished lines once the Mac is done
  const [vertical, setVertical] = useState(false);
  const [picked, setPicked] = useState<Set<number> | null>(null);   // null: the default choice
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ error?: string; notice?: string }>({});
  const working = view?.status === "queued" || view?.status === "running";
  const beats = view?.beats ?? [];
  const drawn = beats.filter(b => b.url).length, stale = beats.filter(b => b.stale).length;
  // Which beats get a picture is the creator's call, starting from the shots the agent planned (every beat when none are planned yet).
  const planned = beats.filter(b => b.direction).map(b => b.n);
  const chosen = picked ?? new Set(planned.length ? planned : beats.map(b => b.n));
  const toggle = (n: number) => setPicked(() => { const next = new Set(chosen); if (next.has(n)) next.delete(n); else next.add(n); return next; });
  const count = beats.filter(b => chosen.has(b.n)).length;
  const draw = () => start(async () => { setResult(await drawStoryboardAction(locationId, recordId, vertical, beats.filter(b => chosen.has(b.n)).map(b => b.n))); router.refresh(); });
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
        <button type="button" onClick={draw} disabled={pending || working || archived || count === 0} className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
          {working ? "Drawing…" : `${drawn ? "Draw again" : "Draw"} ${count} ${count === 1 ? "preview" : "previews"}`}</button>
      </div>
      <div aria-live="polite" className="space-y-1 text-sm">
        {working ? <p role="status" className="text-muted-foreground">Your Mac is drawing the pictures with your ChatGPT login. This takes about a minute per picture; they appear here as soon as it is done.</p> : null}
        {result.error ? <p role="alert" className="text-destructive">{result.error}</p> : null}
        {!result.error && view?.error ? <p role="alert" className="text-destructive">The last drawing did not finish: {view.error}</p> : null}
        {result.notice && !result.error ? <p className="text-muted-foreground">{result.notice}</p> : null}
        {stale ? <p className="text-amber-700 dark:text-amber-400">{stale === 1 ? "One picture was drawn before the script changed" : `${stale} pictures were drawn before the script changed`}. Draw those beats again, or the video leaves them out.</p> : null}
        <p className="text-muted-foreground">{planned.length ? "The beats with a planned shot are ticked." : "No shots are planned yet, so every beat is ticked."} Tick the beats that need a picture: each takes about a minute on your Mac.{view?.truncated ? " Only the first 40 beats can be drawn at once." : ""}</p>
      </div>
      <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {beats.map(b => (
          <li key={b.n} className="space-y-2 rounded-xl border p-3">
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md bg-muted text-xs text-muted-foreground">
              {b.url ? <img src={b.url} alt={`Preview of beat ${b.n}`} className="size-full object-contain" /> : working ? "Drawing…" : "No picture yet"}
            </div>
            <label className="flex min-h-8 items-center gap-2 text-sm font-medium"><input type="checkbox" checked={chosen.has(b.n)} onChange={() => toggle(b.n)} className="size-4" />Beat {b.n}{b.stale ? <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">changed since drawn</span> : null}</label>
            <p className="line-clamp-3 text-sm">{b.narration}</p>
            <p className="text-xs text-muted-foreground">{b.direction ? `Shot: ${b.direction}` : "No shot planned yet: the preview shows you speaking this line."}</p>
          </li>))}
      </ol>
      <section aria-label="Clips from your source videos" className="space-y-3 rounded-xl border p-4">
        <h3 className="font-medium">Clips from your source videos</h3>
        <p className="text-sm text-muted-foreground">Where a line of your script says what a moment in one of your uploaded videos says, it is suggested here with its time. Add the ones you want: they join the script as source clips and Make video places them, with their original sound.</p>
        {clips.suggestions.length ? <ul className="space-y-3">
          {clips.suggestions.map(c => <li key={`${c.blockId}:${c.start}`} className="space-y-1 rounded-lg border p-3 text-sm">
            <p className="font-medium">Beat {c.beat} · {c.name} · {clock(c.start)}–{clock(c.end)}</p>
            <p className="text-muted-foreground">“{c.quote}”</p>
            <button type="button" onClick={() => approve(c)} disabled={pending || archived} className="inline-flex min-h-11 items-center rounded-md border px-3 font-medium hover:bg-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">{adding === c.blockId ? "Adding…" : "Add to the script"}</button>
          </li>)}
        </ul> : <p className="text-sm">{clips.videos.some(v => v.transcribed) ? "No line of your script matches something said in your uploaded videos yet. Add or change a line, then come back." : "Upload a video with the footage or source you want to quote (Edit → Add footage). Once it is transcribed on your Mac, matching moments are suggested here."}</p>}
        {clips.videos.length ? <ul aria-label="Your uploaded videos" className="space-y-1 text-sm">
          {clips.videos.map(v => <li key={v.uploadId} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{v.name}</span>
            {v.transcribed ? <span className="text-muted-foreground">Transcribed</span> : v.status === "queued" || v.status === "running"
              ? <span role="status" className="text-muted-foreground">{v.status === "running" ? "Your Mac is transcribing it…" : "Waiting for your Mac…"}</span>
              : <button type="button" onClick={() => transcribe(v.uploadId)} disabled={pending || archived} className="inline-flex min-h-11 items-center rounded-md border px-3 font-medium hover:bg-accent disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">{adding === v.uploadId ? "Starting…" : v.status === "failed" ? "Transcribe again" : "Transcribe on my Mac"}</button>}
            {!v.transcribed && v.status === "failed" && v.error ? <span role="alert" className="text-destructive">{v.error}</span> : null}
          </li>)}
        </ul> : null}
        {clipResult.error ? <p role="alert" className="text-sm text-destructive">{clipResult.error}</p> : null}
        {clipResult.notice && !clipResult.error ? <p role="status" className="text-sm text-muted-foreground">{clipResult.notice}</p> : null}
        <p className="text-xs text-muted-foreground">Only videos you upload to this piece can be cut. Clips from related videos you approve will join this same list.</p>
      </section>
      {drawn && !working ? <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 text-sm">
        <p className="min-w-0 flex-1">Happy with the previews? Next, upload your footage and press Make video.</p>
        <button type="button" onClick={onMake} className="inline-flex min-h-11 items-center rounded-md border px-3 font-medium hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Go to Edit</button>
      </div> : null}
    </section>
  );
}
