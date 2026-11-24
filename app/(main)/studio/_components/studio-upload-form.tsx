"use client";
import { useStudioTenantHeaders } from "./studio-tenant-context";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { readStudioUploadRequest } from "@/lib/studio/upload-policy";
import type { UploadCommand, UploadRecoveryResult } from "@/lib/studio/upload-recovery";
import type { PendingStudioUpload } from "@/lib/studio/uploads";
import { discardUnfinishedUploadsAction } from "@/app/(main)/studio/(tenant)/content/actions";
import { discardConfirmText } from "@/lib/studio/upload-discard-policy";

type Pending = PendingStudioUpload & { start?: UploadCommand };
/** Metadata lives on the server; signed URLs and file bytes are never put in browser storage. */
export function StudioUploadForm({ locationId, recordId, pendingUploads = [], compact = false, attention = [] }: {
  locationId: string; recordId: string; pendingUploads?: PendingStudioUpload[];
  /** Workspace rail: a drop zone, and unfinished uploads folded into one "Needs attention" row instead of a long list. */
  compact?: boolean; attention?: { id: string; name: string; why: string }[];
}) {
  const tenantHeaders = useStudioTenantHeaders();
  const router = useRouter();
  const busy = useRef(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending[]>(pendingUploads);
  const [message, setMessage] = useState<{ error?: string; saved?: string }>({});
  /** Which discard is waiting for a confirm: one upload id, or "all". */
  const [confirming, setConfirming] = useState<string | "all" | null>(null);
  async function discard(target: string | "all") {
    if (busy.current) return;
    busy.current = true; setMessage({});
    try {
      const result = await discardUnfinishedUploadsAction(locationId, recordId, target === "all" ? null : target);
      if (!result.ok) { setMessage({ error: result.error }); return; }
      setPending(rows => target === "all" ? [] : rows.filter(row => row.id !== target));
      setConfirming(null);
      setMessage({ saved: result.discarded ? `Discarded ${result.discarded} unfinished upload${result.discarded === 1 ? "" : "s"}.` : "Nothing to discard: it had already finished or been removed." });
      router.refresh();
    } catch { setMessage({ error: "Could not discard. Try again." }); }
    finally { busy.current = false; }
  }
  const confirmBox = (target: string | "all", names: string[]) => confirming === target ? <div role="group" aria-label="Confirm discard" className="space-y-2 rounded border border-destructive/40 p-2">
    <p className="text-xs">{discardConfirmText(names)}</p>
    <div className="flex gap-3"><button type="button" className="min-h-11 text-destructive underline" onClick={() => void discard(target)}>Discard</button>
      <button type="button" className="min-h-11 underline" onClick={() => setConfirming(null)}>Keep</button></div></div> : null;

  async function command(value: UploadCommand): Promise<UploadRecoveryResult> {
    const response = await fetch(`/studio/uploads/api`, {
      method: "POST", headers: { ...tenantHeaders, "Content-Type": "application/json" }, body: JSON.stringify(value), cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Upload outcome could not be confirmed. Recover the same upload.");
    return result;
  }
  function put(file: File, target: Extract<UploadRecoveryResult, { status: "ready" }>) {
    return new Promise<void>(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", target.url); xhr.timeout = 30 * 60_000;
      for (const [name, value] of Object.entries(target.headers)) xhr.setRequestHeader(name, value);
      xhr.upload.onprogress = event => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };
      // A failed/lost PUT response may still have stored the file. HEAD decides, never the browser status alone.
      xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = () => resolve();
      xhr.send(file);
    });
  }
  async function run(existing?: Pending, file?: File) {
    if (busy.current) return;
    busy.current = true; setMessage({}); setProgress(0);
    try {
      let entry = existing;
      if (!entry) {
        if (!file) return;
        const input = readStudioUploadRequest({ recordId, filename: file.name, contentType: file.type, byteSize: file.size });
        entry = { id: crypto.randomUUID(), original_filename: input.filename, content_type: input.contentType,
          byte_size: input.byteSize, expires_at: new Date(Date.now() + 3600_000).toISOString() };
        entry.start = { action: "start", uploadId: entry.id, input };
        setPending(rows => [...rows, entry!]);
      }
      if (file) {
        const input = readStudioUploadRequest({ recordId, filename: file.name, contentType: file.type, byteSize: file.size });
        if (input.filename !== entry.original_filename || input.byteSize !== Number(entry.byte_size) || input.contentType !== entry.content_type) {
          throw new Error("Reselect the original file with the same name, size and type.");
        }
      }
      const recovery: UploadCommand = { action: "recover", uploadId: entry.id, recordId };
      let result = await command(entry.start ?? recovery);
      if (result.status === "ready" && file) {
        await put(file, result);
        result = await command(recovery);
      }
      if (result.status === "uploaded") {
        setPending(rows => rows.filter(row => row.id !== entry!.id));
        setMessage({ saved: "Upload registered. Its existing transcription job runs on the server." });
        router.refresh();
      } else {
        setMessage({ error: file ? "The file has not reached storage. Reselect the original file to retry this upload." : "No file found in storage. Reselect the original file below to restart the transfer." });
      }
    } catch (error) {
      setMessage({ error: error instanceof Error ? error.message : "Upload outcome could not be confirmed. Recover the same upload or reload this page." });
    } finally { busy.current = false; setProgress(null); }
  }

  const pendingList = pending.length ? <div className="space-y-3">
    <p className="text-xs text-muted-foreground">Check storage first. Recovery is available for seven hours after registration. Interrupted transfers restart from the beginning; select the original file.</p>
    {pending.map(entry => <div key={entry.id} className="space-y-2 rounded border p-3">
      <p className="break-words">{entry.original_filename} · {Number(entry.byte_size).toLocaleString()} bytes</p>
      <button type="button" className="min-h-11 text-primary underline" disabled={progress !== null} onClick={() => void run(entry)}>Check storage and finish</button>
      <label className="block">Retry with original file<input aria-label={`Retry ${entry.original_filename}`} type="file" disabled={progress !== null}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(entry, file); }} className="mt-1 block w-full" /></label>
      <button type="button" className="min-h-11 text-destructive underline" disabled={progress !== null} onClick={() => setConfirming(entry.id)}>Discard this upload</button>
      {confirmBox(entry.id, [entry.original_filename])}
    </div>)}
    {pending.length > 1 ? <div className="space-y-2">
      <button type="button" className="min-h-11 text-destructive underline" disabled={progress !== null} onClick={() => setConfirming("all")}>Discard all unfinished ({pending.length})</button>
      {confirmBox("all", pending.map(entry => entry.original_filename))}</div> : null}
  </div> : null;
  const extras = attention.filter(a => !pending.some(p => p.id === a.id));
  const messages = <>
    {progress !== null ? <p role="status">Uploading or checking storage… {progress}%</p> : null}
    {message.error ? <p role="alert" className="text-destructive">{message.error}</p> : message.saved ? <p role="status" className="text-muted-foreground">{message.saved}</p> : null}
  </>;
  if (compact) {
    const count = pending.length + extras.length;
    return <div className="space-y-2 text-sm">
      <label onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) void run(undefined, file); }}
        className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-3 text-center hover:bg-accent focus-within:outline focus-within:outline-2 focus-within:outline-offset-2">
        <span className="font-medium">Add footage</span><span className="text-xs text-muted-foreground">Drop a video or audio file, or choose one. Up to 5 GB, stored privately.</span>
        <input type="file" accept="video/mp4,video/quicktime,video/webm,audio/*" disabled={progress !== null} className="sr-only"
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(undefined, file); }} />
      </label>
      {messages}
      {count ? <details className="rounded-lg border p-2"><summary className="min-h-11 cursor-pointer leading-[2.75rem]">Needs attention ({count})</summary>
        <div className="space-y-3 pb-2">
          {extras.map(a => <p key={a.id} className="break-words text-muted-foreground">{a.name} · {a.why}</p>)}
          {pendingList}
        </div></details> : null}
    </div>;
  }
  return <div className="space-y-3 rounded-xl border bg-card p-4 text-sm">
    <label className="block font-medium">Upload your own video or audio
      <input type="file" accept="video/mp4,video/quicktime,video/webm,audio/*" disabled={progress !== null}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(undefined, file); }}
        className="mt-2 block w-full text-sm" /></label>
    <p className="text-xs text-muted-foreground">Up to 5 GB. Stored privately and transcribed automatically with this location&apos;s OpenAI key. If interrupted, recover the existing upload below before starting a new one.</p>
    {pending.length ? <div className="space-y-3"><h3 className="font-medium">Your unfinished uploads</h3>{pendingList}</div> : null}
    {messages}
  </div>;
}
