"use client";
import { useState } from "react";
import type { VideoFrameView } from "@/lib/studio/video-transcription";
import { usableSlideText } from "@/lib/studio/video-slide-terms";
import { StarButton } from "./source-sections";

const clock = (seconds: number) => { const s = Math.max(0, Math.floor(seconds)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`; };
/** The video's slides along its length, like a scrubber: a ruler with a mark per slide, a filmstrip of previews, and the hovered slide with what was said then. */
export function VideoSlideTimeline({ transcriptionId, frames, duration }: { transcriptionId: string; frames: VideoFrameView[]; duration: number | null }) {
  const length = Math.max(duration ?? 0, ...frames.map(f => f.time_seconds + 1), 1);
  const [active, setActive] = useState(0);
  const current = frames[Math.min(active, frames.length - 1)];
  const src = (f: VideoFrameView) => `/studio/video-frames/${transcriptionId}/${f.frame_index}`;
  if (!current) return null;
  return <div className="space-y-3" aria-label="Slides along the video">
    <div className="relative h-7 rounded-md bg-muted" role="presentation">
      {frames.map((f, i) => <button key={f.frame_index} type="button" tabIndex={-1} aria-label={`Slide at ${clock(f.time_seconds)}`} onMouseEnter={() => setActive(i)} onClick={() => setActive(i)}
        className={`absolute top-0 h-full w-1 -translate-x-1/2 rounded-sm transition-colors ${i === active ? "bg-primary" : "bg-primary/35 hover:bg-primary/70"}`} style={{ left: `${(f.time_seconds / length) * 100}%` }} />)}
      <span className="absolute -bottom-4 left-0 text-[10px] text-muted-foreground">0:00</span><span className="absolute -bottom-4 right-0 text-[10px] text-muted-foreground">{clock(length)}</span>
    </div>
    <div className="mt-6 flex snap-x gap-2 overflow-x-auto pb-2" role="listbox" aria-label="Slide previews">
      {frames.map((f, i) => <button key={f.frame_index} type="button" role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={() => setActive(i)}
        className={`group relative aspect-video w-36 shrink-0 snap-start overflow-hidden rounded-md border bg-muted text-left outline-none transition ${i === active ? "ring-2 ring-primary" : "opacity-80 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-primary"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src(f)} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        <span className="absolute bottom-0 left-0 rounded-tr bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">{clock(f.time_seconds)}</span></button>)}
    </div>
    <div className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-[minmax(0,16rem)_1fr]" aria-live="polite">
      <a href={src(current)} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-md bg-muted" aria-label={`Open the slide at ${clock(current.time_seconds)} full size`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src(current)} alt={`Slide at ${clock(current.time_seconds)}`} className="aspect-video w-full object-cover" /></a>
      <div className="min-w-0 space-y-2 text-sm">
        <p className="font-medium tabular-nums">{clock(current.time_seconds)} <span className="font-normal text-muted-foreground">· on screen from {clock(current.scene_start)} to {clock(current.scene_end)}</span><StarButton kind="slide" id={`f${current.frame_index}`} at={Math.floor(current.time_seconds)} label={`the slide at ${clock(current.time_seconds)}`} excerpt={(usableSlideText(current.ocr_text) ? current.ocr_text : current.audio_context) || `Slide at ${clock(current.time_seconds)}`} /></p>
        <div><p className="text-xs font-medium text-muted-foreground">Said around then</p><p className="break-words">{current.audio_context || "Nothing was said."}</p></div>
        <div><p className="text-xs font-medium text-muted-foreground">Text on the slide</p>
          <p className="break-words">{usableSlideText(current.ocr_text) ? current.ocr_text : "No readable text (a picture, or the text was too small)."}</p></div>
      </div>
    </div>
  </div>;
}
