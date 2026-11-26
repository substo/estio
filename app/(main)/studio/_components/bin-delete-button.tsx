"use client";
import { useState, useTransition } from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { binItemAction } from "../bin-actions";

/** Delete = move to the Bin, with a confirm. Everything in the Bin can be restored for 30 days. */
export function BinDeleteButton({ locationId, kind, id, name, label = "Delete", className, afterDelete }: {
  locationId: string; kind: "content" | "upload"; id: string; name: string; label?: string; className?: string; afterDelete?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const what = kind === "content" ? "this piece and its footage, script and videos" : "this footage";
  const confirm = () => start(async () => {
    const result = await binItemAction(locationId, kind, id);
    if (!result.ok) { setError(result.error); return; }
    setOpen(false);
    if (afterDelete) window.location.assign(afterDelete); else window.location.reload();
  });
  return (
    <AlertDialog open={open} onOpenChange={next => { setOpen(next); if (!next) setError(null); }}>
      <AlertDialogTrigger asChild>
        <button type="button" aria-label={`${label} ${name}`} className={className ?? "inline-flex min-h-11 items-center rounded-md px-3 text-sm text-destructive hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"}>{label}</button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Move “{name}” to the Bin?</AlertDialogTitle>
          <AlertDialogDescription>It disappears from your lists and from Make video. You can restore {what} from the Bin for 30 days; after that it is deleted for good.</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={pending} onClick={confirm}>{pending ? "Moving…" : "Move to Bin"}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
