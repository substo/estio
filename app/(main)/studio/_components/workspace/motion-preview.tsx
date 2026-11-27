"use client";
import { useState } from "react";
import { MOTION_STYLES, PLAIN_BACKGROUNDS, type MotionChoice, type MotionPreviewId } from "@/lib/studio/video-assembly/motion-style";

/** A busy stand-in for footage, only here so the creator can see why the plain backdrop is the better place to judge layout. */
const FOOTAGE_STAND_IN = "repeating-linear-gradient(90deg,#c0c0c0 0 12.5%,#c0c000 12.5% 25%,#00c0c0 25% 37.5%,#00c000 37.5% 50%,#c000c0 50% 62.5%,#c00000 62.5% 75%,#0000c0 75% 100%)";

/**
 * What the titles, callouts, cards and lower thirds of the chosen style look like, drawn on a neutral plain backdrop so layout, spacing and readability can be judged
 * (and approved) before they are placed over footage. A preview and QA aid only: the exported video always composites graphics over the real footage.
 */
export function MotionPreview({ choice, accent, mode }: { choice: MotionChoice; accent: string; mode: MotionPreviewId }) {
  const style = MOTION_STYLES[choice.style];
  const [overFootage, setOverFootage] = useState(false);
  const plain = mode === "off" ? null : PLAIN_BACKGROUNDS[mode];
  const showFootage = overFootage || !plain;
  const light = !showFootage && mode === "light";
  const ink = light ? "#111827" : "#ffffff", panel = light ? "#ffffff" : "#111418";
  const upper = style.uppercase ? "uppercase" : "none";
  return (
    <div className="space-y-1.5" data-testid="motion-preview">
      <div role="img" aria-label={`Sample ${style.label} graphics on ${showFootage ? "test footage" : `a plain ${mode} background`}`}
        className="relative aspect-video w-full overflow-hidden rounded-md border text-[10px] leading-tight sm:text-xs" style={{ background: showFootage ? FOOTAGE_STAND_IN : plain! }}>
        <div className="absolute left-[5%] top-[8%] rounded px-2 py-1 font-extrabold" style={{ background: panel, color: ink, borderLeft: `4px solid ${accent}`, textTransform: upper }}>Section title</div>
        <div className="absolute right-[5%] top-[8%] rounded px-2 py-1 text-right" style={{ background: panel, color: ink }}><span className="block text-base font-black sm:text-xl" style={{ color: accent }}>+312%</span><span className="block opacity-80" style={{ textTransform: upper }}>more reach in 30 days</span></div>
        <div className="absolute left-[5%] top-[40%] w-[42%] rounded p-2" style={{ background: panel, color: ink, border: `1px solid ${accent}` }}><span className="block font-bold" style={{ textTransform: upper }}>Card</span><span className="block opacity-80">Short supporting line</span></div>
        <div className="absolute bottom-[26%] left-[5%] flex gap-1.5 rounded px-2 py-1" style={{ background: panel, color: ink }}><span className="w-1" style={{ background: accent }} /><span><span className="block font-bold">Alex Rivera</span><span className="block opacity-80">Founder</span></span></div>
        <div className="absolute inset-x-[5%] bottom-[4%] h-[18%] rounded border border-dashed text-center opacity-70" style={{ borderColor: ink, color: ink }}><span className="block pt-[2%]">Captions only</span></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{showFootage && plain ? "Over test footage: harder to judge." : plain ? `On a plain ${mode === "dark" ? "dark grey" : "light"} backdrop: judge layout here first.` : "Plain preview is off: graphics are judged over your footage."}</span>
        {plain ? <button type="button" onClick={() => setOverFootage(v => !v)} className="min-h-11 rounded-md border px-3 hover:bg-accent focus-visible:outline focus-visible:outline-2" aria-pressed={overFootage}>{overFootage ? "Back to plain backdrop" : "Show over footage"}</button> : null}
      </div>
      <p className="text-xs text-muted-foreground">Preview only. The exported video always places graphics over your footage.</p>
    </div>
  );
}
