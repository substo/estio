"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { sourceClipPlayback, sourceQuoteSeconds, validateSourceQuote, type SourceQuote, type SourceClipReference } from "@/lib/studio/script-source-quotes";

const control = "mt-1 min-h-11 w-full rounded-md border bg-background px-2";

export function SourceQuoteDialog({ media, initial, reference, positions = [], atCapacity = false, onSave, onClose }: {
  media: readonly { id: string; name: string }[]; initial?: SourceQuote;
  reference?: SourceClipReference; positions?: readonly { id: string; label: string }[]; atCapacity?: boolean;
  onSave: (quote: SourceQuote, after?: string) => void; onClose: () => void;
}) {
  const [asset, setAsset] = useState(initial?.asset ?? (reference ? "" : media[0]?.id ?? ""));
  const [start, setStart] = useState(String(initial?.start ?? reference?.start ?? ""));
  const [end, setEnd] = useState(String(initial?.end ?? reference?.end ?? ""));
  const [credit, setCredit] = useState(initial?.credit ?? reference?.title.replace(/[\[\]\u0000-\u001f\u007f]/g, " ").slice(0, 120) ?? "");
  const [url, setUrl] = useState(initial?.url ?? reference?.url ?? "");
  const [after, setAfter] = useState("");
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const playback = reference ? sourceClipPlayback(reference.url, reference.start, reference.end) : null;
  const selected = media.find(file => file.id === asset);

  function save() {
    const quote = validateSourceQuote({ asset, start: sourceQuoteSeconds(start), end: sourceQuoteSeconds(end), credit, url: url.trim() || undefined });
    if (!quote || !selected) {
      setError("Choose an uploaded video, enter a valid time range (0.25–120 seconds), and add a credit. Use an HTTPS link if you include one.");
      return;
    }
    if (!atCapacity) onSave(quote, after || undefined);
  }

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[92dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-xl p-5">
      <DialogTitle>{initial ? "Edit source clip" : reference ? "Plan supporting clip" : "Add source clip"}</DialogTitle>
      <DialogDescription>{reference ? "Review the moment in the original video. You can attach a matching video file to use the excerpt in your edit." : "Use a short excerpt from a video file you have permission to include. The clip plays its original sound."}</DialogDescription>
      {reference ? <section aria-label="Evidence used by the script" className="space-y-2 rounded-lg border p-3 text-sm">
        <p className="font-medium">{reference.title}</p>
        <blockquote className="max-h-36 overflow-y-auto whitespace-pre-wrap border-l-2 pl-3">{reference.quote}</blockquote>
        <p className="text-muted-foreground">{reference.start === null ? "This finding has no verified time range. You can open the original video to locate the moment." :
          reference.onScreen ? `On-screen evidence at ${reference.start}s. Choose the end after viewing the video.` :
          reference.end === null ? `Saved start at ${reference.start}s. Choose the end after viewing the video.` :
          `Saved transcript range: ${reference.start}s–${reference.end}s. Review the excerpt and trim it if needed.`}</p>
        {playback && showPreview ? <div className="aspect-video min-h-[200px] overflow-hidden rounded-md bg-black">
          <iframe title={`Preview: ${reference.title}`} className="h-full min-h-[200px] w-full"
            src={playback.embed} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
        </div> : null}
        {playback && !showPreview ? <Button type="button" variant="outline" onClick={() => setShowPreview(true)}>
          {reference.start === null ? "Preview original video" : "Play cited moment"}
        </Button> : null}
        <div className="flex flex-wrap gap-3">
          {playback || reference.url ? <a href={playback?.watch ?? reference.url ?? undefined} target="_blank" rel="noreferrer" className="text-primary underline">
            {playback && reference.start !== null ? "Open at timestamp on YouTube" : "Open original video"}
          </a> : null}
          <a href={reference.passageHref} target="_blank" rel="noreferrer" className="text-primary underline">Open cited passage</a>
          {reference.frameHref ? <a href={reference.frameHref} target="_blank" rel="noreferrer" className="text-primary underline">View saved frame</a> : null}
        </div>
      </section> : null}
      {atCapacity ? <p role="alert" className="text-sm">Remove a block or source clip before inserting another.</p> : null}
      {media.length ? <>
        <label className="text-sm">{reference ? "Matching uploaded video" : "Uploaded video"}
          <select value={asset} onChange={event => setAsset(event.target.value)} className={control}>
            {!selected ? <option value={asset}>Choose the matching upload</option> : null}
            {media.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}
          </select>
        </label>
        {selected ? <a className="text-sm text-primary underline" href={`/studio/uploads/${selected.id}`} target="_blank" rel="noreferrer">Open uploaded video (new tab)</a> : null}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">Start time<input value={start} onChange={event => setStart(event.target.value)} placeholder="0:12" className={control} /></label>
          <label className="text-sm">End time<input value={end} onChange={event => setEnd(event.target.value)} placeholder="0:18" className={control} /></label>
        </div>
        <label className="text-sm">On-screen credit<input value={credit} maxLength={120} onChange={event => setCredit(event.target.value)} placeholder="Speaker or source name" className={control} /></label>
        <label className="text-sm">Original source link (optional)<input type="url" value={url} maxLength={500} onChange={event => setUrl(event.target.value)} className={control} /></label>
        {reference && positions.length ? <label className="text-sm">Place after
          <select value={after} onChange={event => setAfter(event.target.value)} className={control}>
            <option value="">End of script</option>
            {positions.map(position => <option key={position.id} value={position.id}>{position.label}</option>)}
          </select>
        </label> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <Button type="button" className="min-h-11" disabled={atCapacity} onClick={save}>{initial ? "Save source clip" : "Insert source clip"}</Button>
      </> : <p className="text-sm">Upload the source video under Assets in Edit mode, then return here to choose the excerpt.</p>}
    </DialogContent>
  </Dialog>;
}
