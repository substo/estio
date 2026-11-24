"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { threadReplyLine, type VideoThreadMessage } from "@/lib/studio/video-assembly-policy";
import { clipLabel, suggestedPrompts, type SelectedClip } from "@/lib/studio/workspace/clip-actions";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The always-docked agent: a persisted thread, a context chip (whole video or the selected clip), and suggested prompts. */
export function AgentDock({ thread, projectKept, busy, selected, onClearSelection, onSend, pending, error, notice }: {
  thread: VideoThreadMessage[]; projectKept: boolean; busy: boolean; selected: SelectedClip | null; onClearSelection: () => void;
  onSend: (text: string) => void; pending: boolean; error?: string; notice?: string;
}) {
  const [text, setText] = useState("");
  const disabled = !projectKept || busy || pending;
  const send = (value: string) => { const t = value.trim(); if (!t) return; onSend(selected ? `On the ${selected.track} track, the clip "${selected.clip.l}": ${t}` : t); setText(""); };
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 text-sm">
      <div className="flex items-center justify-between gap-2"><h2 className="font-medium">Agent</h2>
        <span className="inline-flex max-w-[70%] items-center gap-1 rounded-full border px-2 py-1 text-xs" title="What the agent is looking at">
          <span className="truncate">{selected ? `Focus: ${clipLabel(selected)}` : "Focus: whole video"}</span>
          {selected ? <button type="button" aria-label="Clear focus" onClick={onClearSelection} className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-accent"><X aria-hidden className="h-3 w-3" /></button> : null}</span></div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {thread.length ? (
          <ol aria-label="Conversation" aria-live="polite" className="space-y-3">{thread.map(m => (
            <li key={m.id} className="space-y-1">
              <p className="rounded-md bg-muted/60 p-2"><span className="text-xs text-muted-foreground">You · {when(m.createdAt)}</span><br />{m.instruction}</p>
              <p className="rounded-md border p-2"><span className="text-xs text-muted-foreground">Agent</span><br />{threadReplyLine(m)}</p>
            </li>))}</ol>
        ) : <p className="text-muted-foreground">{projectKept ? "Ask for a change in plain words. The agent edits the project on your Mac and saves a new version." : "Make a video first. The agent works on the project your Mac keeps."}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{suggestedPrompts(Boolean(selected)).map(p => <button key={p} type="button" disabled={disabled} onClick={() => send(p)} className="min-h-11 rounded-full border px-3 text-xs hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60">{p}</button>)}</div>
      <form onSubmit={e => { e.preventDefault(); send(text); }} className="space-y-2">
        <label className="block"><span className="sr-only">Message to the agent</span>
          <textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(text); } }} maxLength={900} rows={3} disabled={disabled}
            placeholder={busy ? "The agent is working…" : selected ? "What should change about this clip?" : "What should change?"} className="block w-full rounded-md border bg-background p-3" /></label>
        <button type="submit" disabled={disabled || !text.trim()} className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-medium text-primary-foreground disabled:opacity-60">{pending ? "Sending…" : busy ? "Agent is working…" : "Send"}</button>
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        {notice ? <p role="status" className="text-muted-foreground">{notice}</p> : null}
      </form>
    </div>
  );
}
