"use client";
import { useActionState, useState } from "react";
import { askVideoEditAction, openEditorAction } from "../(tenant)/content/actions";
import { openEditorLine, threadReplyLine, type VideoLoopState } from "@/lib/studio/video-assembly-policy";
import { AutoRefresh } from "./auto-refresh";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
type Form = { error?: string; notice?: string };

/** The made video on its piece: play it here, reopen the kept project in Substo Video on the Mac, or ask the agent for a change. Keyed by the latest version so a new export resets the player. */
export function VideoPanel({ locationId, recordId, state }: { locationId: string; recordId: string; state: VideoLoopState }) {
  const [versionId, setVersionId] = useState(state.versions[0]?.id ?? "");
  const [askState, ask, asking] = useActionState(askVideoEditAction.bind(null, locationId, recordId), {} as Form);
  const [openState, open, opening] = useActionState(openEditorAction.bind(null, locationId, recordId), {} as Form);
  const current = state.versions.find(v => v.id === versionId) ?? state.versions[0];
  const openLine = openEditorLine(state.openEditor);
  const editorPending = state.openEditor?.status === "queued" || state.openEditor?.status === "running";
  if (!current && !state.projectKept) return null;
  return (
    <section aria-label="Edited video" className="space-y-4 rounded-xl border p-4 text-sm">
      <AutoRefresh active={state.busy || editorPending} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Edited video</h2>
        {state.projectKept ? (
          <form action={open}><button type="submit" disabled={opening || editorPending} className="inline-flex min-h-11 items-center rounded-md border px-3 font-medium hover:bg-accent disabled:opacity-60">Open in editor</button></form>
        ) : null}
      </div>
      {openLine ? <p role="status" className="text-muted-foreground">{openLine}</p> : null}
      {openState.error ? <p role="alert" className="text-destructive">{openState.error}</p> : null}
      {current ? (
        <div className="space-y-2">
          <video key={current.id} controls preload="metadata" playsInline className="aspect-video w-full rounded-lg bg-black" src={`/studio/uploads/${current.id}?inline=1`} />
          <p className="text-xs text-muted-foreground">{current.name} · {(current.bytes / 1_000_000).toFixed(1)} MB</p>
        </div>
      ) : <p className="text-muted-foreground">The video is still being exported.</p>}
      {state.versions.length > 1 ? (
        <details>
          <summary className="min-h-11 cursor-pointer leading-[2.75rem] text-muted-foreground">Earlier versions ({state.versions.length - 1})</summary>
          <ul className="space-y-1">{state.versions.map((v, i) => (
            <li key={v.id}><button type="button" onClick={() => setVersionId(v.id)} aria-pressed={v.id === current?.id} className="min-h-11 w-full rounded-md px-2 text-left hover:bg-accent aria-pressed:font-medium">{i === 0 ? "Latest · " : ""}{when(v.createdAt)}</button></li>
          ))}</ul>
        </details>
      ) : null}
      {state.projectKept ? (
        <div className="space-y-3 border-t pt-3">
          <h3 className="font-medium">Ask the agent to change it</h3>
          {state.thread.length ? (
            <ol className="space-y-3" aria-label="Changes so far">{state.thread.map(m => (
              <li key={m.id} className="space-y-1">
                <p><span className="text-muted-foreground">You · {when(m.createdAt)}</span><br />{m.instruction}</p>
                <p className="rounded-md bg-muted/50 p-2"><span className="text-muted-foreground">Agent</span><br />{threadReplyLine(m)}</p>
              </li>
            ))}</ol>
          ) : <p className="text-muted-foreground">Try: “make the intro shorter”, “replace the second title with …”, “add a whoosh on each cut”, “fill the gap at 0:40 with a placeholder”.</p>}
          <form action={ask} className="space-y-2">
            <label className="block space-y-1"><span>What should change?</span>
              <textarea name="instruction" required maxLength={1000} rows={3} disabled={state.busy} className="block w-full rounded-md border bg-background p-3" placeholder="Describe the change in a sentence or two" /></label>
            <button type="submit" disabled={asking || state.busy} className="inline-flex min-h-11 items-center rounded-md border px-3 font-medium hover:bg-accent disabled:opacity-60">{asking ? "Sending…" : state.busy ? "Agent is working…" : "Send to the agent"}</button>
            {askState.error ? <p role="alert" className="text-destructive">{askState.error}</p> : null}
            {askState.notice ? <p role="status">{askState.notice}</p> : null}
          </form>
          <p className="text-xs text-muted-foreground">The agent edits the project on your Mac and saves a new version here. You can also open the project in the editor and change it by hand; ask the agent after you save.</p>
        </div>
      ) : null}
    </section>
  );
}
