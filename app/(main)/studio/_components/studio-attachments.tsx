import { studioMediaKind } from "@/lib/studio/media-policy";

type AttachmentRow = { id: string; payload: Record<string, unknown>; media_object_id: string | null };

/** Media URLs go through the authorized route, which issues a short-lived private R2 link. */
export function StudioAttachments({ workspaceId, files }: { workspaceId: string; files: AttachmentRow[] }) {
  if (!files.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="font-medium">Attachments</h2>
      <ul className="space-y-4 text-sm">
        {files.map((file) => {
          const name = typeof file.payload.name === "string" ? file.payload.name : file.id;
          const href = `/studio/workspace/${workspaceId}/media/${file.id}`;
          const kind = file.media_object_id ? studioMediaKind(typeof file.payload.type === "string" ? file.payload.type : null) : null;
          return (
            <li key={file.id} className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <span>{name}</span>
                {file.media_object_id
                  ? <a className="text-primary hover:underline" href={href} download>Download</a>
                  : <span className="text-muted-foreground">Awaiting media upload and verification</span>}
              </div>
              {kind === "video" ? <video className="max-h-96 w-full rounded-lg border" controls preload="metadata" src={`${href}?inline=1`} /> : null}
              {kind === "audio" ? <audio className="w-full" controls preload="metadata" src={`${href}?inline=1`} /> : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {kind === "image" ? <img className="max-h-96 rounded-lg border" alt={name} loading="lazy" src={`${href}?inline=1`} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
