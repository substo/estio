"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** First container the browser can record: MP4 where it can (Safari, new Chrome), otherwise WebM (converted on the Mac). */
function recorderType(): { mime: string; extension: "mp4" | "webm" } | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const [mime, extension] of [["video/mp4;codecs=avc1,mp4a.40.2", "mp4"], ["video/mp4", "mp4"], ["video/webm;codecs=vp9,opus", "webm"], ["video/webm;codecs=vp8,opus", "webm"], ["video/webm", "webm"]] as const)
    if (MediaRecorder.isTypeSupported(mime)) return { mime, extension };
  return null;
}
export const canRecordInBrowser = () => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && recorderType() !== null;

/** Record one shot with the camera and microphone. Shows the spoken line to read; the take is only uploaded when the user presses "Use this take". */
export function ShotRecorder({ open, onOpenChange, shot, line, note, onTake }: {
  open: boolean; onOpenChange: (open: boolean) => void; shot: number; line: string; note?: string; onTake: (file: Blob, extension: "mp4" | "webm") => void;
}) {
  const live = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<number | null>(null);
  const [phase, setPhase] = useState<"idle" | "camera" | "recording" | "review">("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [take, setTake] = useState<{ blob: Blob; url: string; extension: "mp4" | "webm" } | null>(null);

  const stopCamera = useCallback(() => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; if (timer.current) window.clearInterval(timer.current); timer.current = null; }, []);
  const discard = useCallback(() => setTake(current => { if (current) URL.revokeObjectURL(current.url); return null; }), []);
  const startCamera = useCallback(async () => {
    setError(null);
    try {
      stopCamera();
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
      stream.current = media; setPhase("camera");
    } catch (e) {
      setError(e instanceof DOMException && e.name === "NotAllowedError" ? "Camera or microphone access was blocked. Allow it in your browser, or upload a video instead." : "No camera or microphone could be opened. Upload a video instead.");
    }
  }, [stopCamera]);
  useEffect(() => { if ((phase === "camera" || phase === "recording") && live.current && stream.current) { live.current.srcObject = stream.current; void live.current.play().catch(() => {}); } }, [phase]);
  useEffect(() => { if (!open) { recorder.current?.state === "recording" && recorder.current.stop(); stopCamera(); discard(); setPhase("idle"); setError(null); } }, [open, stopCamera, discard]);
  useEffect(() => () => { stopCamera(); }, [stopCamera]);

  const start = () => {
    const type = recorderType(); if (!type || !stream.current) return;
    chunks.current = []; setSeconds(0);
    const r = new MediaRecorder(stream.current, { mimeType: type.mime });
    r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = () => {
      const blob = new Blob(chunks.current, { type: type.mime.split(";")[0] });
      stopCamera();
      if (!blob.size) { setError("Nothing was recorded. Try again."); setPhase("idle"); return; }
      setTake({ blob, url: URL.createObjectURL(blob), extension: type.extension }); setPhase("review");
    };
    recorder.current = r; r.start(1000); setPhase("recording");
    timer.current = window.setInterval(() => setSeconds(s => s + 1), 1000);
  };
  const stop = () => { if (timer.current) window.clearInterval(timer.current); timer.current = null; recorder.current?.stop(); };
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const btn = "inline-flex min-h-11 items-center justify-center rounded-md px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

  return (
    <Dialog open={open} onOpenChange={next => { if (phase === "recording" && !next) return; onOpenChange(next); }}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Record shot {shot}</DialogTitle>
          <DialogDescription>Read the line below to your camera. Nothing is saved until you press Use this take.</DialogDescription></DialogHeader>
        {note ? <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground"><span className="font-medium">Scene:</span> {note}</p> : null}
        <p className="rounded-md border p-3 text-base leading-relaxed" data-testid="teleprompter">{line}</p>
        {phase === "review" && take ? <video key={take.url} src={take.url} controls playsInline className="aspect-video w-full rounded-lg bg-black" aria-label="Your take" />
          : phase === "camera" || phase === "recording" ? <video ref={live} muted playsInline autoPlay className="aspect-video w-full -scale-x-100 rounded-lg bg-black" aria-label="Camera preview" />
          : <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">Camera is off</div>}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          {phase === "idle" ? <button type="button" onClick={() => void startCamera()} className={`${btn} bg-primary text-primary-foreground`}>Turn on camera</button> : null}
          {phase === "camera" ? <button type="button" onClick={start} className={`${btn} bg-destructive text-destructive-foreground`}>Start recording</button> : null}
          {phase === "recording" ? <><button type="button" onClick={stop} className={`${btn} bg-destructive text-destructive-foreground`}>Stop</button><span role="timer" aria-live="off" className="text-sm tabular-nums text-destructive">● {clock}</span></> : null}
          {phase === "review" && take ? <>
            <button type="button" onClick={() => { onTake(take.blob, take.extension); onOpenChange(false); }} className={`${btn} bg-primary text-primary-foreground`}>Use this take</button>
            <button type="button" onClick={() => { discard(); setPhase("idle"); void startCamera(); }} className={`${btn} border hover:bg-accent`}>Record again</button></> : null}
          {phase !== "recording" ? <button type="button" onClick={() => onOpenChange(false)} className={`${btn} border hover:bg-accent`}>Cancel</button> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
