"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { readStudioUploadRequest } from "@/lib/studio/upload-policy";
import type { UploadCommand, UploadRecoveryResult } from "@/lib/studio/upload-recovery";
import type { PendingStudioUpload } from "@/lib/studio/uploads";

type Pending = PendingStudioUpload & { start?: UploadCommand };
/** Metadata lives on the server; signed URLs and file bytes are never put in browser storage. */
export function StudioUploadForm({ workspaceId, recordId, pendingUploads = [] }: {
  workspaceId: string; recordId: string; pendingUploads?: PendingStudioUpload[];
}) {
  const router = useRouter();
  const busy = useRef(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending[]>(pendingUploads);
  const [message, setMessage] = useState<{ error?: string; saved?: string }>({});

  async function command(value: UploadCommand): Promise<UploadRecoveryResult> {
    const response = await fetch(`/studio/workspace/${workspaceId}/uploads/api`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value), cache: "no-store",
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

  return <div className="space-y-3 rounded-xl border bg-card p-4 text-sm">
    <label className="block font-medium">Upload your own video or audio
      <input type="file" accept="video/mp4,video/quicktime,video/webm,audio/*" disabled={progress !== null}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(undefined, file); }}
        className="mt-2 block w-full text-sm" /></label>
    <p className="text-xs text-muted-foreground">Up to 5 GB. Stored privately and transcribed automatically with this workspace&apos;s OpenAI key. If interrupted, recover the existing upload below before starting a new one.</p>
    {pending.length ? <div className="space-y-3"><h3 className="font-medium">Your unfinished uploads</h3>
      <p className="text-xs text-muted-foreground">Check storage first. Recovery is available for seven hours after registration. Interrupted transfers restart from the beginning; select the original file. This list shows up to 100 uploads, oldest first.</p>
      {pending.map(entry => <div key={entry.id} className="space-y-2 rounded border p-3">
        <p>{entry.original_filename} · {Number(entry.byte_size).toLocaleString()} bytes</p>
        <button type="button" className="text-primary underline" disabled={progress !== null} onClick={() => void run(entry)}>Check storage and finish</button>
        <label className="block">Retry with original file<input aria-label={`Retry ${entry.original_filename}`} type="file" disabled={progress !== null}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(entry, file); }} className="mt-1 block w-full" /></label>
      </div>)}
    </div> : null}
    {progress !== null ? <p role="status">Uploading or checking storage… {progress}%</p> : null}
    {message.error ? <p role="alert" className="text-destructive">{message.error}</p> : message.saved ? <p role="status" className="text-muted-foreground">{message.saved}</p> : null}
  </div>;
}
