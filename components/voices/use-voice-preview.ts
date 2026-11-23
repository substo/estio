"use client";
import { useRef, useState } from "react";

/** Play a voice sample: hosted voices stream audio back; on-device voices queue a short sample on the Mac and poll for it. */
export function usePreview(locationId: string, voiceId: string) {
  const [state, setState] = useState<{ busy: boolean; note?: string; error?: string }>({ busy: false });
  const audio = useRef<HTMLAudioElement>(null);
  const play = (src: string) => { if (audio.current) { audio.current.src = src; void audio.current.play().catch(() => {}); } };
  async function run() {
    setState({ busy: true });
    try {
      const response = await fetch("/api/studio/voices/preview", { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Tenant": locationId }, body: JSON.stringify({ voiceId }) });
      if (response.status === 202) {
        const { jobId } = await response.json() as { jobId: string };
        setState({ busy: true, note: "Your Mac is generating a sample…" });
        for (let i = 0; i < 90; i++) {
          await new Promise(r => setTimeout(r, 2000));
          const poll = await fetch(`/api/studio/voices/preview?job=${jobId}`, { headers: { "X-Studio-Tenant": locationId } });
          const body = await poll.json().catch(() => ({})) as { status?: string; audioBase64?: string; message?: string; error?: string };
          if (body.status === "done" && body.audioBase64) { play(`data:audio/mpeg;base64,${body.audioBase64}`); setState({ busy: false }); return; }
          if (body.status === "failed" || body.error) { setState({ busy: false, error: body.message ?? body.error ?? "The Mac could not generate the preview." }); return; }
        }
        setState({ busy: false, error: "The Mac did not answer in time. Check that the companion is running." }); return;
      }
      if (!response.ok) { setState({ busy: false, error: (await response.json().catch(() => ({}))).error ?? "Could not preview this voice." }); return; }
      play(URL.createObjectURL(await response.blob())); setState({ busy: false });
    } catch { setState({ busy: false, error: "Could not preview this voice." }); }
  }
  return { state, run, audio };
}
