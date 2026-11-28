/** Pure: the plain-English status line for a Mac transcription on a Library source (shared by the page and its tests). */
export type VideoWaiting = null | "mac_offline" | "mac_paused" | "processing_off" | "tools_missing" | "mac_busy";
interface Run {
  status: string; method: string | null; error_code: string | null; error_message: string | null; segment_count: number; visual_status: string; visual_error: string | null;
  relevance: { score: number; reason: string } | null;
}
export const waitingText: Record<NonNullable<VideoWaiting>, string> = {
  mac_offline: "Step 1 of 4, waiting for your Mac to come online. It will start by itself when the companion reconnects; no paid service is used.",
  mac_paused: "Step 1 of 4, waiting: your Mac is paused in Setup. Resume it and this starts by itself.",
  processing_off: "Step 1 of 4, waiting: Mac processing is off in Setup. Turn it on and this starts by itself.",
  tools_missing: "Step 1 of 4, waiting: your Mac is missing transcription tools. Follow the Setup guide on the Mac page.",
  mac_busy: "Step 1 of 4, waiting for your Mac to finish its current job. This starts by itself next; you do not need to do anything.",
};
export const isWorking = (run: { status: string } | null) => run?.status === "queued" || run?.status === "running";
export function describeVideoState(run: Run | null, waiting: VideoWaiting, busyWith?: string | null): { tone: "none" | "ok" | "warn" | "bad" | "busy"; text: string } {
  if (!run) return { tone: "none", text: "No Mac transcription requested for this source." };
  const reason = (fallback: string) => run.error_message?.trim() || fallback;
  switch (run.status) {
    case "queued": {
      if (waiting) return { tone: "busy", text: waiting === "mac_busy" && busyWith ? `${waitingText.mac_busy.replace("its current job", `its current job (${busyWith})`)}` : waitingText[waiting] };
      return { tone: "busy", text: run.error_message ? `Step 1 of 4, queued. It will retry by itself: ${run.error_message}` : "Step 1 of 4, queued. Your Mac picks this up in a few seconds." };
    }
    case "running": return { tone: "busy", text: run.segment_count > 0
      ? "Step 3 of 4, transcript saved. Reading slides and frames on your Mac…" : "Step 2 of 4, getting captions or transcribing the audio on your Mac…" };
    case "ready": return { tone: "ok", text: `Done. Transcript and slides saved (${run.method === "youtube-captions-fallback" ? "YouTube captions" : "local Parakeet"}).` };
    case "partial": return { tone: "warn", text: `Done, with a gap. Transcript saved; slides/frames incomplete: ${(run.visual_error ?? "the visual pass failed").replace(/\.+$/, "")}.` };
    case "suggested": return { tone: "none", text: run.relevance ? `Suggested (relevance ${run.relevance.score}/100): ${run.relevance.reason}` : reason("Suggested only.") };
    case "skipped": return { tone: "none", text: run.relevance ? `Skipped, low relevance (${run.relevance.score}/100): ${run.relevance.reason}` : reason("Skipped.") };
    case "cancelled": return { tone: "bad", text: `Cancelled: ${reason("no reason was recorded.")} Press Transcribe again to restart it.` };
    default: {
      const message = reason("transcription did not complete.");
      return { tone: "bad", text: `Failed: ${message}${/paste a transcript/i.test(message) ? "" : " Press Transcribe again, or paste a transcript instead."}` };
    }
  }
}
