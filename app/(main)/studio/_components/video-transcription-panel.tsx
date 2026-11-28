"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Circle, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { VideoStatus } from "@/lib/studio/video-transcription";
import { VideoSlideTimeline } from "./video-slide-timeline";
import { jumpTo, Section } from "./source-sections";
import { slideTerms } from "@/lib/studio/video-slide-terms";
import { describeVideoState, isWorking, readVideoNotQueuedReason, videoNotQueuedMessages, videoProgressView, type VideoNotQueuedReason } from "@/lib/studio/video-state-text";

export function VideoTranscriptionPanel({ locationId, recordId, status, hasTranscript, initialIssue }: {
  locationId: string; recordId: string; status: VideoStatus; hasTranscript: boolean; initialIssue?: VideoNotQueuedReason | null;
}) {
  const router = useRouter();
  const key = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [awaitingRun, setAwaitingRun] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [issue, setIssue] = useState(initialIssue ?? null);
  const latest = status.latest;
  const working = isWorking(latest);
  const waitingForNewRun = Boolean(awaitingRun && awaitingRun !== latest?.id && awaitingRun !== status.lastAttempt?.id);
  const busy = working || pending || waitingForNewRun;
  const progress = latest ? videoProgressView(latest) : null;
  const currentStep = progress?.steps.find(step => step.state === "active");
  const { tone, text } = describeVideoState(latest, status.waiting, status.busyWith);
  const failure = status.lastAttempt ?? (tone === "bad" ? latest : null);
  const recovery = message || (failure ? failure.error_message ?? text : !latest && issue ? videoNotQueuedMessages[issue] : "");
  const computerSetup = Boolean((!latest || message) && issue && !["no_authority", "service_error"].includes(issue))
    || status.waiting === "mac_paused" || status.waiting === "processing_off" || status.waiting === "tools_missing"
    || latest?.error_code === "video_tools_missing";
  const ready = latest?.status === "ready" || latest?.status === "partial";
  const label = pending ? "Requesting transcription…"
    : waitingForNewRun ? "Waiting for your Mac"
    : latest?.status === "queued" && !status.waiting && !latest.error_message ? "Waiting for your Mac"
    : currentStep?.label ?? (latest?.status === "running" ? "Starting on your Mac…" : working ? "Transcription queued"
      : failure ? "Transcription stopped" : ready ? "Transcript ready" : "Transcribe this video");

  useEffect(() => {
    if (awaitingRun && !waitingForNewRun) setAwaitingRun(null);
  }, [awaitingRun, waitingForNewRun]);

  useEffect(() => {
    if (!working && !waitingForNewRun) return;
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const timer = setInterval(refresh, 3000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [working, waitingForNewRun, router]);
  useEffect(() => {
    if (!waitingForNewRun) return;
    const timer = setTimeout(() => {
      setAwaitingRun(null);
      setMessage("Studio couldn’t confirm the new run. Try again from this source.");
    }, 30_000);
    return () => clearTimeout(timer);
  }, [waitingForNewRun]);

  async function request() {
    if (busy) return;
    setPending(true); setMessage(""); key.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/studio/video-transcription", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Tenant": locationId }, body: JSON.stringify({ recordId, requestKey: key.current }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Transcription could not be requested. Try again.");
      if (result.status === "not_queued") {
        setIssue(readVideoNotQueuedReason(result.reason));
        setMessage(result.message);
      } else {
        if (typeof result.transcriptionId === "string" && result.transcriptionId !== latest?.id) setAwaitingRun(result.transcriptionId);
        key.current = null;
        setIssue(null);
        router.refresh();
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not connect. Try again."); }
    finally { setPending(false); }
  }

  function openTranscript(paste = false) {
    if (paste) {
      const editor = document.getElementById("paste-source-transcript");
      if (editor instanceof HTMLDetailsElement) editor.open = true;
    }
    jumpTo("transcript", "transcript", paste ? "pasted-source-transcript" : undefined);
  }

  if (hasTranscript && !latest && !issue && !busy && !message) return null;
  return <section aria-label="Mac transcription" className="space-y-3 rounded-xl border bg-card p-3 text-sm md:p-4">
    <div className="flex items-start gap-3" aria-live="polite" aria-atomic="true">
      {busy ? <Loader2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary motion-safe:animate-spin" />
        : failure || recovery || tone === "warn" ? <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        : ready ? <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : null}
      <div className="min-w-0">
        <h2 className="font-semibold">{label}</h2>
        {busy && !pending ? <p className="mt-1 break-words text-muted-foreground">{currentStep?.detail || (latest?.status === "queued" && (status.waiting || latest.error_message) ? text
          : "You can stay here while Studio checks for updates.")}</p> : null}
        {progress && progress.stalledSeconds > 120 ? <p className="mt-1 text-muted-foreground">No recent update from your Mac. Studio is still checking.</p> : null}
        {!busy && recovery ? <p className="mt-1 break-words text-muted-foreground">{recovery}</p> : null}
        {!busy && ready && !recovery ? <p className="mt-1 text-muted-foreground">{latest?.transcript_applied === false
          ? "Your existing transcript is still saved. Retry transcription to use the Mac’s version."
          : latest?.status === "partial" ? text : latest?.method === "youtube-captions-fallback" ? "Saved from YouTube captions." : "Saved with timestamps from your Mac."}</p> : null}
        {!busy && !recovery && (latest?.status === "suggested" || latest?.status === "skipped") ? <p className="mt-1 text-muted-foreground">{text}</p> : null}
      </div>
    </div>
    {busy ? <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Transcription progress" {...(progress ? { "aria-valuenow": progress.percent } : {})}>
      <div className={progress ? "h-full rounded-full bg-primary motion-safe:transition-[width]" : "h-full w-1/3 rounded-full bg-primary motion-safe:animate-pulse"} style={progress ? { width: `${Math.max(2, progress.percent)}%` } : undefined} />
    </div> : null}
    {progress ? <details>
      <summary className="cursor-pointer font-medium text-primary">View transcription stages</summary>
      <ol className="mt-2 space-y-1 text-xs">{progress.steps.map(step => <li key={step.label} aria-current={step.state === "active" ? "step" : undefined} className="flex items-start gap-2">
        {step.state === "done" ? <Check aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" />
          : step.state === "active" ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 motion-safe:animate-spin" /> : <Circle aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />}
        <span>{step.label}<span className="sr-only">, {step.state === "done" ? "complete" : step.state === "active" ? "in progress" : "up next"}</span></span>
      </li>)}</ol>
    </details> : null}
    {!busy || computerSetup ? <div className="flex flex-wrap items-center gap-2">
      {!busy ? <Button type="button" size="sm" variant={ready ? "outline" : "default"} className="min-h-10" onClick={() => void request()}>{failure || recovery || ready ? "Retry transcription" : "Transcribe on my Mac"}</Button> : null}
      {computerSetup ? <Button size="sm" variant="outline" className="min-h-10" asChild><Link href="/settings/computer?from=studio">Open Mac Setup</Link></Button> : null}
      {!busy && hasTranscript ? <Button type="button" size="sm" variant="ghost" className="min-h-10" onClick={() => openTranscript()}>Read transcript</Button> : null}
      {!busy && !hasTranscript ? <Button type="button" size="sm" variant="ghost" className="min-h-10" onClick={() => openTranscript(true)}>Paste a transcript</Button> : null}
    </div> : null}
  </section>;
}

/** The slides along the video, in a section of their own that can be hidden. */
export function VideoSlidesSection({ status, transcript }: { status: VideoStatus; transcript: string }) {
  if (!status.frames.length || !status.framesFrom) return null;
  const t = slideTerms(status.frames, transcript);
  return <Section id="slides" title="Slides" count={String(status.frames.length)}>
    <VideoSlideTimeline transcriptionId={status.framesFrom} frames={status.frames} duration={status.history.find(h => h.id === status.framesFrom)?.duration_seconds ?? null} />
    <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
      {t.slidesWithText} of {t.slides} slides had readable text. {t.terms ? `${t.inSpeech} of ${t.terms} names and terms on the slides were also spoken in the video.` : ""}{" "}
      {t.missing.length ? `Not heard in the speech (possibly mis-heard, or only shown): ${t.missing.join(", ")}. ` : ""}
      Slide text is kept as separate evidence; it does not change the transcript.</p>
  </Section>;
}
