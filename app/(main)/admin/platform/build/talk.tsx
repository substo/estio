"use client";
import { useEffect, useRef, useState } from "react";
import { withoutPlan } from "@/lib/build/playbook";
import type { TalkMessage, TalkPlan } from "@/lib/build/talk";

export type Talk = { id: string; title: string; state: string; threadId: string | null; profile: { id?: string; model?: string } | null; messages: TalkMessage[]; plan: TalkPlan | null; error: string | null; updatedAt: string };
type Props = { talks: Talk[]; paused: boolean; blocker: string | null; reload: () => Promise<void>; seed?: { text: string; n: number } | null; models: { id: string; name: string }[] };

/** Talk to Build: the agent asks questions and proposes a plan; Start turns the plan into running tasks. */
export function TalkPanel({ talks, paused, blocker, reload, seed, models }: Props) {
  const [activeId, setActiveId] = useState<string | null>(talks[0]?.id ?? null), [text, setText] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [model, setModel] = useState("auto");
  const active = activeId === "new" ? null : talks.find(t => t.id === activeId) ?? (activeId ? null : talks[0] ?? null);
  const working = talks.some(t => ["queued", "thinking"].includes(t.state));
  const end = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  // "Ask about this screen" starts a new conversation with the screen named.
  useEffect(() => { if (!seed) return; setActiveId("new"); setText(seed.text); input.current?.focus(); }, [seed]);
  // Poll faster while a reply is on its way; the page's normal refresh is slower.
  useEffect(() => { if (!working) return; const timer = setInterval(() => void reload(), 3000); return () => clearInterval(timer); }, [working, reload]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [active?.messages.length, active?.state]);
  async function post(command: object) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) });
      const value = await res.json(); if (!res.ok) throw new Error(value.error);
      await reload(); return value as { id?: string };
    } catch (e) { setError(e instanceof TypeError ? "Couldn't reach the server. Check your connection and try again." : e instanceof Error ? e.message : String(e)); return null; } finally { setBusy(false); }
  }
  async function say() {
    const value = text.trim(); if (!value) return;
    const result = await post({ action: "talk", talkId: active?.id, text: value, ...(!active && model !== "auto" ? { profileId: model } : {}) });
    if (result) { setText(""); if (!active && result.id) setActiveId(result.id); }
  }
  const status = active && ({ queued: "Sending to the Mac…", thinking: "Thinking…", waiting: "It's asking you something in T3. Open the thread there to answer.", error: active.error ?? "Something went wrong" } as Record<string, string>)[active.state];
  const plan = active?.plan, allStarted = !!plan && plan.started.length >= plan.items.length;
  return <section className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Talk</h2>
      <button className={chip(!active)} onClick={() => setActiveId("new")}>+ New</button>
      {talks.slice(0, 6).map(t => <button key={t.id} className={chip(active?.id === t.id)} onClick={() => setActiveId(t.id)} title={t.title}>{t.title.length > 28 ? `${t.title.slice(0, 28)}…` : t.title}</button>)}
    </div>
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3 sm:p-4">
      {!active && <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground">Say what you want to build or change. Build asks questions, checks the code, then proposes small tasks you start with one tap.</p>
        {models.length > 1 && <select aria-label="Model for this conversation" className="rounded-full border bg-background px-2 py-1 text-xs" value={model} onChange={e => setModel(e.target.value)}><option value="auto">Model: Auto</option>{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}</div>}
      {active && <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
        {active.messages.map(m => { const shown = m.role === "agent" ? withoutPlan(m.text) : m.text; return shown && <div key={m.id} className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${m.role === "owner" ? "ml-auto bg-primary text-primary-foreground" : "bg-background border"}`}>{shown}</div>; })}
        {plan && <div className="space-y-2 rounded-lg border bg-background p-3">
          <p className="text-sm font-medium">Plan · {plan.items.length} task{plan.items.length === 1 ? "" : "s"}</p>
          <ol className="space-y-1.5">{plan.items.map((item, i) => <li key={i} className="text-sm"><span className="font-medium">{i + 1}. {item.title}</span><span className="block text-xs text-muted-foreground">{item.outcome} · {item.scope.length} file{item.scope.length === 1 ? "" : "s"}</span></li>)}</ol>
          {allStarted ? <p className="text-sm text-emerald-700 dark:text-emerald-400">Started. Follow it under Product.</p>
            : <div className="flex flex-wrap items-center gap-2"><button disabled={busy || !!blocker} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" onClick={() => void post({ action: "talk-start", id: active.id, runId: plan.runId })}>Start {plan.items.length === 1 ? "it" : `all ${plan.items.length}`}</button>
              <span className="text-xs text-muted-foreground">{blocker ?? (paused ? "Starting also resumes the paused queue." : "Each task runs in its own T3 thread and branch. Nothing is merged or deployed.")}</span></div>}
        </div>}
        {status && <p className={`text-sm ${active.state === "error" ? "text-red-600" : "text-muted-foreground"}`}>{status}</p>}
        <div ref={end} />
      </div>}
      <div className="flex items-end gap-2">
        <textarea ref={input} aria-label="Message" rows={2} value={text} maxLength={8000} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void say(); } }}
          placeholder={active ? "Reply…" : "What do you want to build or change?"} className="min-h-[2.75rem] flex-1 resize-y rounded-lg border bg-background p-2.5 text-sm" />
        <button disabled={busy || !text.trim()} onClick={() => void say()} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50">Send</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {active && <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">{active.profile && <span>Talking with {models.find(m => m.id === active.profile!.id)?.name ?? active.profile.model}</span>}<span>Also in T3 as &quot;Talk: {active.title.slice(0, 60)}&quot;</span><button className="underline" disabled={busy} onClick={async () => { if (await post({ action: "talk-archive", id: active.id })) setActiveId(null); }}>Archive</button></div>}
    </div>
  </section>;
}
const chip = (on: boolean) => `rounded-full border px-3 py-1 text-xs ${on ? "bg-foreground text-background" : "hover:bg-muted"}`;
