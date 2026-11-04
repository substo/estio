"use client";
import { useState } from "react";
import { playbookDefaults, playbookNames, playbookText, type PlaybookEdits, type PlaybookName } from "@/lib/build/playbook";
import type { MemoryEntry } from "@/lib/build/memory";

const btn = "rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";
const solid = "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50";
const icons: Record<PlaybookName, string> = { talk: "💬", task: "🛠️", review: "🔍" };

/**
 * How the agents work: the instructions Build sends, editable here (next thread uses them), and the repository's own
 * guidance and skills, read-only. Changing a repository file is a task: ask for it in Talk.
 */
export function Playbook({ memory, edits, docs, busy, send, ask }: { memory: MemoryEntry[]; edits: PlaybookEdits | undefined; docs: { path: string; size: number }[]; busy: boolean;
  send: (command: unknown) => Promise<boolean>; ask: (text: string) => void }) {
  const [editing, setEditing] = useState<PlaybookName | null>(null), [text, setText] = useState("");
  const [doc, setDoc] = useState<{ path: string; text: string } | null>(null), [error, setError] = useState("");
  async function open(path: string) {
    if (doc?.path === path) { setDoc(null); return; }
    setError("");
    try { const res = await fetch(`/api/build?doc=${encodeURIComponent(path)}`, { cache: "no-store" }); const value = await res.json(); if (!res.ok) throw new Error(value.error); setDoc(value); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  return <section className="space-y-2">
    <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Playbook: how the agents work</h2>
    <div className="grid gap-2 md:grid-cols-3">{playbookNames.map(name => { const d = playbookDefaults[name], edit = edits?.[name];
      return <div key={name} className={`space-y-2 rounded-lg border p-3 ${editing === name ? "md:col-span-3" : ""}`}>
        <div className="flex items-start gap-2"><span aria-hidden className="text-lg">{icons[name]}</span><div className="min-w-0 flex-1"><p className="text-sm font-medium">{d.title}</p>
          <p className="text-xs text-muted-foreground">{d.about} · {edit ? `edited ${new Date(edit.at).toLocaleDateString()}` : "default"}</p></div>
          {editing !== name && <button className={btn} onClick={() => { setEditing(name); setText(playbookText(edits, name)); }}>Edit</button>}</div>
        {editing === name && <>
          <textarea aria-label={d.title} className="min-h-48 w-full rounded-md border bg-background p-2 font-mono text-xs" value={text} maxLength={8000} onChange={e => setText(e.target.value)} />
          <p className="text-xs text-muted-foreground">New threads use this. Build adds the formats it reads (plans, suggestions) itself, so you can&apos;t break those here.</p>
          <div className="flex flex-wrap gap-2">
            <button className={solid} disabled={busy || text.trim().length < 20} onClick={async () => { if (await send({ action: "playbook", name, text })) setEditing(null); }}>Save</button>
            <button className={btn} onClick={() => setEditing(null)}>Cancel</button>
            {edit?.previous && <button className={btn} onClick={() => setText(edit.previous!)}>Load previous version</button>}
            {edit && <button className={btn} disabled={busy} onClick={async () => { if (await send({ action: "playbook", name, reset: true })) setEditing(null); }}>Back to default</button>}
          </div>
        </>}
      </div>; })}</div>
    <Memory memory={memory} busy={busy} send={send} />
    <div className="rounded-lg border p-3">
      <p className="text-sm font-medium">📚 Repository guidance and skills <span className="text-xs font-normal text-muted-foreground">· read-only, as on the Mac</span></p>
      {!docs.length && <p className="text-xs text-muted-foreground">Not reported yet. The Mac sends them on its next check.</p>}
      <div className="mt-2 flex flex-wrap gap-2">{docs.map(d => <button key={d.path} className={`${btn} text-xs ${doc?.path === d.path ? "bg-muted" : ""}`} onClick={() => void open(d.path)}>{d.path.replace(/^\.agents\/skills\/(.*)\/SKILL\.md$/, "Skill: $1")}</button>)}</div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {doc && <div className="mt-2 space-y-2"><pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">{doc.text}</pre>
        <button className={btn} onClick={() => ask(`Change ${doc.path}: `)}>Ask for a change to this file</button></div>}
    </div>
  </section>;
}

const kindWord: Record<MemoryEntry["kind"], string> = { note: "Note", decision: "Decided", feedback: "Feedback", done: "Done", merged: "Merged" };
/** Product memory: kept up to date by Build and conversations; pinned notes always go to agents, then the latest events. */
function Memory({ memory, busy, send }: { memory: MemoryEntry[]; busy: boolean; send: (command: unknown) => Promise<boolean> }) {
  const [text, setText] = useState(""), [all, setAll] = useState(false);
  const ordered = [...memory.filter(m => m.pinned), ...memory.filter(m => !m.pinned).reverse()], shown = all ? ordered : ordered.slice(0, 8);
  return <details className="rounded-lg border p-3">
    <summary className="cursor-pointer text-sm font-medium">🧠 Product memory · {memory.length}</summary>
    <p className="mt-2 text-xs text-muted-foreground">Build adds what you accept, merge and ask to redo, and what you decide in conversations. Every new conversation and task gets it as background, so agents don&apos;t start from zero. Pinned notes are always included; otherwise the most recent come first.</p>
    <div className="mt-2 space-y-1">{shown.map(m => <div key={m.id} className="flex items-start gap-2 rounded-md border px-2 py-1.5 text-sm">
      <span className="min-w-0 flex-1"><span className="text-xs text-muted-foreground">{m.pinned ? "📌 Always" : `${kindWord[m.kind]} · ${new Date(m.at).toLocaleDateString()}`}</span><span className="block">{m.text}</span></span>
      <button className="text-xs underline" disabled={busy} onClick={() => send({ action: "memory-update", memoryId: m.id, pinned: !m.pinned })}>{m.pinned ? "Unpin" : "Pin"}</button>
      <button className="text-xs underline" disabled={busy} onClick={() => send({ action: "memory-update", memoryId: m.id, remove: true })} aria-label="Remove">Remove</button></div>)}</div>
    {ordered.length > 8 && <button className="mt-1 text-xs underline" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${ordered.length}`}</button>}
    <form className="mt-2 flex gap-2" onSubmit={async e => { e.preventDefault(); if (await send({ action: "memory-add", text })) setText(""); }}>
      <input value={text} onChange={e => setText(e.target.value)} minLength={5} maxLength={400} placeholder="Something agents should always know" className="min-w-0 flex-1 rounded-md border bg-background p-2 text-sm" />
      <button className={btn} disabled={busy || text.trim().length < 5}>Add</button></form>
  </details>;
}
