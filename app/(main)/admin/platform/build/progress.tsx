"use client";
import { useEffect, useState } from "react";
import type { ThreadAction } from "@/lib/build/thread-action";
import type { z } from "zod";
import { difficulty, type jobSpec, type Profile } from "@/lib/build/contract";
import { richParts, type Story } from "@/lib/build/story";
import { workStatus, type Status } from "@/lib/build/features";
import { mergeWords, type Release } from "@/lib/build/release";

export type Merge = { state: "queued" | "merging" | "resolving" | "merged" | "failed"; at: string; sha?: string; reason?: string; local?: string; branch?: string };
export type External = { threadId: string; status: string; note: string; at: string; evidence: string[]; history?: { at: string; status: string; note: string }[] };
export type Checkpoint = { workflow?: ThreadAction; releaseCandidate?: string; story?: Story; external?: External; merge?: Merge; evidence?: { ok?: boolean; files?: string[]; errors?: string[] }; reason?: string; nextStep?: string; result?: { text?: string; needsAnswer?: boolean; decisions?: string | null }; review?: { path: string; change: "added" | "modified" | "deleted"; size: number; truncated?: boolean }[]; t3?: { threadId?: string; branch?: string }; feedback?: { at: string; decision: string; note: string; sentAt?: string }[]; auto?: { wouldApprove: boolean; reasons: string[] }; proposalsCreated?: number };
export type Job = { id: string; key: string; revision: number; state: string; spec: z.infer<typeof jobSpec>; checkpoint: unknown; attempt: unknown; approval: unknown; createdAt: string; updatedAt: string };
type Send = (command: unknown) => Promise<boolean>;

export const btn = "rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";
export const cp = (j: Job) => (j.checkpoint ?? {}) as Checkpoint;
export const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(); };
export const canMerge = (j: Job) => !["queued", "running"].includes(cp(j).workflow?.state ?? "") && !(cp(j).workflow?.state === "blocked" && cp(j).workflow?.stopped !== true) && j.spec.taskType === "implementation" && !!cp(j).t3?.branch && cp(j).evidence?.ok === true && !!cp(j).evidence?.files?.length && !["queued", "merging", "resolving", "merged"].includes(cp(j).merge?.state ?? "");
const externalWords: Record<string, string> = { working: "being worked on", blocked: "blocked", review: "finished, waiting for review", done: "finished", failed: "stopped with a problem" };
export function stateWord(j: Job) {
  const action = cp(j).workflow;
  if (action?.state === "queued" || action?.state === "running") return `${action.kind} ${action.state}`;
  if (action?.state === "blocked") return `${action.kind} needs attention`;
  if (action?.kind === "deploy" && action.state === "done") return "deployed";
  if (j.state.startsWith("external-")) return externalWords[j.state.slice(9)] ?? j.state.slice(9);
  return ({ proposed: "ready to start", approved: "queued", working: "running", stopping: "stopping", review: "ready for you", done: "done", failed: "failed", revoked: "dropped" } as Record<string, string>)[j.state] ?? "stuck";
}
/** One plain line saying where the work stands, for work without a story. */
function statusLine(j: Job, release: Release | null) {
  const c = cp(j);
  if (c.external) return `Worked on outside Build, in T3: ${externalWords[c.external.status] ?? c.external.status} (reported ${ago(c.external.at)}).`;
  if (c.merge?.state === "merged") return `Done. ${mergeWords(c.merge, release)}.`;
  return ({ proposed: "Ready to start; waiting for your approval.", approved: "Queued; it starts when the Mac picks it up.", working: "Running now in its own T3 thread.", stopping: "Stopping.", review: "Finished; waiting for you to review it.", done: "Done.", failed: "It didn't finish." } as Record<string, string>)[j.state] ?? "Stuck; see Needs you.";
}

/** Status colours: the only colours in the list. */
export const dot: Record<Status, string> = { idea: "bg-zinc-400 dark:bg-zinc-500", doing: "bg-amber-500", done: "bg-emerald-500" };
export function Dot({ status, className = "" }: { status: Status; className?: string }) {
  return <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dot[status]} ${className}`} />;
}

/** Text with links shown as short labels (never the raw URL). */
export function Rich({ text }: { text: string }) {
  return <>{richParts(text).map((p, i) => "href" in p ? <a key={i} href={p.href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{p.text}</a> : <span key={i}>{p.text}</span>)}</>;
}
function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <div><h4 className="text-xs font-semibold text-muted-foreground">{title}</h4>
    <ul className="mt-1 list-disc space-y-1 pl-4">{items.map((t, i) => <li key={i}><Rich text={t} /></li>)}</ul></div>;
}
/** The story: what it is, what was achieved, how it works, what's next. */
export function StoryView({ story }: { story: Story }) {
  return <div className="space-y-3 text-sm leading-relaxed">
    <p><Rich text={story.concept} /></p>
    <Bullets title="What was achieved" items={story.achieved} />
    <Bullets title="How it works" items={story.howItWorks} />
    <Bullets title="What's next" items={story.next} />
  </div>;
}
/** Branches, threads, reports and evidence: kept, but collapsed. */
function Technical({ job, model }: { job: Job; model?: string }) {
  const c = cp(job), level = job.spec.quality === difficulty.hard ? "Hard" : "Routine";
  const rows: string[] = [
    `${job.spec.routing ?? `Difficulty: ${job.spec.taskType === "implementation" ? level : "review"}`}${model ? ` · model ${model}` : ""}`,
    ...(c.t3?.branch ? [`Branch ${c.t3.branch}${job.state === "done" && c.merge?.state !== "merged" ? ", not merged" : ""} · T3 thread "Build: ${job.spec.title}"`] : []),
    ...(c.external ? [`External T3 thread ${c.external.threadId} · reported ${ago(c.external.at)}. Tracking only; merge and deploy need separate approval.`, c.external.note, ...c.external.evidence] : []),
    ...(c.merge?.sha ? [`Merged as ${c.merge.sha.slice(0, 7)}`] : []), ...(c.merge?.local ? [c.merge.local] : []),
    ...(c.nextStep && c.nextStep !== c.external?.note ? [c.nextStep] : []),
    `Scope: ${job.spec.scope.join(", ")}`, `Record ${job.id}`,
  ];
  return <details className="rounded-md border bg-background/60 p-2 text-xs">
    <summary className="cursor-pointer select-none font-medium text-muted-foreground">Technical details</summary>
    <ul className="mt-1.5 space-y-1 break-words text-muted-foreground">{rows.map((r, i) => <li key={i}><Rich text={r} /></li>)}</ul>
  </details>;
}

/** One piece of work inside a feature: a single line; opened, its own story or outcome, merge, feedback and details. */
export function WorkItem({ job, sameStory, profiles, release, busy, send, talk, openTalk, opened }: { job: Job; sameStory: boolean; profiles: Profile[]; release: Release | null; busy: boolean; send: Send;
  talk?: { id: string; title: string } | null; openTalk?: (id: string) => void; opened?: number }) {
  const [open, setOpen] = useState(!!opened);
  useEffect(() => { if (opened) setOpen(true); }, [opened]);
  const c = cp(job), status = workStatus(job) ?? "idea";
  const model = (job.attempt as { profile?: Profile } | null)?.profile?.model ?? profiles.find(p => p.id === job.spec.profileId)?.model;
  return <li id={job.id} className="scroll-mt-24">
    <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Dot status={status} className="mt-1.5" />
      <span className="min-w-0 flex-1 text-sm"><span className="font-medium">{job.spec.title}</span>
        <span className="block text-xs text-muted-foreground">{stateWord(job).replace(/^./, x => x.toUpperCase())}{c.merge ? ` · ${mergeWords(c.merge, release)}` : ""} · {ago(job.updatedAt)}</span></span>
      <Chevron open={open} />
    </button>
    {open && <div className="space-y-2 pb-3 pl-7 pr-2">
      {c.story && !sameStory ? <StoryView story={c.story} /> : <div className="space-y-1 text-sm"><p>{job.spec.outcome}</p><p className="text-xs text-muted-foreground">{statusLine(job, release)}</p></div>}
      {(c.t3?.threadId || c.external?.threadId) && openTalk && <button className={btn} onClick={() => openTalk(`job:${job.id}`)}>Open conversation</button>}
      {talk && openTalk && <p className="text-sm"><span className="text-muted-foreground">From conversation: </span><button className="underline underline-offset-2" onClick={() => openTalk(talk.id)}>{talk.title}</button></p>}
      {c.feedback?.map((f, i) => <p key={i} className="text-xs">{f.decision === "redo" ? "You asked" : "You noted"}: {f.note}</p>)}
      {job.state === "done" && canMerge(job) && <button className={btn} disabled={busy} onClick={() => void send({ action: "merge", id: job.id, revision: job.revision })}>Accept and merge</button>}
      {job.state === "proposed" && <button className={btn} disabled={busy} onClick={() => void send({ action: "approve", id: job.id, revision: job.revision })}>Start</button>}
      <WorkflowControls job={job} busy={busy} send={send} />
      <Technical job={job} model={model} />
    </div>}
  </li>;
}
/** Buttons send approvals into the conversation; status comes back after evidence checks. */
export function WorkflowControls({ job, busy, send }: { job: Job; busy: boolean; send: Send }) {
  const [note, setNote] = useState("");
  const c = cp(job), action = c.workflow, active = action && ["queued", "running"].includes(action.state);
  const deploy = c.merge?.state === "merged" && c.releaseCandidate && !(action?.kind === "deploy" && action.state === "done" && action.sha === c.releaseCandidate);
  return <div className="space-y-2 text-sm">
    {action && <p role="status">{action.kind === "merge" ? "Merge" : "Deploy"}: {({ queued: "queued for this conversation", running: "running in this conversation", done: "verified complete", blocked: "needs attention" })[action.state]}{action.reason ? ` · ${action.reason}` : ""}</p>}
    {action && ["running", "blocked"].includes(action.state) && <button className={btn} disabled={busy} onClick={() => void send({ action: "check-workflow", id: job.id, revision: job.revision })}>Check conversation status</button>}
    {action?.state === "blocked" && action.stopped === true && <div className="space-y-1"><textarea aria-label="Feedback for the blocked action" rows={2} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} placeholder="Explain what to resolve or ask the conversation to continue…" className="w-full rounded border bg-background p-2" /><button className={btn} disabled={busy || note.trim().length < 3} onClick={async () => { if (await send({ action: "continue-workflow", id: job.id, revision: job.revision, text: note.trim() })) setNote(""); }}>Send and retry {action.kind}</button><p className="text-xs text-muted-foreground">Authorizes another attempt of this same {action.kind} in the linked conversation.</p></div>}
    {!active && deploy && !(action?.state === "blocked" && action.stopped !== true) && <button className={btn} disabled={busy} onClick={() => { if (window.confirm(`Deploy the current release (${c.releaseCandidate!.slice(0, 8)}), including all work merged into it?`)) void send({ action: "deploy", id: job.id, revision: job.revision, sha: c.releaseCandidate }); }}>Deploy current release</button>}
    {c.merge?.state === "merged" && !active && action?.kind !== "deploy" && <p className="text-xs text-muted-foreground">Merged. Deployment needs your separate approval.</p>}
  </div>;
}
export function Chevron({ open }: { open: boolean }) {
  return <svg aria-hidden viewBox="0 0 20 20" className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}><path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
