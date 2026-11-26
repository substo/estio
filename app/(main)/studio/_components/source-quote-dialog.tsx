"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { sourceQuoteSeconds, validateSourceQuote, type SourceQuote } from "@/lib/studio/script-source-quotes";

const control = "mt-1 min-h-11 w-full rounded-md border bg-background px-2";

export function SourceQuoteDialog({ media, initial, onSave, onClose }: {
  media: readonly { id: string; name: string }[]; initial?: SourceQuote;
  onSave: (quote: SourceQuote) => void; onClose: () => void;
}) {
  const [asset, setAsset] = useState(initial?.asset ?? media[0]?.id ?? "");
  const [start, setStart] = useState(initial ? String(initial.start) : "");
  const [end, setEnd] = useState(initial ? String(initial.end) : "");
  const [credit, setCredit] = useState(initial?.credit ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [error, setError] = useState("");
  const selected = media.find(file => file.id === asset);

  function save() {
    const quote = validateSourceQuote({ asset, start: sourceQuoteSeconds(start), end: sourceQuoteSeconds(end), credit, url: url.trim() || undefined });
    if (!quote || !selected) {
      setError("Choose an uploaded video, enter a valid time range (0.25–120 seconds), and add a credit. Use an HTTPS link if you include one.");
      return;
    }
    onSave(quote);
  }

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[92dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-xl p-5">
      <DialogTitle>{initial ? "Edit source clip" : "Add source clip"}</DialogTitle>
      <DialogDescription>Use a short excerpt from a video file you have permission to include. The clip plays its original sound.</DialogDescription>
      {media.length ? <>
        <label className="text-sm">Uploaded video
          <select value={asset} onChange={event => setAsset(event.target.value)} className={control}>
            {!selected ? <option value={asset}>Choose an available upload</option> : null}
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
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <Button type="button" className="min-h-11" onClick={save}>{initial ? "Save source clip" : "Insert source clip"}</Button>
      </> : <p className="text-sm">Upload the source video under Assets in Edit mode, then return here to choose the excerpt.</p>}
    </DialogContent>
  </Dialog>;
}
