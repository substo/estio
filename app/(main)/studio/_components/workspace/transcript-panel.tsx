"use client";
import { useEffect, useRef, useState } from "react";
import { activeWord, type TranscriptLine } from "@/lib/studio/workspace/transcript";

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** The script as the video says it: the word being spoken is highlighted as the video plays, and a click on any word plays from there. */
export function TranscriptPanel({ lines, videoRef, onEditScript }: { lines: TranscriptLine[]; videoRef: React.RefObject<HTMLVideoElement | null>; onEditScript: () => void }) {
  const [time, setTime] = useState(0);
  const activeEl = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let frame = 0;
    const tick = () => { setTime(video.currentTime); frame = video.paused ? 0 : requestAnimationFrame(tick); };
    const start = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(tick); };
    const once = () => setTime(video.currentTime);
    video.addEventListener("play", start); video.addEventListener("seeked", once); video.addEventListener("timeupdate", once);
    once();
    return () => { cancelAnimationFrame(frame); video.removeEventListener("play", start); video.removeEventListener("seeked", once); video.removeEventListener("timeupdate", once); };
  }, [videoRef, lines]);
  const active = activeWord(lines, time);
  useEffect(() => { activeEl.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [active?.line]);
  const seek = (t: number) => { const v = videoRef.current; if (!v) return; v.currentTime = t; void v.play().catch(() => undefined); };
  return (
    <section aria-label="Transcript" className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Transcript</h2>
        <button type="button" onClick={onEditScript} className="min-h-11 text-xs text-primary hover:underline">Edit the script</button>
      </div>
      <ol className="max-h-72 space-y-3 overflow-y-auto pr-1">
        {lines.map(line => (
          <li key={line.index} className="flex gap-3">
            <button type="button" onClick={() => seek(line.start)} aria-label={`Play from ${clock(line.start)}`} className="mt-0.5 w-10 shrink-0 text-left text-xs tabular-nums text-muted-foreground hover:text-foreground">{clock(line.start)}</button>
            <p className="leading-relaxed">{line.words.map((w, i) => {
              const on = active?.line === line.index && active.word === i;
              return <button key={i} type="button" ref={on ? activeEl : undefined} onClick={() => seek(w.start)} aria-current={on ? "true" : undefined}
                className={`inline rounded px-0.5 text-left hover:bg-accent ${on ? "bg-primary text-primary-foreground" : ""}`}>{w.text}{" "}</button>;
            })}</p>
          </li>))}
      </ol>
      <p className="text-xs text-muted-foreground">Click a word to play from it. Word timing is estimated within each narration clip.</p>
    </section>
  );
}
