"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Circle, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoTip } from "./info-tip";
import type { VideoStatus } from "@/lib/studio/video-transcription";
import { describeVideoState, isWorking, videoProgressView } from "@/lib/studio/video-state-text";

const clock = (seconds: number) => new Date(seconds * 1000).toISOString().slice(11, 19);
export function VideoTranscriptionPanel({ locationId, recordId, canTranscribe, status, hasTranscript = false }: { locationId: string; recordId: string; canTranscribe: boolean; status: VideoStatus; hasTranscript?: boolean }) {
  const router = useRouter(); const key = useRef<string | null>(null);
  const [pending, setPending] = useState(false); const [message, setMessage] = useState("");
  const latest = status.latest;
  async function request() {
    setPending(true); setMessage(""); key.current ||= crypto.randomUUID();
    try {
      const response = await fetch("/api/studio/video-transcription", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Tenant": locationId }, body: JSON.stringify({ recordId, requestKey: key.current }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Try again.");
      key.current = null;
      setMessage(result.status === "not_queued" ? result.message : "Queued on your Mac."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not connect. Retry."); } finally { setPending(false); }
  }
  const { tone, text: state } = describeVideoState(latest, status.waiting, status.busyWith);
  // Live status: while a run is queued or working the page re-reads itself, so nobody has to refresh.
  const working = isWorking(latest);
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 4000);
    return () => clearInterval(timer);
  }, [working, router]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!working) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [working]);
  const progress = latest ? videoProgressView(latest, now) : null;
  const canRun = canTranscribe && (!latest || !["queued", "running"].includes(latest.status));
  const icon = tone === "ok" ? <Check aria-hidden="true" className="h-4 w-4 text-emerald-600" /> : tone === "warn" ? <TriangleAlert aria-hidden="true" className="h-4 w-4 text-amber-600" /> : tone === "bad" ? <TriangleAlert aria-hidden="true" className="h-4 w-4 text-destructive" /> : tone === "busy" ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null;
  return <section aria-label="Mac transcription" className="space-y-2 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5" role="status">{icon}<span className={tone === "bad" ? "text-destructive" : "text-muted-foreground"} aria-live="polite">{state}</span></span>
      {canRun ? <Button type="button" size="sm" variant={hasTranscript ? "outline" : "default"} disabled={pending} onClick={() => void request()}>{pending ? "Requesting…" : latest?.status === "suggested" || !latest ? "Transcribe on my Mac" : "Transcribe again"}</Button> : null}
      <InfoTip label="About Mac transcription">Audio is transcribed locally on your Mac; YouTube captions are the only fallback. No speaker labels or comments.{status.mac ? ` ${status.mac.name} is ${status.mac.online ? "online" : "offline"}.` : ""}</InfoTip>
    </div>
    {progress ? <div className="space-y-2 rounded-md border p-3" aria-label="Transcription progress">
      <div className="flex items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><div className="h-full bg-primary transition-all" style={{ width: `${progress.percent}%` }} /></div><span className="w-10 text-right text-xs tabular-nums">{progress.percent}%</span></div>
      <ol className="space-y-1 text-xs">{progress.steps.map(step => <li key={step.label} className={`flex items-start gap-2 ${step.state === "todo" ? "text-muted-foreground" : ""}`}>
        {step.state === "done" ? <Check aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 text-emerald-600" /> : step.state === "active" ? <Loader2 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 animate-spin" /> : <Circle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5" />}
        <span className={step.state === "active" ? "font-medium" : ""}>{step.label}{step.detail ? <span className="font-normal text-muted-foreground"> — {step.detail}</span> : null}</span></li>)}</ol>
      <p className="text-xs text-muted-foreground">{progress.stalledSeconds > 120 ? `No update from your Mac for ${Math.round(progress.stalledSeconds / 60)} minutes. It may be asleep or busy; this page keeps checking.` : `This step has run for ${progress.phaseSeconds < 90 ? `${progress.phaseSeconds} seconds` : `${Math.round(progress.phaseSeconds / 60)} minutes`}. Updated ${progress.stalledSeconds} seconds ago.`} A short video usually takes a few minutes in total.</p>
    </div> : null}
    {status.lastAttempt ? <p className="text-xs text-muted-foreground">A newer attempt ({status.lastAttempt.status}) did not replace this: {(status.lastAttempt.error_message ?? "no reason was recorded").replace(/\.+$/, "")}. Press Transcribe again to retry.</p> : null}
    {latest && latest.status === "ready" && latest.transcript_applied === false ? <p className="text-xs text-muted-foreground">A transcript you saved earlier was kept; the Mac transcript is stored but not applied.</p> : null}
    {status.frames.length ? <details><summary className="cursor-pointer text-xs font-medium">Slides and frames ({status.frames.length})</summary>
      <ul className="mt-2 space-y-3">{status.frames.map(f => <li key={f.frame_index} className="space-y-1">
        <a href={`/studio/video-frames/${status.framesFrom}/${f.frame_index}`} target="_blank" rel="noopener noreferrer" className="text-primary underline">Frame at {clock(f.time_seconds)}</a>
        {f.ocr_text ? <p className="whitespace-pre-wrap break-words">{f.ocr_text}</p> : <p className="text-muted-foreground">No text read.</p>}</li>)}</ul></details> : null}
    {message ? <p role="status" className="text-xs">{message}</p> : null}
  </section>;
}
