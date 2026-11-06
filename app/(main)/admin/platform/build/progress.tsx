"use client";
import { useState } from "react";
import type { z } from "zod";
import { difficulty, type jobSpec, type Profile } from "@/lib/build/contract";
import { richParts, type Story } from "@/lib/build/story";

export type Merge = { state: "queued" | "merging" | "resolving" | "merged" | "failed"; at: string; sha?: string; reason?: string; local?: string; branch?: string };
export type External = { threadId: string; status: string; note: string; at: string; evidence: string[]; history?: { at: string; status: string; note: string }[] };
export type Checkpoint = { story?: Story; external?: External; merge?: Merge; evidence?: { ok?: boolean; files?: string[] }; reason?: string; nextStep?: string; result?: { text?: string; needsAnswer?: boolean; decisions?: string | null }; review?: { path: string; change: "added" | "modified" | "deleted"; size: number; truncated?: boolean }[]; t3?: { threadId?: string; branch?: string }; feedback?: { at: string; decision: string; note: string; sentAt?: string }[]; auto?: { wouldApprove: boolean; reasons: string[] }; proposalsCreated?: number };
export type Job = { id: string; key: string; revision: number; state: string; spec: z.infer<typeof jobSpec>; checkpoint: unknown; attempt: unknown; approval: unknown; createdAt: string; updatedAt: string };
type MapNode = { id: string; spec: { kind: string; section?: string; name: string } };
type Send = (command: unknown) => Promise<boolean>;

const btn = "rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";
const label = "text-xs font-medium uppercase tracking-wide text-muted-foreground";
export const cp = (j: Job) => (j.checkpoint ?? {}) as Checkpoint;
export const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(); };
export const canMerge = (j: Job) => j.spec.taskType === "implementation" && !!cp(j).t3?.branch && cp(j).evidence?.ok === true && !!cp(j).evidence?.files?.length && !["queued", "merging", "resolving", "merged"].includes(cp(j).merge?.state ?? "");
export function mergeWords(m: Merge) {
  return m.state === "merged" ? "Merged, not deployed yet" : m.state === "resolving" ? "Merging: an agent is resolving conflicts" : m.state === "failed" ? `Merge failed: ${m.reason ?? "unknown"}` : "Merging…";
}
const externalWords: Record<string, string> = { working: "being worked on", blocked: "blocked", review: "finished, waiting for review", done: "finished", failed: "stopped with a problem" };
export function stateWord(j: Job) {
  if (j.state.startsWith("external-")) return externalWords[j.state.slice(9)] ?? j.state.slice(9);
  return ({ proposed: "suggested", approved: "queued", working: "running", stopping: "stopping", review: "ready for you", done: "done", failed: "failed", revoked: "dropped" } as Record<string, string>)[j.state] ?? "stuck";
}
/** One plain line saying where the work stands, for cards without a story. */
function statusLine(j: Job) {
  const c = cp(j);
  if (c.external) return `Worked on outside Build, in T3: ${externalWords[c.external.status] ?? c.external.status} (reported ${ago(c.external.at)}).`;
  if (c.merge?.state === "merged") return "Done and merged into the release branch; not deployed yet.";
  return ({ proposed: "Suggested; not started yet.", approved: "Queued; it starts when the Mac picks it up.", working: "Running now in its own T3 thread.", stopping: "Stopping.", review: "Finished; waiting for you to review it.", done: "Done.", failed: "It didn't finish." } as Record<string, string>)[j.state] ?? "Stuck; see Needs you.";
}

/** Text with links shown as short labels (never the raw URL). */
function Rich({ text }: { text: string }) {
  return <>{richParts(text).map((p, i) => "href" in p ? <a key={i} href={p.href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{p.text}</a> : <span key={i}>{p.text}</span>)}</>;
}
function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <div><h4 className="text-xs font-semibold text-muted-foreground">{title}</h4>
    <ul className="mt-0.5 list-disc space-y-0.5 pl-4">{items.map((t, i) => <li key={i}><Rich text={t} /></li>)}</ul></div>;
}
/** The story first: what it is, what was achieved, how it works, what's next. */
export function StoryView({ story }: { story: Story }) {
  return <div className="space-y-2 text-sm leading-snug">
    <p><Rich text={story.concept} /></p>
    <Bullets title="What was achieved" items={story.achieved} />
    <Bullets title="How it works" items={story.howItWorks} />
    <Bullets title="What's next" items={story.next} />
    <p className="text-xs text-muted-foreground">Story updated {ago(story.updatedAt)}</p>
  </div>;
}
/** Branches, threads, reports and evidence: kept, but collapsed under the story. */
function Technical({ job, model }: { job: Job; model?: string }) {
  const c = cp(job), level = job.spec.quality === difficulty.hard ? "Hard" : "Routine";
  const rows: string[] = [
    `${job.spec.routing ?? `Difficulty: ${job.spec.taskType === "implementation" ? level : "review"}`}${model ? ` · model ${model}` : ""}`,
    ...(c.t3?.branch ? [`Branch ${c.t3.branch}${job.state === "done" && c.merge?.state !== "merged" ? ", not merged" : ""} · T3 thread "Build: ${job.spec.title}"`] : []),
    ...(c.external ? [`External T3 thread ${c.external.threadId} · reported ${ago(c.external.at)}. Tracking only; merge and deploy need separate approval.`, c.external.note, ...c.external.evidence] : []),
    ...(c.merge?.sha ? [`Merged as ${c.merge.sha.slice(0, 7)}`] : []), ...(c.merge?.local ? [c.merge.local] : []),
    ...(c.nextStep && c.nextStep !== c.external?.note ? [c.nextStep] : []),
  ];
  return <details className="rounded border bg-background/60 p-2 text-xs">
    <summary className="cursor-pointer select-none font-medium text-muted-foreground">Technical details</summary>
    <ul className="mt-1.5 space-y-1 break-words text-muted-foreground">{rows.map((r, i) => <li key={i}><Rich text={r} /></li>)}</ul>
  </details>;
}

/** Next · Now · Done. A card shows its area and status; opened, it reads as a story, with technical details collapsed. */
export function Progress({ jobs, nodes, profiles, busy, send }: { jobs: Job[]; nodes: MapNode[]; profiles: Profile[]; busy: boolean; send: Send }) {
  const [open, setOpen] = useState<string | null>(null);
  const where = (j: Job) => { const s = cp(j).story; if (s?.area) return s.area; const n = nodes.find(n => j.spec.nodeIds.includes(n.id) && n.spec.kind === "page"); return n ? `${n.spec.section} › ${n.spec.name}` : null; };
  const model = (j: Job) => (j.attempt as { profile?: Profile } | null)?.profile?.model ?? profiles.find(p => p.id === j.spec.profileId)?.model;
  const merging = (j: Job) => ["queued", "merging", "resolving"].includes(cp(j).merge?.state ?? "");
  const columns: [string, Job[]][] = [
    ["Next", jobs.filter(j => ["proposed", "approved"].includes(j.state))],
    ["Now", jobs.filter(j => ["working", "stopping", "review", "external-working", "external-blocked", "external-review", "external-failed"].includes(j.state) || merging(j))],
    ["Done", jobs.filter(j => ["done", "external-done"].includes(j.state) && !merging(j)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))],
  ];
  return <section className="space-y-2">
    <h2 className={label}>Progress</h2>
    <div className="grid items-start gap-2 lg:grid-cols-3">{columns.map(([name, list]) => <div key={name} className="space-y-1.5 rounded-lg border p-2.5">
      <p className="text-xs font-semibold text-muted-foreground">{name} · {list.length}</p>
      {!list.length && <p className="text-xs text-muted-foreground">{name === "Next" ? "Start something in Talk." : name === "Now" ? "Nothing running." : "Nothing finished yet."}</p>}
      {list.slice(0, name === "Done" ? 12 : 20).map(j => { const c = cp(j), isOpen = open === j.id;
        return <div id={j.id} key={j.id} className="rounded-md bg-muted/60">
          <button onClick={() => setOpen(isOpen ? null : j.id)} aria-expanded={isOpen} className="block w-full rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted">
            <span className="font-medium">{j.spec.title}</span>
            <span className="block text-xs text-muted-foreground">{where(j) ? `${where(j)} · ${stateWord(j)}` : stateWord(j).replace(/^./, x => x.toUpperCase())} {ago(j.updatedAt)}</span>
            {c.merge && <span className={`block text-xs ${c.merge.state === "failed" ? "text-red-600" : c.merge.state === "merged" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-600"}`}>{mergeWords(c.merge)}</span>}
          </button>
          {j.state === "done" && canMerge(j) && <div className="px-2.5 pb-2"><button className={btn} disabled={busy} onClick={() => void send({ action: "merge", id: j.id, revision: j.revision })}>Merge</button></div>}
          {isOpen && <div className="space-y-2 px-2.5 pb-2.5">
            {c.story ? <StoryView story={c.story} /> : <div className="space-y-1 text-sm"><p>{j.spec.outcome}</p><p className="text-xs text-muted-foreground">{statusLine(j)}</p></div>}
            {c.feedback?.map((f, i) => <p key={i} className="text-xs">{f.decision === "redo" ? "You asked" : "You noted"}: {f.note}</p>)}
            <Technical job={j} model={model(j)} />
          </div>}
        </div>; })}
    </div>)}</div>
  </section>;
}
