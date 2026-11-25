"use client";

import { useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { narrationBlocks, type ScriptBlock } from "@/lib/studio/script-blocks";
import { formatClock, scriptStats, withoutScriptCues } from "@/lib/studio/script-length";

export function ScriptReadingDialog({ blocks }: { blocks: readonly ScriptBlock[] }) {
  const reading = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("");
  const paragraphs = narrationBlocks(blocks)
    .map(block => ({ id: block.id, text: withoutScriptCues(block.text).split("\n").map(line => line.trim().replace(/[ \t]{2,}/g, " ")).join("\n").trim() }))
    .filter(block => block.text);
  if (!paragraphs.length) return null;

  const text = paragraphs.map(block => block.text).join("\n\n");
  const { seconds } = scriptStats(text);
  async function copyNarration() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Narration copied.");
    } catch {
      setStatus("Clipboard unavailable. Select and copy the narration below.");
    }
  }

  return <Dialog onOpenChange={() => setStatus("")}>
    <DialogTrigger asChild>
      <Button type="button" variant="outline" className="min-h-11 gap-2">
        <BookOpen aria-hidden="true" className="size-4" /> Read script
      </Button>
    </DialogTrigger>
    <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl grid-rows-[auto_auto_minmax(0,1fr)] rounded-lg p-4 sm:p-6"
      onOpenAutoFocus={event => { event.preventDefault(); reading.current?.focus(); }}>
      <div className="space-y-2 pr-8">
        <DialogTitle>Read script</DialogTitle>
        <DialogDescription>Spoken lines only · about {formatClock(Math.max(1, seconds))} at 150 words per minute</DialogDescription>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" className="min-h-11" onClick={() => void copyNarration()}>Copy narration</Button>
        <span role="status" className="text-sm text-muted-foreground">{status}</span>
      </div>
      <div ref={reading} role="region" aria-label="Narration" tabIndex={0}
        className="min-h-0 space-y-5 overflow-y-auto overscroll-contain rounded-md border p-3 text-lg leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:p-5 sm:text-xl">
        {paragraphs.map(block => <p key={block.id} className="whitespace-pre-wrap [overflow-wrap:anywhere]">{block.text}</p>)}
      </div>
    </DialogContent>
  </Dialog>;
}
