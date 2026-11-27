"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Circle, Loader2, Video } from "lucide-react";
import { useStudioTenantHeaders } from "../studio-tenant-context";
import { AutoRefresh } from "../auto-refresh";
import { MakeVideoDialog } from "../workspace/make-video-dialog";
import { currentShotFiles, nextTake, shotFileName } from "@/lib/studio/shoot/shots";
import { formatBytes } from "@/lib/studio/workspace/assets";
import { transcribeUploadAction } from "../../(tenant)/content/actions";
import { SHOT_SOUND_LABEL } from "@/lib/studio/shoot/shot-sound";
import type { ShotSoundState } from "@/lib/studio/shoot/shot-sound-server";
import { uploadRecordFile } from "./upload-client";
import { ShotRecorder, canRecordInBrowser } from "./shot-recorder";
import type { Beat } from "@/lib/studio/video-assembly/script";

type FootageFile = { id: string; name: string; byteSize: number };
type Props = { locationId: string; recordId: string; title: string; beats: Beat[]; files: FootageFile[]; soundStates?: Record<string, ShotSoundState>; archived: boolean; busy: boolean; statusLine: string | null; hasVideo: boolean; makeProps: Omit<React.ComponentProps<typeof MakeVideoDialog>, "locationId" | "recordId" | "busy" | "disabledReason" | "trigger"> };

/** The script clip by clip: what the scene is, what to say, and one place to film or upload each shot. */
export function ShootBoard({ locationId, recordId, title, beats, files, soundStates = {}, archived, busy, statusLine, hasVideo, makeProps }: Props) {
  const router = useRouter();
  const headers = useStudioTenantHeaders();
  const current = currentShotFiles(files);
  const filmed = beats.filter(b => current.has(b.index)).length;
  const [uploading, setUploading] = useState<{ shot: number; percent: number } | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [recording, setRecording] = useState<number | null>(null);
  const [canRecord, setCanRecord] = useState(false);
  const inFlight = useRef(false);
  const [checkNotice, setCheckNotice] = useState<Record<string, string>>({});
  const checkSound = async (uploadId: string) => {
    const r = await transcribeUploadAction(locationId, recordId, uploadId).catch(() => ({ error: "Could not start the sound check. Try again." }));
    setCheckNotice(n => ({ ...n, [uploadId]: r.error ?? r.notice ?? "" })); router.refresh();
  };
  useEffect(() => setCanRecord(canRecordInBrowser()), []);

  const send = async (shot: number, blob: Blob | File, extension: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setErrors(e => ({ ...e, [shot]: "" })); setUploading({ shot, percent: 0 });
    try {
      const name = shotFileName(shot, nextTake(files, shot), extension);
      const file = new File([blob], name, { type: blob.type });
      await uploadRecordFile(file, { recordId, headers, onProgress: percent => setUploading({ shot, percent }) });
      router.refresh();
    } catch (error) { setErrors(e => ({ ...e, [shot]: error instanceof Error ? error.message : "Upload failed. Try again." })); }
    finally { inFlight.current = false; setUploading(null); }
  };
  const chosen = (shot: number, file: File | undefined) => {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    const known = ["mp4", "mov", "m4v", "webm"];
    const ext = known.includes(extension) ? extension : file.type.includes("quicktime") ? "mov" : file.type.includes("webm") ? "webm" : "mp4";
    void send(shot, file, ext);
  };
  const blocked = archived ? "This piece is archived." : filmed === 0 ? "Film or upload at least one shot first." : null;
  const btn = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <AutoRefresh active={busy || Object.values(soundStates).some(s => s.checking)} />
      <header className="space-y-2">
        <nav className="text-xs"><Link href={`/studio/content/${recordId}`} className="text-muted-foreground hover:underline">← Back to {title}</Link></nav>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">Shoot</h1>
          <MakeVideoDialog locationId={locationId} recordId={recordId} {...makeProps} busy={busy} disabledReason={blocked} />
        </div>
        <div className="space-y-1" aria-live="polite">
          <p className="text-sm font-medium" data-testid="shoot-progress">{filmed} of {beats.length} shots filmed</p>
          <div role="progressbar" aria-label="Shots filmed" aria-valuemin={0} aria-valuemax={beats.length} aria-valuenow={filmed} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${beats.length ? (filmed / beats.length) * 100 : 0}%` }} /></div>
          {filmed < beats.length && filmed > 0 ? <p className="text-xs text-muted-foreground">Shots you have not filmed show a labelled placeholder in the video.</p> : null}
        </div>
        {statusLine ? <p role="status" className="text-sm text-muted-foreground">{statusLine} <Link className="text-primary underline" href={`/studio/content/${recordId}?mode=edit`}>{hasVideo ? "Open the video" : "See progress"}</Link></p> : null}
      </header>
      {beats.length === 0 ? <p className="rounded-xl border p-5 text-sm">This piece has no script yet. <Link className="text-primary underline" href={`/studio/content/${recordId}?mode=script`}>Write the script</Link>, then come back to film it.</p> : null}
      <ol className="space-y-3">
        {beats.map(beat => {
          const file = current.get(beat.index);
          const here = uploading?.shot === beat.index;
          return (
            <li key={beat.index} data-shot={beat.index} className="space-y-3 rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Shot {beat.index}</h2>
                <span className="flex items-center gap-1 text-xs" data-testid={`shot-status-${beat.index}`}>{here ? <><Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />Uploading {uploading!.percent}%</>
                  : file ? <><Check aria-hidden className="size-4 text-emerald-600" />Filmed · {formatBytes(file.byteSize)}</> : <><Circle aria-hidden className="size-4 text-muted-foreground" />Not filmed</>}</span>
              </div>
              {beat.direction ? <p className="text-sm"><span className="font-medium">Scene: </span><span className="text-muted-foreground">{beat.direction}</span></p> : <p className="text-xs text-muted-foreground">No scene note. Film it however suits the line.</p>}
              <p className="text-sm"><span className="font-medium">Say: </span>“{beat.narration}”</p>
              {file ? <video key={file.id} controls preload="metadata" playsInline src={`/studio/uploads/${file.id}?inline=1`} className="aspect-video w-full max-w-sm rounded-lg bg-black" aria-label={`Shot ${beat.index} preview`} /> : null}
              {file && !here ? (() => {
                const st = soundStates[file.id];
                return <div className="space-y-1 text-xs" data-testid={`shot-sound-${beat.index}`} aria-live="polite">
                  {st?.plan ? <p><span className="font-medium">Sound: </span>{SHOT_SOUND_LABEL[st.plan]}</p>
                    : st?.checking ? <p className="flex items-center gap-1"><Loader2 aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />Checking this clip's sound on your Mac…</p>
                    : <p><span className="font-medium">Sound: </span>not checked yet. If this clip has no speech matching the line, the voiceover plays over it.{st?.failed ? " The last check failed." : ""}{!archived ? <> <button type="button" onClick={() => void checkSound(file.id)} className="min-h-11 text-primary underline focus-visible:outline focus-visible:outline-2">Check its sound on my Mac</button></> : null}</p>}
                  {checkNotice[file.id] ? <p className="text-muted-foreground">{checkNotice[file.id]}</p> : null}
                </div>;
              })() : null}
              {here ? <div role="progressbar" aria-label={`Uploading shot ${beat.index}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploading!.percent} className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${uploading!.percent}%` }} /></div> : null}
              {!archived ? <div className="flex flex-wrap gap-2">
                {canRecord ? <button type="button" disabled={Boolean(uploading)} onClick={() => setRecording(beat.index)} className={btn}><Video aria-hidden className="size-4" />{file ? "Record again" : "Record"}</button> : null}
                <label className={`${btn} cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 ${uploading ? "pointer-events-none opacity-60" : ""}`}>{file ? "Replace with a video" : "Upload a video"}
                  <input type="file" accept="video/*" className="sr-only" disabled={Boolean(uploading)} aria-label={`${file ? "Replace" : "Upload"} video for shot ${beat.index}`} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; chosen(beat.index, f); }} /></label>
              </div> : null}
              {errors[beat.index] ? <p role="alert" className="text-sm text-destructive">{errors[beat.index]}</p> : null}
            </li>
          );
        })}
      </ol>
      {recording ? <ShotRecorder open onOpenChange={o => { if (!o) setRecording(null); }} shot={recording} line={beats.find(b => b.index === recording)?.narration ?? ""} note={beats.find(b => b.index === recording)?.direction}
        onTake={(blob, extension) => void send(recording, blob, extension)} /> : null}
    </div>
  );
}
