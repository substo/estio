"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoTip } from "./info-tip";
import type { VideoStatus } from "@/lib/studio/video-transcription";
import { describeVideoState, isWorking } from "@/lib/studio/video-state-text";

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
  const canRun = canTranscribe && (!latest || !["queued", "running"].includes(latest.status));
  const icon = tone === "ok" ? <Check aria-hidden="true" className="h-4 w-4 text-emerald-600" /> : tone === "warn" ? <TriangleAlert aria-hidden="true" className="h-4 w-4 text-amber-600" /> : tone === "bad" ? <TriangleAlert aria-hidden="true" className="h-4 w-4 text-destructive" /> : tone === "busy" ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null;
  return <section aria-label="Mac transcription" className="space-y-2 text-sm">
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5" role="status">{icon}<span className={tone === "bad" ? "text-destructive" : "text-muted-foreground"} aria-live="polite">{state}</span></span>
      {canRun ? <Button type="button" size="sm" variant={hasTranscript ? "outline" : "default"} disabled={pending} onClick={() => void request()}>{pending ? "Requesting…" : latest?.status === "suggested" || !latest ? "Transcribe on my Mac" : "Transcribe again"}</Button> : null}
      <InfoTip label="About Mac transcription">Audio is transcribed locally on your Mac; YouTube captions are the only fallback. No speaker labels or comments.{status.mac ? ` ${status.mac.name} is ${status.mac.online ? "online" : "offline"}.` : ""}</InfoTip>
    </div>
    {status.lastAttempt ? <p className="text-xs text-muted-foreground">A newer attempt did not replace this: {status.lastAttempt.status === "failed" ? (status.lastAttempt.error_message ?? "it failed") : status.lastAttempt.status}.</p> : null}
    {latest && latest.status === "ready" && latest.transcript_applied === false ? <p className="text-xs text-muted-foreground">A transcript you saved earlier was kept; the Mac transcript is stored but not applied.</p> : null}
    {status.frames.length ? <details><summary className="cursor-pointer text-xs font-medium">Slides and frames ({status.frames.length})</summary>
      <ul className="mt-2 space-y-3">{status.frames.map(f => <li key={f.frame_index} className="space-y-1">
        <a href={`/studio/video-frames/${status.framesFrom}/${f.frame_index}`} target="_blank" rel="noopener noreferrer" className="text-primary underline">Frame at {clock(f.time_seconds)}</a>
        {f.ocr_text ? <p className="whitespace-pre-wrap break-words">{f.ocr_text}</p> : <p className="text-muted-foreground">No text read.</p>}</li>)}</ul></details> : null}
    {message ? <p role="status" className="text-xs">{message}</p> : null}
  </section>;
}
