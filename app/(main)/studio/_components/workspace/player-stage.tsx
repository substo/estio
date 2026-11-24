"use client";
import { AlertTriangle, Check, Circle, Loader2 } from "lucide-react";
import type { Step } from "@/lib/studio/workspace/stepper";
import type { VideoVersion } from "@/lib/studio/video-assembly-policy";
import { formatBytes } from "@/lib/studio/workspace/assets";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const icon = { done: <Check aria-hidden className="h-4 w-4 text-emerald-600" />, active: <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />, pending: <Circle aria-hidden className="h-4 w-4 text-muted-foreground" />, failed: <AlertTriangle aria-hidden className="h-4 w-4 text-destructive" /> };

/** The video, its versions, and an honest one-line progress while a job runs. */
export function PlayerStage({ versions, versionId, onVersion, steps, empty }: {
  versions: VideoVersion[]; versionId: string; onVersion: (id: string) => void; steps: Step[] | null; empty: React.ReactNode;
}) {
  const current = versions.find(v => v.id === versionId) ?? versions[0];
  return (
    <section aria-label="Video" className="space-y-3">
      {steps ? (
        <ol aria-label="Progress" className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border bg-card px-3 py-2 text-sm" aria-live="polite">
          {steps.map(s => <li key={s.key} className="flex items-center gap-2" aria-current={s.state === "active" ? "step" : undefined}>{icon[s.state]}<span className={s.state === "pending" ? "text-muted-foreground" : ""}>{s.label}{s.detail ? ` · ${s.detail}` : ""}</span></li>)}
        </ol>
      ) : null}
      {current ? (
        <>
          <video key={current.id} controls preload="metadata" playsInline className="aspect-video w-full rounded-lg bg-black" src={`/studio/uploads/${current.id}?inline=1`} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{current.name} · {formatBytes(current.bytes)}</span>
            {versions.length > 1 ? <label className="flex items-center gap-2">Version
              <select value={current.id} onChange={e => onVersion(e.target.value)} className="min-h-11 rounded-md border bg-background px-2 text-sm text-foreground">
                {versions.map((v, i) => <option key={v.id} value={v.id}>{i === 0 ? "Latest · " : ""}{when(v.createdAt)} · {formatBytes(v.bytes)}</option>)}
              </select></label> : null}
          </div>
        </>
      ) : <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center text-sm">{empty}</div>}
    </section>
  );
}
