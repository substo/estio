"use client";

import { useRef } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { LibraryImportForm } from "./library-import-form";

export function LibraryAddDialog({ locationId, empty = false }: { locationId: string; empty?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return <Dialog>
    <DialogTrigger asChild><Button size="sm" className="shrink-0"><Plus className="mr-2 h-4 w-4" />{empty ? "Add your first source" : "Add source"}</Button></DialogTrigger>
    <DialogContent className="w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg p-5" onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); }}>
      <DialogHeader className="pr-6 text-left"><DialogTitle>Add a source</DialogTitle><DialogDescription>Paste a video, post or channel URL, or choose a platform for an @handle.</DialogDescription></DialogHeader>
      <LibraryImportForm locationId={locationId} inputRef={input} />
    </DialogContent>
  </Dialog>;
}
