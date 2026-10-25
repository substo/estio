import { studioMediaKind } from "@/lib/studio/media-policy";
import type { StudioRecordUpload } from "@/lib/studio/uploads";

const jobText = (upload: StudioRecordUpload) => {
  const job = upload.job;
  if (upload.transcript) return null;
  if (!job) return "Transcription not queued.";
  if (job.status === "failed") return `Transcription failed: ${job.last_error_message ?? "unknown error"}. Retry it from Jobs.`;
  if (job.status === "running") return "Transcribing…";
  if (job.status === "cancelled") return "Transcription cancelled.";
  return job.attempts ? `Waiting to retry (attempt ${job.attempts} of ${job.max_attempts})${job.last_error_message ? `: ${job.last_error_message}` : ""}` : "Waiting for the worker…";
};

export function StudioUploads({ workspaceId, uploads }: { workspaceId: string; uploads: StudioRecordUpload[] }) {
  if (!uploads.length) return null;
  return <section className="space-y-3">
    <h2 className="font-medium">Uploads</h2>
    {uploads.map(upload => {
      const href = `/studio/uploads/${upload.id}`;
      const kind = studioMediaKind(upload.content_type);
      return <article key={upload.id} className="space-y-2 rounded-xl border bg-card p-4 text-sm">
        <div className="flex flex-wrap items-center gap-3"><span className="font-medium">{upload.original_filename}</span><a className="text-primary hover:underline" href={href} download>Download</a></div>
        {kind === "video" ? <video className="max-h-96 w-full rounded-lg border" controls preload="metadata" src={`${href}?inline=1`} /> : null}
        {kind === "audio" ? <audio className="w-full" controls preload="metadata" src={`${href}?inline=1`} /> : null}
        {jobText(upload) ? <p className="text-muted-foreground">{jobText(upload)}</p> : null}
        {upload.transcript ? <details open><summary className="cursor-pointer">Transcript · {Math.round(upload.transcript.duration_seconds / 60)} min · {upload.transcript.model}</summary>
          <p className="mt-2 whitespace-pre-wrap">{upload.transcript.text || "No speech detected."}</p></details> : null}
      </article>;
    })}
  </section>;
}
