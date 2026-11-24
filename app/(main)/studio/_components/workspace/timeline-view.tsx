"use client";
import { clipActionLabels, clipLabel, type ClipAction, type SelectedClip } from "@/lib/studio/workspace/clip-actions";
import { formatTime, layoutClip, type TimelineSnapshot } from "@/lib/studio/workspace/timeline";

const tone: Record<string, string> = { text: "bg-amber-500/25 border-amber-500/60", solid: "bg-slate-500/25 border-slate-500/60", media: "bg-sky-500/25 border-sky-500/60", sticker: "bg-fuchsia-500/25 border-fuchsia-500/60" };
const actions: ClipAction[] = ["trim", "replace", "delete", "retake", "ask"];

/** A read-mostly picture of the Mac's timeline for the shown version. Real editing is the Substo Video app; quick changes go to the agent as structured instructions. */
export function TimelineView({ snapshot, selected, onSelect, onAction, canEdit, busy }: {
  snapshot: TimelineSnapshot | null; selected: SelectedClip | null; onSelect: (value: SelectedClip | null) => void; onAction: (action: ClipAction, clip: SelectedClip) => void; canEdit: boolean; busy: boolean;
}) {
  if (!snapshot) return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">The timeline appears after the next video is made or changed on your Mac.</p>;
  const duration = Math.max(snapshot.d, 1);
  const ticks = Array.from({ length: Math.min(12, Math.floor(duration / Math.max(1, Math.ceil(duration / 10))) + 1) }, (_, i) => i * Math.max(1, Math.ceil(duration / 10)));
  return (
    <section aria-label="Timeline" className="space-y-2 text-sm">
      <div className="overflow-x-auto rounded-lg border">
        <div className="min-w-[640px]">
          <div className="flex border-b text-xs text-muted-foreground"><div className="w-24 shrink-0 border-r px-2 py-1">Layers</div>
            <div className="relative h-6 flex-1">{ticks.map(t => <span key={t} className="absolute top-1" style={{ left: `${(t / duration) * 100}%` }}>{formatTime(t)}</span>)}</div></div>
          {snapshot.tracks.map(track => (
            <div key={`${track.k}-${track.n}`} className="flex border-b last:border-b-0">
              <div className="flex w-24 shrink-0 items-center border-r px-2 text-xs"><span className="truncate" title={track.n}>{track.n}</span></div>
              <div className="relative h-10 flex-1">
                {track.c.map((clip, i) => {
                  const pos = layoutClip(clip, duration), isSelected = selected?.track === track.n && selected.clip.s === clip.s && selected.clip.e === clip.e && selected.clip.l === clip.l;
                  return <button key={i} type="button" aria-pressed={isSelected} aria-label={`${track.n}: ${clip.l}, ${formatTime(clip.s)} to ${formatTime(clip.e)}`}
                    onClick={() => onSelect(isSelected ? null : { track: track.n, clip })} style={{ left: `${pos.left}%`, width: `${pos.width}%` }}
                    className={`absolute top-1 h-8 overflow-hidden rounded border px-1 text-left text-[11px] leading-8 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 aria-pressed:outline aria-pressed:outline-2 aria-pressed:outline-primary ${tone[clip.k] ?? "bg-muted border-border"}`}><span className="truncate">{clip.l}</span></button>;
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {selected ? (
        <div className="space-y-2 rounded-lg border bg-card p-3" role="group" aria-label="Selected clip">
          <p className="break-words font-medium">{clipLabel(selected)}</p>
          <div className="flex flex-wrap gap-2">
            {actions.map(a => <button key={a} type="button" disabled={!canEdit || busy} onClick={() => onAction(a, selected)} className="inline-flex min-h-11 items-center rounded-md border px-3 font-medium hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60">{clipActionLabels[a]}</button>)}
          </div>
          {!canEdit ? <p className="text-xs text-muted-foreground">Make a video first; changes are made on your Mac.</p> : <p className="text-xs text-muted-foreground">Each action asks the agent, which edits the project on your Mac and saves a new version. For hands-on trimming, open the project in the editor.</p>}
        </div>
      ) : <p className="text-xs text-muted-foreground">Select a clip to trim, replace, delete or ask the agent about it.</p>}
    </section>
  );
}
