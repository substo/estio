"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { VideoStatus } from "@/lib/studio/video-transcription";

const clock = (seconds: number) => new Date(seconds * 1000).toISOString().slice(11, 19);
const waitingText: Record<NonNullable<VideoStatus["waiting"]>, string> = {
  mac_offline: "Waiting for your Mac to come online. It will start by itself when the companion reconnects; no paid service is used.",
  mac_paused: "Waiting: your Mac is paused in Setup.", processing_off: "Waiting: Mac processing is off in Setup.",
  tools_missing: "Waiting: your Mac is missing transcription tools. Follow the Setup guide on the Mac page.",
};
export function VideoTranscriptionPanel({ locationId, recordId, canTranscribe, status }: { locationId: string; recordId: string; canTranscribe: boolean; status: VideoStatus }) {
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
  const state = !latest ? "No Mac transcription requested for this source."
    : latest.status === "queued" ? (status.waiting ? waitingText[status.waiting] : "Queued on your Mac.")
    : latest.status === "running" ? "Transcribing on your Mac…"
    : latest.status === "ready" ? `Transcript and slides saved (${latest.method === "youtube-captions-fallback" ? "YouTube captions fallback" : "local Parakeet"}).`
    : latest.status === "partial" ? `Transcript saved; slides/frames incomplete: ${latest.visual_error ?? "the visual pass failed"}.`
    : latest.status === "suggested" ? (latest.relevance ? `Suggested (relevance ${latest.relevance.score}/100): ${latest.relevance.reason}` : latest.error_message ?? "Suggested only.")
    : latest.status === "skipped" ? (latest.relevance ? `Skipped, low relevance (${latest.relevance.score}/100): ${latest.relevance.reason}` : latest.error_message ?? "Skipped.")
    : latest.status === "cancelled" ? latest.error_message ?? "Cancelled." : `Failed: ${latest.error_message ?? "transcription did not complete"}`;
  const canRun = canTranscribe && (!latest || !["queued", "running"].includes(latest.status));
  return <section aria-label="Mac transcription" className="space-y-2 rounded-xl border p-4 text-sm">
    <h2 className="font-medium">Mac transcription</h2>
    <p role="status">{state}</p>
    {latest && latest.status === "ready" && latest.transcript_applied === false ? <p className="text-muted-foreground">A transcript you saved earlier was kept; the Mac transcript is stored but not applied.</p> : null}
    {status.mac ? <p className="text-muted-foreground">{status.mac.name}: {status.mac.online ? "online" : "offline"}</p> : null}
    {status.frames.length ? <details><summary className="cursor-pointer font-medium">Slides and frames ({status.frames.length})</summary>
      <ul className="mt-2 space-y-3">{status.frames.map(f => <li key={f.frame_index} className="space-y-1">
        <a href={`/studio/video-frames/${latest!.id}/${f.frame_index}`} target="_blank" rel="noopener noreferrer" className="text-primary underline">Frame at {clock(f.time_seconds)}</a>
        {f.ocr_text ? <p className="whitespace-pre-wrap break-words">{f.ocr_text}</p> : <p className="text-muted-foreground">No text read.</p>}</li>)}</ul></details> : null}
    {canRun ? <Button type="button" disabled={pending} onClick={() => void request()}>{pending ? "Requesting…" : latest?.status === "suggested" ? "Transcribe on my Mac" : latest ? "Transcribe again on my Mac" : "Transcribe on my Mac"}</Button> : null}
    {message ? <p role="status">{message}</p> : null}
    <p className="text-xs text-muted-foreground">Audio is transcribed locally; YouTube captions are the only fallback. No speaker labels or comments.</p>
  </section>;
}
