"use client";
import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { withoutPlan } from "@/lib/build/playbook";
import { jobsOfTalk, talkWords } from "@/lib/build/conversations";
import { workStatus } from "@/lib/build/features";
import type { TalkMessage, TalkPlan } from "@/lib/build/talk";
import { cp, Dot, stateWord, WorkflowControls, type Job } from "./progress";

export type Talk = { id: string; title: string; state: string; threadId: string | null; profile: { id?: string; model?: string } | null; messages: TalkMessage[]; plan: TalkPlan | null; error: string | null; updatedAt: string };
export type PastTalk = Pick<Talk, "id" | "title" | "state" | "threadId" | "plan" | "updatedAt">;
/** What the conversation sheet shows: one conversation, a new one (optionally seeded), or the archived list. */
export type TalkView = { mode: "talk"; id: string } | { mode: "new"; seed?: string; n: number } | { mode: "past" } | null;

const btn = "rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";
const solid = "rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-40";
const day = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
const live = (t: Pick<Talk, "state">) => ["queued", "thinking"].includes(t.state);
const needsYou = (t: Talk) => t.state === "waiting" || t.state === "error" || (!!t.plan?.items.length && t.plan.started.length < t.plan.items.length);

/**
 * Talk, out of the way: one line to start a conversation, the open ones as chips, and past conversations behind a link.
 * Conversations open in a side sheet so the Product list never moves.
 */
export function TalkEntry({ talks, past, open }: { talks: Talk[]; past: number; open: (view: TalkView) => void }) {
  return <section aria-label="Talk to Build" className="space-y-2">
    <div className="flex items-center gap-3">
      <button onClick={() => open({ mode: "new", n: Date.now() })} className="flex min-w-0 flex-1 items-center gap-3 rounded-full border bg-background px-4 py-2.5 text-left text-sm text-muted-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v5a2.5 2.5 0 0 1-2.5 2.5H9l-3.5 3v-3A2.5 2.5 0 0 1 4 10.5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        <span className="truncate">Talk to Build: what do you want to build or change?</span>
      </button>
      {past > 0 && <button onClick={() => open({ mode: "past" })} className="shrink-0 text-sm text-muted-foreground underline underline-offset-2">Past conversations · {past}</button>}
    </div>
    {talks.length > 0 && <div className="flex flex-wrap items-center gap-1.5 px-1 text-sm"><span className="mr-1 text-xs text-muted-foreground">Open:</span>
      {talks.map(t => <button key={t.id} onClick={() => open({ mode: "talk", id: t.id })} title={talkWords(t)}
        className="inline-flex max-w-[22rem] items-center gap-1.5 rounded-full border px-3 py-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Dot status={live(t) || needsYou(t) ? "doing" : "idea"} /><span className="truncate">{t.title}</span>
        {(live(t) || needsYou(t)) && <span className="shrink-0 text-xs text-muted-foreground">{live(t) ? "replying" : "needs you"}</span>}</button>)}
    </div>}
  </section>;
}

type SheetProps = { view: TalkView; setView: (v: TalkView) => void; talks: Talk[]; past: PastTalk[]; jobs: Job[]; paused: boolean; blocker: string | null;
  reload: () => Promise<void>; models: { id: string; name: string }[]; reveal: (jobId: string) => void };
/** The conversation sheet: a conversation with its plan linked to Product, a new conversation, or past conversations. */
export function TalkSheet({ view, setView, talks, past, jobs, paused, blocker, reload, models, reveal }: SheetProps) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [loaded, setLoaded] = useState<Talk | null>(null);
  const id = view?.mode === "talk" ? view.id : null;
  const talk = id ? talks.find(t => t.id === id) ?? (loaded?.id === id ? loaded : null) : null;
  // A task opens a read-only mirror of its execution thread; archived talks load on demand.
  useEffect(() => {
    setError("");
    if (!id || talks.some(t => t.id === id)) return;
    let cancelled = false;
    const fetchTalk = async () => {
      try {
        const res = id.startsWith("job:")
          ? await fetch("/api/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "talk-job", id: id.slice(4) }) })
          : await fetch(`/api/build?talk=${encodeURIComponent(id)}`, { cache: "no-store" });
        const value = await res.json();
        if (!res.ok) throw new Error(value.error);
        if (!cancelled) { setLoaded(value); if (id.startsWith("job:")) setView({ mode: "talk", id: value.id }); }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't open it."); }
    };
    void fetchTalk();
    const timer = setInterval(() => void fetchTalk(), 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [id, talks, setView]);
  // Poll faster while a reply is on its way; the page's normal refresh is slower.
  const working = talks.some(live);
  useEffect(() => { if (!working) return; const timer = setInterval(() => void reload(), 3000); return () => clearInterval(timer); }, [working, reload]);
  async function post(command: object) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) });
      const value = await res.json(); if (!res.ok) throw new Error(value.error);
      if (value?.id === id && Array.isArray(value.messages)) setLoaded(value);
      await reload(); return value as { id?: string } & Partial<Talk>;
    } catch (e) { setError(e instanceof TypeError ? "Couldn't reach the server. Check your connection and try again." : e instanceof Error ? e.message : String(e)); return null; } finally { setBusy(false); }
  }
  const title = view?.mode === "past" ? "Past conversations" : view?.mode === "new" ? "New conversation" : talk?.title ?? "Conversation";
  return <Sheet open={!!view} onOpenChange={o => { if (!o) setView(null); }}>
    <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 focus:outline-none sm:max-w-xl"
      // Reading a conversation shouldn't raise the iPad keyboard or highlight a button; a new one focuses its box.
      onOpenAutoFocus={e => { if (view?.mode !== "new") { e.preventDefault(); (e.currentTarget as HTMLElement | null)?.focus(); } }}>
      <div className="space-y-1 border-b px-5 pb-3 pr-12 pt-5">
        <SheetTitle className="text-base font-semibold leading-snug">{title}</SheetTitle>
        <SheetDescription className="text-xs">{view?.mode === "past" ? "Archived when their work was done, or when you closed them. Open one to read it or reopen it."
          : view?.mode === "new" ? "Build asks questions, checks the code, then proposes small tasks you start with one tap." : talk?.state === "execution" ? "Execution conversation · synced from T3 on the Mac." : talk ? talkWords(talk) : "Loading…"}</SheetDescription>
      </div>
      {view?.mode === "past" && <PastList past={past} open={id => setView({ mode: "talk", id })} />}
      {view?.mode === "new" && <Composer key={view.n} seed={view.seed} busy={busy} models={models} onSend={async (text, profileId) => { const r = await post({ action: "talk", text, ...(profileId ? { profileId } : {}) }); if (r?.id) setView({ mode: "talk", id: r.id }); return !!r; }} />}
      {view?.mode === "talk" && talk && <Conversation talk={talk} jobs={jobs} busy={busy} paused={paused} blocker={blocker} models={models} post={post} reveal={reveal} openTalk={id => setView({ mode: "talk", id })}
        archive={async () => { if (await post({ action: "talk-archive", id: talk.id })) setView(null); }}
        reopen={async () => { const r = await post({ action: "talk-reopen", id: talk.id }); if (r) setLoaded({ ...talk, ...r } as Talk); }} />}
      {error && <p role="alert" className="border-t px-5 py-2 text-sm text-red-600">{error}</p>}
    </SheetContent>
  </Sheet>;
}

function PastList({ past, open }: { past: PastTalk[]; open: (id: string) => void }) {
  if (!past.length) return <p className="p-5 text-sm text-muted-foreground">No past conversations.</p>;
  return <ul className="flex-1 divide-y overflow-y-auto">{past.map(t => <li key={t.id}><button onClick={() => open(t.id)} className="w-full px-5 py-3 text-left hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none">
    <span className="block text-sm font-medium">{t.title}</span>
    <span className="block text-xs text-muted-foreground">{t.plan?.archived ? `${day(t.plan.archived.at)} · ${t.plan.archived.by === "auto" ? t.plan.archived.reason : "Closed by you."}` : `Archived · ${day(t.updatedAt)}`}</span>
  </button></li>)}</ul>;
}

function Composer({ seed, busy, models, onSend, reply, maxLength = 8000, minLength = 1 }: { seed?: string; busy: boolean; models: { id: string; name: string }[]; onSend: (text: string, profileId?: string) => Promise<boolean>; reply?: boolean; maxLength?: number; minLength?: number }) {
  const [text, setText] = useState(seed ?? ""), [model, setModel] = useState("auto"), input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!reply) input.current?.focus(); }, [reply]);
  const send = async () => { const v = text.trim(); if (v.length >= minLength && await onSend(v, model === "auto" ? undefined : model)) setText(""); };
  return <div className={`space-y-2 px-5 py-4 ${reply ? "border-t" : ""}`}>
    <div className="flex items-end gap-2">
      <textarea ref={input} aria-label="Message" rows={reply ? 2 : 4} value={text} maxLength={maxLength} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
        placeholder={reply ? "Reply…" : "What do you want to build or change?"} className="min-h-[2.75rem] flex-1 resize-y rounded-lg border bg-background p-2.5 text-sm" />
      <button disabled={busy || text.trim().length < minLength} onClick={() => void send()} className="rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background disabled:opacity-40">Send</button>
    </div>
    {!reply && models.length > 1 && <select aria-label="Model for this conversation" className="rounded-full border bg-background px-2 py-1 text-xs" value={model} onChange={e => setModel(e.target.value)}><option value="auto">Model: Auto</option>{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
  </div>;
}

function Conversation({ talk, jobs, busy, paused, blocker, models, post, reveal, openTalk, archive, reopen }: { talk: Talk; jobs: Job[]; busy: boolean; paused: boolean; blocker: string | null; models: { id: string; name: string }[];
  post: (command: object) => Promise<unknown>; reveal: (jobId: string) => void; openTalk: (id: string) => void; archive: () => void; reopen: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!talk.plan?.historyMore) end.current?.scrollIntoView({ block: "nearest" }); }, [talk.id, talk.messages.length, talk.state, talk.plan?.historyMore]);
  const archived = talk.state === "archived", plan = talk.plan?.items.length ? talk.plan : null;
  const execution = talk.state === "execution", job = jobs.find(j => j.id === talk.plan?.executionJobId);
  const planningId = (job?.checkpoint as { talkId?: string } | null)?.talkId;
  const started = jobsOfTalk(talk, jobs), allStarted = !!plan && plan.started.length >= plan.items.length;
  return <>
    <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5 text-xs text-muted-foreground">
      {talk.profile && <span>Talking with {models.find(m => m.id === talk.profile!.id)?.name ?? talk.profile.model}</span>}
      {talk.threadId && <a className="underline" href={`t3-thread://v1/${talk.threadId}`}>Open in T3</a>}
      {execution && planningId && <button className="underline" onClick={() => openTalk(planningId)}>Planning conversation</button>}
      <span className="ml-auto" />
      {execution ? <span className="font-medium text-foreground">{job ? stateWord(job) : "Task conversation"}</span> : archived ? <button className={btn} disabled={busy} onClick={reopen}>Reopen</button>
        : <button className={btn} disabled={busy} onClick={archive} title="Archive: it moves to Past conversations; you can reopen it">Done with this conversation</button>}
    </div>
    <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
      {execution && job && <WorkflowControls job={job} busy={busy} send={async command => !!await post(command as object)} />}
      {execution && job && <button className="text-sm underline" onClick={() => reveal(job.id)}>Back to task</button>}
      {talk.plan?.historyMore && <div className="text-xs text-muted-foreground">
        {(talk.plan.historyLimit ?? 60) < 1000 && !archived ? <button disabled={busy} className={btn} onClick={() => void post({ action: "talk-history", id: talk.id })}>Load earlier messages</button> : <p>Earlier messages are available in T3.</p>}
      </div>}
      {talk.plan?.historyShortened && <p className="text-xs text-muted-foreground">Very long messages are shortened here. Open in T3 to read them in full.</p>}
      {talk.messages.map(m => { const shown = m.role === "agent" && !execution ? withoutPlan(m.text) : m.text; return shown && <div key={m.id} className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${m.role === "owner" ? "ml-auto bg-foreground text-background" : "border bg-background"}`}>{shown}</div>; })}
      {!talk.messages.length && <p className="text-sm text-muted-foreground">Waiting for the Mac to sync this conversation…</p>}
      {(plan || started.length > 0) && <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
        <p className="text-sm font-medium">{plan ? `Plan · ${plan.items.length} task${plan.items.length === 1 ? "" : "s"}` : "Work it started"}</p>
        {started.length > 0 || !plan ? <ul className="space-y-1">{started.map(j => <li key={j.id} className="flex items-start gap-2.5 text-sm">
          <Dot status={workStatus(j) ?? "idea"} className="mt-1.5" />
          <span className="min-w-0 flex-1"><span className="font-medium">{j.spec.title}</span><span className="block text-xs text-muted-foreground">{stateWord(j).replace(/^./, c => c.toUpperCase())}</span></span>
          <button className="shrink-0 text-sm underline underline-offset-2" onClick={() => reveal(j.id)}>Open in Product</button></li>)}
          {plan && started.length < plan.started.length && <li className="text-xs text-muted-foreground">Older tasks are no longer listed on the page.</li>}</ul>
          : <><ol className="space-y-1.5">{plan.items.map((item, i) => { const it = item as { title: string; outcome: string; scope: string[] }; return <li key={i} className="text-sm"><span className="font-medium">{i + 1}. {it.title}</span><span className="block text-xs text-muted-foreground">{it.outcome}</span></li>; })}</ol></>}
            {plan && !allStarted && !archived && <div className="flex flex-wrap items-center gap-2"><button disabled={busy || !!blocker} className={solid} onClick={() => void post({ action: "talk-start", id: talk.id, runId: plan.runId })}>Start {plan.items.length === 1 ? "it" : `all ${plan.items.length}`}</button>
              <span className="text-xs text-muted-foreground">{blocker ?? (paused ? "Starting also resumes the paused queue." : "Each task runs in its own T3 thread and branch. Nothing is merged or deployed.")}</span></div>}
        {allStarted && !archived && <p className="text-xs text-muted-foreground">This conversation archives itself when all its tasks are done.</p>}
      </div>}
      <div ref={end} />
    </div>
    {execution && (job && !cp(job).result?.needsAnswer && ["review", "failed"].includes(job.state) ? <div>
      <p className="border-t px-5 pt-3 text-xs text-muted-foreground">Reply to continue this task in the same scope. Sending queues another attempt{paused ? " while the queue is paused" : ""}.</p>
      <Composer key={job.id} minLength={3} maxLength={2000} reply busy={busy} models={models} onSend={async text => text.trim().length >= 3 && !!await post({ action: "redo", id: job.id, revision: job.revision, note: text })} />
    </div> : <p className="border-t px-5 py-3 text-xs text-muted-foreground">{job?.state === "working" ? "Work is running. Reply here when its result is ready, or open T3 to follow the live thread." : "Open in T3 to continue the conversation. Changes to a completed task need a new approved task."}</p>)}
    {!execution && !archived && <Composer reply busy={busy} models={models} onSend={async text => !!await post({ action: "talk", talkId: talk.id, text })} />}
  </>;
}
