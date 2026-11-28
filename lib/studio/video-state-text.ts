/** Pure: the plain-English status line for a Mac transcription on a Library source (shared by the page and its tests). */
export type VideoWaiting = null | "mac_offline" | "mac_paused" | "processing_off" | "tools_missing" | "mac_busy";
interface Run {
  status: string; method: string | null; error_code: string | null; error_message: string | null; segment_count: number; visual_status: string; visual_error: string | null;
  relevance: { score: number; reason: string } | null;
  progress?: { phase: string; percent: number | null; detail: string; at: string; since: string } | null;
}
/** The stages a Mac transcription goes through, in order, with where each sits on the overall bar. */
export const videoStages = [
  { phase: "info", label: "Check the video on YouTube", from: 0, to: 5 },
  { phase: "download", label: "Download the video", from: 5, to: 20 },
  { phase: "transcribe", label: "Transcribe the speech on your Mac", from: 20, to: 55 },
  { phase: "save", label: "Save the transcript with timestamps", from: 55, to: 60 },
  { phase: "slides_scan", label: "Find the slide changes", from: 60, to: 70 },
  { phase: "slides_read", label: "Read the text on each slide", from: 70, to: 95 },
  { phase: "slides_save", label: "Save the slides", from: 95, to: 100 },
] as const;
export interface VideoProgressView {
  percent: number; steps: Array<{ label: string; state: "done" | "active" | "todo"; detail?: string }>; stalledSeconds: number; phaseSeconds: number; fallback: boolean;
}
/** Pure: the checklist and overall percentage of a running transcription. `now` is injectable for tests. */
export function videoProgressView(run: Pick<Run, "status" | "progress">, now = Date.now()): VideoProgressView | null {
  if (run.status !== "running" || !run.progress) return null;
  const p = run.progress; const fallback = p.phase === "captions";
  const index = Math.max(0, videoStages.findIndex(stage => stage.phase === (fallback ? "transcribe" : p.phase)));
  const stage = videoStages[index];
  const within = p.percent === null || p.percent === undefined ? 0 : Math.min(100, Math.max(0, p.percent)) / 100;
  return {
    percent: Math.round(stage.from + (stage.to - stage.from) * within), fallback,
    steps: videoStages.map((s, i) => ({ label: fallback && s.phase === "transcribe" ? "Use YouTube's captions (the Mac transcript could not run)" : s.label, state: i < index ? "done" : i === index ? "active" : "todo",
      ...(i === index ? { detail: p.percent === null || p.percent === undefined ? p.detail : `${p.detail || ""}${p.detail ? " · " : ""}${Math.round(p.percent)}%` } : {}) })),
    stalledSeconds: Math.max(0, Math.round((now - Date.parse(p.at)) / 1000)), phaseSeconds: Math.max(0, Math.round((now - Date.parse(p.since)) / 1000)),
  };
}
export const waitingText: Record<NonNullable<VideoWaiting>, string> = {
  mac_offline: "Waiting for your Mac to come online. It will start by itself when the companion reconnects; no paid service is used.",
  mac_paused: "Waiting: your Mac is paused in Setup. Resume it and this starts by itself.",
  processing_off: "Waiting: Mac processing is off in Setup. Turn it on and this starts by itself.",
  tools_missing: "Waiting: your Mac is missing transcription tools. Follow the Setup guide on the Mac page.",
  mac_busy: "Waiting for your Mac to finish its current job. This starts by itself next; you do not need to do anything.",
};
export const isWorking = (run: { status: string } | null) => run?.status === "queued" || run?.status === "running";
export function describeVideoState(run: Run | null, waiting: VideoWaiting, busyWith?: string | null): { tone: "none" | "ok" | "warn" | "bad" | "busy"; text: string } {
  if (!run) return { tone: "none", text: "No Mac transcription requested for this source." };
  const reason = (fallback: string) => run.error_message?.trim() || fallback;
  switch (run.status) {
    case "queued": {
      if (waiting) return { tone: "busy", text: waiting === "mac_busy" && busyWith ? `${waitingText.mac_busy.replace("its current job", `its current job (${busyWith})`)}` : waitingText[waiting] };
      return { tone: "busy", text: run.error_message ? `Queued. It will retry by itself: ${run.error_message}` : "Queued. Your Mac picks this up in a few seconds." };
    }
    case "running": return { tone: "busy", text: run.progress ? `Working on your Mac: ${run.progress.detail || "processing"}.` : "Starting on your Mac…" };
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

export type VideoNotQueuedReason = "no_mac" | "processing_off" | "transcription_off" | "tools_missing" | "companion_outdated" | "no_authority" | "service_error";
export const videoNotQueuedMessages: Record<VideoNotQueuedReason, string> = {
  no_mac: "Pair a Mac in Setup to transcribe videos. Nothing was sent to a paid service.",
  processing_off: "Turn Mac processing on in Setup to transcribe videos.",
  transcription_off: "Turn on Video transcription in your Mac's Setup, then transcribe again.",
  tools_missing: "Your Mac is missing transcription tools. Follow the Mac Setup guide, then transcribe again.",
  companion_outdated: "Update the Studio companion on your Mac (it does not support video transcription yet).",
  service_error: "Studio couldn’t request transcription. Try again from this source.",
  no_authority: "Only a Business admin with a paired Mac can run Mac transcription.",
};
export function readVideoNotQueuedReason(value: unknown): VideoNotQueuedReason | null {
  return typeof value === "string" && Object.hasOwn(videoNotQueuedMessages, value) ? value as VideoNotQueuedReason : null;
}
