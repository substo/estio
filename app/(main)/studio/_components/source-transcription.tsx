"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const labels: Record<string, string> = {
  queued: "Queued: your Mac will transcribe this when it is online.", running: "Your Mac is transcribing this now.", waiting_for_device: "Waiting for your Mac to finish setup (tools or settings), then it retries by itself.",
  no_device: "No Mac is ready to transcribe. Pair one and turn on Transcription in Mac Setup.", failed: "Transcription failed.", skipped: "Not transcribed: the relevance check scored it below the threshold.",
  needs_confirmation: "Possibly relevant. Choose whether to transcribe it.", kept_existing: "A saved transcript already existed, so the Mac transcript was stored separately.", ready: "Transcribed on your Mac.",
};
const actionLabel: Record<string, string> = { failed: "Try again", no_device: "Request again", skipped: "Transcribe anyway", needs_confirmation: "Transcribe on my Mac", none: "Transcribe on my Mac" };
export function SourceTranscription({ locationId, recordId, status, message, method, score, reason, hasTranscript }: { locationId: string; recordId: string; status: string; message?: string; method?: string; score?: number; reason?: string; hasTranscript: boolean }) {
  const router = useRouter(); const [pending, setPending] = useState(false); const [note, setNote] = useState("");
  const key = status || "none"; const canAct = ["failed", "no_device", "skipped", "needs_confirmation", "none"].includes(key) && !(key === "none" && hasTranscript);
  async function request() {
    setPending(true); setNote("");
    try {
      const response = await fetch("/api/studio/library/transcribe", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Tenant": locationId }, body: JSON.stringify({ recordId }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Try again.");
      setNote(result.status === "no_device" ? labels.no_device : result.status === "unsupported" ? "This source is not a YouTube video." : labels.queued); router.refresh();
    } catch (error) { setNote(error instanceof Error ? error.message : "Could not connect. Try again."); } finally { setPending(false); }
  }
  if (key === "none" && hasTranscript) return null;
  return <section aria-label="Video transcription" className="space-y-2 text-sm">
    <h2 className="font-medium">Video transcription</h2>
    <p>{labels[key] ?? "Not requested yet."}{message && ["failed", "no_device", "waiting_for_device"].includes(key) ? ` ${message}` : ""}{key === "ready" && method ? ` (${method === "youtube-captions-fallback" ? "from YouTube captions" : "local speech model"})` : ""}</p>
    {typeof score === "number" ? <p className="text-muted-foreground">Relevance {score}/100{reason ? `: ${reason}` : ""}</p> : null}
    {canAct ? <Button disabled={pending} onClick={request}>{pending ? "Requesting…" : actionLabel[key]}</Button> : null}
    {note ? <p role="status">{note}</p> : null}
  </section>;
}
