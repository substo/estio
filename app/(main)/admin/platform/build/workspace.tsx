"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { z } from "zod";
import { difficulty, undescribed, type nodeSpec, type jobSpec, type Profile } from "@/lib/build/contract";
import { modelGuidance, unknownGuidance } from "@/lib/build/model-guidance";
import { suggestedReferences } from "@/lib/build/watch-suggestions";
import { loop } from "@/lib/build/factory-guide";
import { TalkPanel, type Talk } from "./talk";
import { Playbook } from "./playbook";
import type { PlaybookEdits } from "@/lib/build/playbook";
import type { MemoryEntry } from "@/lib/build/memory";
import type { Usage } from "@/lib/build/contract";

type Node = { id: string; revision: number; spec: z.infer<typeof nodeSpec>; updatedAt: string };
type Job = { id: string; key: string; revision: number; state: string; spec: z.infer<typeof jobSpec>; checkpoint: unknown; attempt: unknown; approval: unknown; createdAt: string; updatedAt: string };
type Worker = { daily?: { enabled: boolean; profileId: string; lastRunDate?: string }; quotaBuckets?: Record<string, { observedAt: string; reset: string }>; catalog?: CatalogModel[]; catalogAt?: string; autoApprove?: { mode: "off" | "record" | "on" }; head?: string; id?: string; lastSeenAt?: string; playbook?: PlaybookEdits; usage?: Usage; memory?: MemoryEntry[]; docs?: { at?: string; files: { path: string; size: number }[] } };
type Data = { control: { paused: boolean; revision: number; profiles: Profile[]; worker: Worker } | null; nodes: Node[]; edges: { fromId: string; toId: string; kind: string }[]; jobs: Job[]; talks?: Talk[] };
type Send = (command: unknown) => Promise<boolean>;
type Merge = { state: "queued" | "merging" | "resolving" | "merged" | "failed"; at: string; sha?: string; reason?: string; local?: string; branch?: string };
type Checkpoint = { merge?: Merge; evidence?: { ok?: boolean; files?: string[] }; reason?: string; nextStep?: string; result?: { text?: string; needsAnswer?: boolean }; t3?: { threadId?: string; branch?: string }; feedback?: { at: string; decision: string; note: string; sentAt?: string }[]; auto?: { wouldApprove: boolean; reasons: string[] }; proposalsCreated?: number };
type CatalogModel = { provider: string; model: string; name: string };
type Tier = "off" | "routine" | "hard";

const btn = "rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";
const solid = "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50";
const field = "rounded-md border bg-background p-2 text-sm";
const label = "text-xs font-medium uppercase tracking-wide text-muted-foreground";
const sections = ["CRM", "Studio", "Public website", "Platform admin", "Account & onboarding"];
const cp = (j: Job) => (j.checkpoint ?? {}) as Checkpoint;
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString(); };
const level = (j: Job) => j.spec.quality === difficulty.hard ? "Hard" : "Routine";
const model = (j: Job, data: Data) => (j.attempt as { profile?: Profile } | null)?.profile?.model ?? data.control?.profiles.find(p => p.id === j.spec.profileId)?.model;
// Profiles are generated from catalog choices, never typed. One quota bucket per provider subscription.
const makeProfile = (m: CatalogModel, tier: "routine" | "hard", write: boolean): Profile => ({ id: `${m.provider}.${m.model}`, enabled: true, provider: m.provider, account: "default", billing: "subscription", model: m.model, options: {}, quotaBucket: m.provider, taskTypes: write ? ["inspect", "implementation", "review"] : ["inspect", "review"], tools: write ? ["git-read", "code-write"] : ["git-read"], dataScope: "estio-repository", quality: difficulty[tier], concurrency: 1, maxAttempts: 2, fallbacks: [] });
const blockedStates = ["blocked-lease-expired", "waiting-for-capacity", "blocked-configuration", "blocked-stale-approval"];

/** Build: talk, what needs you, the app's progress by section, and the work board. Settings sit behind one button. */
export default function BuildWorkspace() {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(false), [seed, setSeed] = useState<{ text: string; n: number } | null>(null);
  // Background refreshes retry quietly (a phone dropping signal or a deploy restarting the server); only a repeated
  // failure is shown, in plain words, and it clears itself when the connection returns.
  const [offline, setOffline] = useState(0);
  const load = useCallback(async () => {
    try { const res = await fetch("/api/build", { cache: "no-store" }); const value = await res.json(); if (!res.ok) throw new Error(value.error); setData(value); setOffline(0); }
    catch { setOffline(n => n + 1); }
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 15000); return () => clearInterval(timer); }, [load]);
  const send: Send = async command => { setBusy(true); setError(""); try { const res = await fetch("/api/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) }); const value = await res.json(); if (!res.ok) throw new Error(value.error); await load(); return true; } catch (e) { setError(e instanceof TypeError ? "Couldn't reach the server. Check your connection and try again." : e instanceof Error ? e.message : String(e)); return false; } finally { setBusy(false); } };
  const w = data?.control?.worker, paused = data?.control?.paused ?? true;
  const online = !!w?.lastSeenAt && Date.now() - Date.parse(w.lastSeenAt) < 120_000;
  const models = data?.control?.profiles.filter(p => p.enabled) ?? [];
  const mode = w?.autoApprove?.mode ?? "off";
  const ask = (text: string) => { setSeed({ text, n: Date.now() }); window.scrollTo({ top: 0, behavior: "smooth" }); };
  return <main className="mx-auto max-w-6xl space-y-6 p-3 sm:p-6">
    <Link href="/admin/platform" className="text-sm underline">← Platform</Link>
    <header className="flex flex-wrap items-center gap-2">
      <h1 className="mr-2 text-3xl font-semibold">Build</h1>
      <Pill ok={online}>{online ? "Mac connected" : "Mac offline"}</Pill>
      <button className="contents" disabled={busy || !data} onClick={() => send({ action: "pause", paused: !paused })} title={paused ? "Resume: approved tasks start" : "Pause: nothing new starts"}><Pill ok={!paused}>{paused ? "Paused · resume" : "Running · pause"}</Pill></button>
      <Pill ok={mode !== "off"}>Autopilot {mode === "on" ? "on" : mode === "record" ? "watching" : "off"}</Pill>
      <Pill ok={models.length > 0}>{models.length} model{models.length === 1 ? "" : "s"} allowed</Pill>
      {Object.entries(w?.usage ?? {}).map(([bucket, u]) => <UsageGauge key={bucket} name={bucket === "claudeAgent" ? "Claude" : bucket === "codex" ? "Codex" : bucket} usage={u} />)}
      <button className={`${btn} ml-auto`} onClick={() => setSettings(!settings)} aria-expanded={settings}>⚙ Settings</button>
    </header>
    {offline >= 2 && <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">Connection lost, retrying… Nothing you started is affected.</p>}
    {error && <p role="alert" className="rounded-md border border-red-400 p-3 text-sm">{error}</p>}
    {!data && <p className="text-sm text-muted-foreground">Loading Build…</p>}
    {data && settings && <Settings data={data} busy={busy} send={send} close={() => setSettings(false)} />}
    {data && <TalkPanel talks={data.talks ?? []} paused={paused} seed={seed} reload={load} models={models.filter(p => p.taskTypes.includes("review")).map(p => ({ id: p.id, name: w?.catalog?.find(c => c.provider === p.provider && c.model === p.model)?.name ?? p.model }))}
      blocker={!online ? "The Mac is offline; it relays the conversation." : models.some(p => p.tools.includes("code-write")) ? null : "Allow a model that may write code first (Settings)."} />}
    {data && <NeedsYou data={data} busy={busy} send={send} online={online} openSettings={() => setSettings(true)} />}
    {data && <AppMap data={data} busy={busy} send={send} ask={ask} />}
    {data && <Progress data={data} busy={busy} send={send} />}
    {data && <Playbook memory={w?.memory ?? []} edits={w?.playbook} docs={w?.docs?.files ?? []} busy={busy} send={send} ask={ask} />}
  </main>;
}

/** Allowance left, as in QuotaCell: the lowest of the session and weekly windows; details on hover/tap. */
function UsageGauge({ name, usage }: { name: string; usage: Usage[string] }) {
  const stale = Date.now() - Date.parse(usage.at) > 30 * 60_000, r = Math.round(usage.remaining);
  const color = stale ? "bg-muted-foreground" : r > 30 ? "bg-emerald-500" : r >= 10 ? "bg-amber-500" : "bg-red-500";
  const detail = usage.windows.map(w => `${w.label}: ${Math.round(w.remaining)}% left${w.resetsAt ? `, resets ${new Date(w.resetsAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}`).join("\n");
  return <details className="relative"><summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs">
    <span className="relative h-2 w-6 overflow-hidden rounded-full bg-background"><span className={`absolute inset-y-0 left-0 ${color}`} style={{ width: `${r}%` }} /></span>{name} {r}%{stale ? " (old)" : ""}</summary>
    <div className="absolute z-10 mt-1 w-64 space-y-1 rounded-md border bg-background p-2 text-xs shadow">{usage.plan && <p className="font-medium">{name} {usage.plan}</p>}<p className="whitespace-pre-line">{detail}</p><p className="text-muted-foreground">Read {ago(usage.at)} on the Mac. Build sends new work to the subscription with more left.</p></div></details>;
}
function Pill({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs"><span aria-hidden className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} />{children}</span>;
}
function Row({ icon, title, detail, children }: { icon: string; title: ReactNode; detail?: ReactNode; children?: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-3 rounded-lg border p-3"><span aria-hidden className="text-lg leading-6">{icon}</span>
    <div className="min-w-0 flex-1"><p className="text-sm font-medium">{title}</p>{detail && <div className="text-xs text-muted-foreground">{detail}</div>}</div>
    {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}</div>;
}

/** Only what needs the owner, in plain words, with the one decision inline. Empty means nothing is waiting. */
function NeedsYou({ data, busy, send, online, openSettings }: { data: Data; busy: boolean; send: Send; online: boolean; openSettings: () => void }) {
  const rows: ReactNode[] = [];
  const retry = async (j: Job) => {
    if (j.state === "blocked-lease-expired" && !window.confirm(`Is the T3 thread "Build: ${j.spec.title}" stopped? Only try again once it is.`)) return;
    if (await send({ action: "resume", id: j.id, revision: j.revision, stoppedEvidence: "Owner confirmed on the Build page that the previous attempt is not running" }))
      await send({ action: "approve", id: j.id, revision: j.revision + 1 });
  };
  if (!data.control?.profiles.some(p => p.enabled)) rows.push(<Row key="models" icon="⚙️" title="Allow at least one model" detail="Nothing can run until you choose which models Build may use."><button className={solid} onClick={openSettings}>Choose models</button></Row>);
  if (!online) rows.push(<Row key="mac" icon="💤" title="The Mac is offline" detail="Wake it and keep T3 Code open. Conversations and tasks continue automatically." />);
  for (const j of data.jobs.filter(j => j.state === "review" && cp(j).result?.needsAnswer))
    rows.push(<Row key={j.id} icon="❓" title={`${j.spec.title} is asking you something`} detail={`Answer in T3, in the thread "Build: ${j.spec.title}".`} />);
  for (const j of data.jobs.filter(j => j.state === "review" && !cp(j).result?.needsAnswer)) rows.push(<Result key={j.id} job={j} busy={busy} send={send} />);
  for (const j of data.jobs.filter(j => j.state === "failed")) rows.push(<Result key={j.id} job={j} busy={busy} send={send} failed retry={() => void retry(j)} />);
  for (const j of data.jobs.filter(j => blockedStates.includes(j.state)))
    rows.push(<Row key={j.id} icon="⏸️" title={`${j.spec.title} is stuck`} detail={plainBlock(j)}><button className={btn} disabled={busy} onClick={() => void retry(j)}>Try again</button><button className={btn} disabled={busy} onClick={() => send({ action: "revoke", id: j.id, revision: j.revision })}>Drop it</button></Row>);
  for (const j of data.jobs.filter(j => j.state === "proposed"))
    rows.push(<Row key={j.id} icon="💡" title={`Suggested: ${j.spec.title}`} detail={<>{j.spec.outcome}<br />{j.spec.reason}</>}><button className={solid} disabled={busy} onClick={() => send({ action: "approve", id: j.id, revision: j.revision })}>Start</button><button className={btn} disabled={busy} onClick={() => send({ action: "revoke", id: j.id, revision: j.revision })}>Not now</button></Row>);
  for (const j of data.jobs.filter(j => cp(j).merge?.state === "failed"))
    rows.push(<Row key={`m-${j.id}`} icon="🔀" title={`${j.spec.title} didn't merge`} detail={cp(j).merge!.reason}><button className={solid} disabled={busy} onClick={() => send({ action: "merge", id: j.id, revision: j.revision })}>Try again</button></Row>);
  for (const n of data.nodes.filter(n => n.spec.draft))
    rows.push(<Row key={n.id} icon="📝" title={`Is this right? ${n.spec.section ?? ""} › ${n.spec.name}`} detail={<>{n.spec.draft!.purpose}{n.spec.draft!.features.length ? ` Features: ${n.spec.draft!.features.map(f => f.name).join(", ")}.` : ""}</>}><button className={solid} disabled={busy} onClick={() => send({ action: "draft", id: n.id, revision: n.revision, decision: "confirm" })}>Yes</button><button className={btn} disabled={busy} onClick={() => send({ action: "draft", id: n.id, revision: n.revision, decision: "discard" })}>No</button></Row>);
  for (const n of data.nodes.filter(n => n.spec.watch?.status === "watching" && n.spec.watch.latest && n.spec.watch.latest !== n.spec.watch.seen))
    rows.push(<Row key={n.id} icon="👀" title={`${n.spec.name} changed`} detail={n.spec.observed}><a className={btn} href={n.spec.watch!.url} target="_blank" rel="noreferrer">Open</a><button className={btn} disabled={busy} onClick={() => send({ action: "watch-update", id: n.id, seen: true })}>Seen</button></Row>);
  return <section className="space-y-2">
    <h2 className={label}>Needs you{rows.length ? ` · ${rows.length}` : ""}</h2>
    {rows.length ? <div className="space-y-2">{rows}</div> : <p className="rounded-lg border p-3 text-sm text-muted-foreground">Nothing is waiting for you.</p>}
  </section>;
}
const canMerge = (j: Job) => j.spec.taskType === "implementation" && !!cp(j).t3?.branch && cp(j).evidence?.ok === true && !!cp(j).evidence?.files?.length && !["queued", "merging", "resolving", "merged"].includes(cp(j).merge?.state ?? "");
function mergeWords(m: Merge) {
  return m.state === "merged" ? `Merged${m.sha ? ` (${m.sha.slice(0, 7)})` : ""}, not deployed yet` : m.state === "resolving" ? "Merging: an agent is resolving conflicts" : m.state === "failed" ? `Merge failed: ${m.reason ?? "unknown"}` : "Merging…";
}
function plainBlock(j: Job) {
  return j.state === "waiting-for-capacity" ? "The allowed models hit their usage limit. It continues when a limit resets, or allow another model."
    : j.state === "blocked-lease-expired" ? "The Mac stopped hearing from this task. Check its T3 thread is stopped, then try again."
    : j.state === "blocked-stale-approval" ? "The code or settings changed after you started it, so it needs a fresh start."
    : cp(j).reason ?? "It can't run as configured.";
}
/** A finished task: what it says, where the work is, and accept or redo with a note (same T3 thread). */
function Result({ job, busy, send, failed, retry }: { job: Job; busy: boolean; send: Send; failed?: boolean; retry?: () => void }) {
  const [note, setNote] = useState(""), [redo, setRedo] = useState(false), [more, setMore] = useState(false);
  const c = cp(job), text = c.result?.text ?? c.reason ?? "";
  return <Row icon={failed ? "⚠️" : "✅"} title={failed ? `${job.spec.title} didn't finish` : `${job.spec.title} is ready`}
    detail={<div className="space-y-1">
      <p>{failed ? c.reason ?? "The task failed." : job.spec.outcome}{c.t3?.branch ? ` · branch ${c.t3.branch}` : ""}</p>
      {text && <><button className="underline" onClick={() => setMore(!more)}>{more ? "Hide" : "What it says"}</button>{more && <p className="max-h-64 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 text-foreground">{text}</p>}</>}
      {redo && <div className="flex flex-wrap gap-2 pt-1"><input autoFocus className={`${field} min-w-60 flex-1`} placeholder="What should change?" value={note} maxLength={2000} onChange={e => setNote(e.target.value)} /><button className={solid} disabled={busy || note.trim().length < 3} onClick={async () => { if (await send({ action: "redo", id: job.id, revision: job.revision, note: note.trim() })) { setNote(""); setRedo(false); } }}>Send</button></div>}
    </div>}>
    {!failed && canMerge(job) && <button className={solid} disabled={busy} title="Accept and merge into the release branch" onClick={() => send({ action: "merge", id: job.id, revision: job.revision })}>Merge</button>}
    {!failed && <button className={canMerge(job) ? btn : solid} disabled={busy} onClick={() => send({ action: "accept", id: job.id, revision: job.revision })}>{canMerge(job) ? "Accept, merge later" : "Accept"}</button>}
    {failed && retry && <button className={btn} disabled={busy} onClick={retry}>Try again</button>}
    <button className={btn} disabled={busy} onClick={() => setRedo(!redo)}>Redo…</button>
  </Row>;
}

/** The app by section: how much is described, what is in work, and drill-down to screens. Changes go through Talk. */
function AppMap({ data, busy, send, ask }: { data: Data; busy: boolean; send: Send; ask: (text: string) => void }) {
  const [open, setOpen] = useState<string | null>(null), [screen, setScreen] = useState<string | null>(null);
  const pages = data.nodes.filter(n => n.spec.kind === "page");
  // A task belongs to a screen when it names the screen or a file the screen imports directly.
  const importers = new Map<string, string[]>();
  for (const e of data.edges) if (e.kind === "uses") importers.set(e.toId, [...(importers.get(e.toId) ?? []), e.fromId]);
  const screensOf = (j: Job) => new Set(j.spec.nodeIds.flatMap(id => [id, ...(importers.get(id) ?? [])]));
  const active = data.jobs.filter(j => !["done", "revoked"].includes(j.state));
  const stats = sections.map(name => {
    const list = pages.filter(p => p.spec.section === name), ids = new Set(list.map(p => p.id));
    return { name, list, described: list.filter(p => p.spec.purpose !== undescribed).length, working: active.filter(j => [...screensOf(j)].some(id => ids.has(id))).length };
  });
  const current = stats.find(s => s.name === open);
  return <section className="space-y-2">
    <h2 className={label}>The app</h2>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{stats.map(s => <button key={s.name} onClick={() => { setOpen(open === s.name ? null : s.name); setScreen(null); }}
      className={`rounded-lg border p-3 text-left hover:bg-muted/50 ${open === s.name ? "ring-2 ring-primary" : ""}`}>
      <p className="text-sm font-semibold">{s.name}</p>
      <div className="my-2 flex h-1.5 overflow-hidden rounded-full bg-muted"><span className="bg-primary" style={{ width: `${s.list.length ? (s.described / s.list.length) * 100 : 0}%` }} />{s.working > 0 && <span className="w-2 bg-amber-500" />}</div>
      <p className="text-xs text-muted-foreground">{s.list.length} screen{s.list.length === 1 ? "" : "s"} · {s.described} described{s.working ? ` · ${s.working} in work` : ""}</p>
    </button>)}</div>
    <p className="text-xs text-muted-foreground">The bar fills as screens get described; the daily review describes one a day. Tap a section to see its screens.</p>
    {current && <div className="space-y-3 rounded-lg border p-3">
      {[...new Set(current.list.map(p => p.spec.area ?? "Other"))].sort().map(area => <div key={area} className="space-y-1">
        <p className="text-sm font-semibold">{area}</p>
        <div className="grid gap-1 sm:grid-cols-2">{current.list.filter(p => (p.spec.area ?? "Other") === area).sort((a, b) => a.spec.name.localeCompare(b.spec.name)).map(p => {
          const tasks = data.jobs.filter(j => screensOf(j).has(p.id)), open = tasks.filter(j => !["done", "revoked"].includes(j.state)).length;
          return <button key={p.id} onClick={() => setScreen(screen === p.id ? null : p.id)} className={`rounded-md border px-2.5 py-1.5 text-left text-sm hover:bg-muted/50 ${screen === p.id ? "bg-muted" : ""}`}>
            <span className="font-medium">{p.spec.name}</span>{open > 0 && <span className="ml-1 text-xs text-amber-600">· {open} in work</span>}{p.spec.draft && <span className="ml-1 text-xs text-primary">· description to confirm</span>}
            <span className="block truncate text-xs text-muted-foreground">{p.spec.purpose === undescribed ? p.spec.route : p.spec.purpose}</span>
          </button>;
        })}</div>
        {current.list.some(p => p.id === screen && (p.spec.area ?? "Other") === area) && <Screen node={current.list.find(p => p.id === screen)!} data={data} tasks={data.jobs.filter(j => screensOf(j).has(screen!))} ask={ask} />}
      </div>)}
    </div>}
    <Watching data={data} busy={busy} send={send} />
  </section>;
}
function Screen({ node, data, tasks, ask }: { node: Node; data: Data; tasks: Job[]; ask: (text: string) => void }) {
  const features = data.edges.filter(e => e.fromId === node.id && e.kind === "contains").map(e => data.nodes.find(n => n.id === e.toId)).filter(Boolean) as Node[];
  const refs = data.edges.filter(e => e.toId === node.id && e.kind === "inspires").map(e => data.nodes.find(n => n.id === e.fromId)).filter(Boolean) as Node[];
  const described = node.spec.purpose !== undescribed;
  return <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
    <p className="text-xs text-muted-foreground">{node.spec.route}</p>
    <p>{described ? node.spec.purpose : "Not described yet. The daily review will describe it, or ask about it below."}</p>
    {described && node.spec.journey && !/^Not /.test(node.spec.journey) && <p className="text-muted-foreground">{node.spec.journey}</p>}
    {features.length > 0 && <ul className="list-disc pl-5">{features.map(f => <li key={f.id}><span className="font-medium">{f.spec.name}</span>: {f.spec.purpose}</li>)}</ul>}
    {tasks.length > 0 && <div><p className="text-xs font-medium">History</p>{tasks.slice(0, 8).map(j => <p key={j.id} className="text-xs">{j.state === "done" ? "✓" : "•"} {j.spec.title} <span className="text-muted-foreground">· {stateWord(j)} · {ago(j.updatedAt)}</span></p>)}</div>}
    {refs.length > 0 && <p className="text-xs">Watching for ideas: {refs.map(r => r.spec.name).join(", ")}</p>}
    <button className={btn} onClick={() => ask(`About the ${node.spec.section} screen "${node.spec.name}" (${node.spec.route}): `)}>Ask or change something here</button>
  </div>;
}
/** Links worth learning from, each with why it's here and the screens it could improve. */
function Watching({ data, busy, send }: { data: Data; busy: boolean; send: Send }) {
  const [adding, setAdding] = useState(false);
  const refs = data.nodes.filter(n => n.spec.kind === "reference" && n.spec.watch?.status !== "rejected");
  const linked = (id: string) => data.edges.filter(e => e.fromId === id && e.kind === "inspires").map(e => data.nodes.find(n => n.id === e.toId)?.spec.name).filter(Boolean);
  const suggestions = suggestedReferences.filter(r => !data.nodes.some(n => n.spec.watch?.url === r.url));
  return <details className="rounded-lg border p-3">
    <summary className="cursor-pointer text-sm font-medium">Watching for ideas · {refs.length}</summary>
    <p className="mt-2 text-xs text-muted-foreground">Repos, apps and videos to learn from. GitHub repos are checked daily without using AI; when one changes, the daily review looks at its linked screen with that in mind.</p>
    <div className="mt-2 space-y-1.5">{refs.map(n => { const updated = !!n.spec.watch?.latest && n.spec.watch.latest !== n.spec.watch.seen, screens = linked(n.id);
      return <div key={n.id} className="flex flex-wrap items-start gap-2 rounded-md border p-2 text-sm"><div className="min-w-0 flex-1">
        <a href={n.spec.watch?.url} target="_blank" rel="noreferrer" className="font-medium underline">{n.spec.name}</a>{updated && <span className="ml-1 text-xs text-amber-600">· updated</span>}
        <p className="text-xs">Why: {n.spec.intent}</p><p className="text-xs text-muted-foreground">{screens.length ? `For: ${screens.join(", ")}` : "Not linked to a screen yet; ask in Talk which screen it fits"}</p></div>
        <select aria-label="Status" className={`${field} !p-1 text-xs`} value={n.spec.watch?.status} disabled={busy} onChange={e => send({ action: "watch-update", id: n.id, status: e.target.value })}><option value="watching">Watching</option><option value="adopted">Adopted</option><option value="rejected">Not for us</option></select></div>; })}</div>
    {adding ? <form className="mt-2 flex flex-wrap gap-2" onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); if (await send({ action: "watch", url: String(f.get("url")).trim(), note: String(f.get("note") ?? "").trim() || undefined, screenIds: [] })) setAdding(false); }}>
      <input name="url" type="url" required placeholder="Link" className={`${field} min-w-52 flex-1`} /><input name="note" placeholder="What could we take from it?" className={`${field} min-w-52 flex-[2]`} maxLength={1000} /><button className={solid} disabled={busy}>Add</button></form>
      : <button className={`${btn} mt-2`} onClick={() => setAdding(true)}>+ Watch a link</button>}
    {suggestions.length > 0 && <div className="mt-2 space-y-1"><p className="text-xs text-muted-foreground">Mentioned before, not added:</p>{suggestions.map(r => <div key={r.url} className="flex items-start gap-2 text-xs"><button className={btn} disabled={busy} onClick={() => send({ action: "watch", url: r.url, note: r.note, screenIds: [] })}>Add</button><span><span className="break-all">{r.url}</span><br /><span className="text-muted-foreground">{r.note}</span></span></div>)}</div>}
  </details>;
}

function stateWord(j: Job) {
  return ({ proposed: "suggested", approved: "queued", working: "running", stopping: "stopping", review: "ready for you", done: "done", failed: "failed", revoked: "dropped" } as Record<string, string>)[j.state] ?? "stuck";
}
/** Next · Now · Done. Cards say where in the app, how hard, which model, and where the work is. */
function Progress({ data, busy, send }: { data: Data; busy: boolean; send: Send }) {
  const [open, setOpen] = useState<string | null>(null);
  const screenName = (j: Job) => { const n = data.nodes.find(n => j.spec.nodeIds.includes(n.id) && n.spec.kind === "page"); return n ? `${n.spec.section} › ${n.spec.name}` : j.spec.scope[0]; };
  const columns: [string, Job[]][] = [
    ["Next", data.jobs.filter(j => ["proposed", "approved"].includes(j.state))],
    ["Now", data.jobs.filter(j => ["working", "stopping", "review"].includes(j.state) || ["queued", "merging", "resolving"].includes(cp(j).merge?.state ?? ""))],
    ["Done", data.jobs.filter(j => j.state === "done" && !["queued", "merging", "resolving"].includes(cp(j).merge?.state ?? "")).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))],
  ];
  return <section className="space-y-2">
    <h2 className={label}>Progress</h2>
    <div className="grid gap-2 md:grid-cols-3">{columns.map(([name, jobs]) => <div key={name} className="space-y-1.5 rounded-lg border p-2.5">
      <p className="text-xs font-semibold text-muted-foreground">{name} · {jobs.length}</p>
      {!jobs.length && <p className="text-xs text-muted-foreground">{name === "Next" ? "Start something in Talk." : name === "Now" ? "Nothing running." : "Nothing finished yet."}</p>}
      {jobs.slice(0, name === "Done" ? 12 : 20).map(j => { const c = cp(j), m = model(j, data);
        return <button key={j.id} onClick={() => setOpen(open === j.id ? null : j.id)} className="block w-full rounded-md bg-muted/60 px-2.5 py-2 text-left text-sm hover:bg-muted">
          <span className="font-medium">{j.spec.title}</span>
          <span className="block text-xs text-muted-foreground">{screenName(j)} · {j.spec.taskType === "implementation" ? level(j) : "Review"}{m ? ` · ${m}` : ""} · {stateWord(j)} {ago(j.updatedAt)}</span>
          {c.merge && <span className={`block text-xs ${c.merge.state === "failed" ? "text-red-600" : c.merge.state === "merged" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-600"}`}>{mergeWords(c.merge)}</span>}
          {j.state === "done" && canMerge(j) && <span role="button" tabIndex={0} className={`${btn} mt-1 inline-block`} onClick={e => { e.stopPropagation(); if (!busy) void send({ action: "merge", id: j.id, revision: j.revision }); }}>Merge</span>}
          {open === j.id && <span className="mt-1.5 block space-y-1 text-xs">
            <span className="block">{j.spec.outcome}</span>
            {c.t3?.branch && <span className="block">Work is on branch {c.t3.branch}{j.state === "done" && c.merge?.state !== "merged" ? ", not merged" : ""} · T3 thread &quot;Build: {j.spec.title}&quot;</span>}
            {c.merge?.local && <span className="block text-muted-foreground">{c.merge.local}</span>}
            {c.nextStep && <span className="block text-muted-foreground">{c.nextStep}</span>}
            {c.feedback?.map((f, i) => <span key={i} className="block">{f.decision === "redo" ? "You asked" : "You noted"}: {f.note}</span>)}
          </span>}
        </button>; })}
    </div>)}</div>
  </section>;
}

/** One-time choices: models, autopilot, daily review, the queue switch, and a short how-it-works. */
function Settings({ data, busy, send, close }: { data: Data; busy: boolean; send: Send; close: () => void }) {
  const [choices, setChoices] = useState<Record<string, { tier: Tier; write: boolean }> | null>(null);
  const w = data.control?.worker, catalog = w?.catalog ?? [], approved = data.control?.profiles ?? [];
  const current = (m: CatalogModel) => { const p = approved.find(x => x.provider === m.provider && x.model === m.model && x.enabled); return { tier: (p ? (p.quality === difficulty.hard ? "hard" : "routine") : "off") as Tier, write: p ? p.tools.includes("code-write") : true }; };
  const pick = choices ?? Object.fromEntries(catalog.map(m => [`${m.provider}.${m.model}`, current(m)]));
  const set = (key: string, v: Partial<{ tier: Tier; write: boolean }>) => setChoices({ ...pick, [key]: { ...pick[key], ...v } });
  // The daily review uses an allowed read-only-capable model the system picks; the owner only switches it on.
  const reviewer = approved.find(p => p.enabled && p.taskTypes.includes("review") && p.quality === difficulty.routine) ?? approved.find(p => p.enabled && p.taskTypes.includes("review"));
  const mode = w?.autoApprove?.mode ?? "off";
  return <section className="space-y-4 rounded-lg border p-4">
    <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Settings</h2><button className={btn} onClick={close}>Done</button></div>
    <div className="space-y-2"><p className="text-sm font-medium">Models Build may use</p>
      <p className="text-xs text-muted-foreground">Build decides each task&apos;s difficulty and picks an allowed model at that level, falling back to another allowed one at a limit. The list comes from T3 on the Mac; new models appear as Not allowed.</p>
      {!catalog.length && <p className="text-sm text-muted-foreground">No list yet. Start the Mac; it reports T3&apos;s models within a minute.</p>}
      <div className="divide-y rounded-md border">{catalog.map(m => { const key = `${m.provider}.${m.model}`, g = modelGuidance[m.model], c = pick[key] ?? current(m);
        return <div key={key} className="flex flex-wrap items-center gap-2 p-2.5"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{m.name}</p><p className="text-xs text-muted-foreground">{g?.use ?? unknownGuidance}</p></div>
          <select aria-label={`${m.name} level`} className={field} value={c.tier} onChange={e => set(key, { tier: e.target.value as Tier })}><option value="off">Not allowed</option><option value="routine">Everyday tasks</option><option value="hard">Hard tasks</option></select>
          {c.tier !== "off" && <label className="text-xs"><input type="checkbox" checked={c.write} onChange={e => set(key, { write: e.target.checked })} /> May change code</label>}</div>; })}</div>
      {choices && <div className="flex gap-2"><button className={solid} disabled={busy} onClick={async () => {
        const profiles = catalog.flatMap(m => { const c = pick[`${m.provider}.${m.model}`]; return c && c.tier !== "off" ? [makeProfile(m, c.tier, c.write)] : []; });
        if (await send({ action: "profiles", revision: data.control?.revision ?? 1, profiles })) setChoices(null); }}>Save models</button><button className={btn} onClick={() => setChoices(null)}>Cancel</button></div>}
      {Object.entries(w?.quotaBuckets ?? {}).map(([bucket, o]) => <div key={bucket} className="flex flex-wrap items-center gap-2 text-sm"><span>{bucket} hit its usage limit {ago(o.observedAt)}.</span><button className={btn} disabled={busy} onClick={() => send({ action: "recheck", bucket, evidence: "Owner confirmed on the Build page that the limit has reset" })}>It has reset</button></div>)}
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm"><span className="font-medium">Autopilot</span><select className={`${field} block w-full`} value={mode} disabled={busy} onChange={e => send({ action: "auto-approve", mode: e.target.value })}><option value="off">Off: suggestions wait for you</option><option value="record">Watching: shows what it would start</option><option value="on">On: starts small, safe suggestions (3 a day)</option></select><span className="block text-xs text-muted-foreground">Small means 3 files or fewer, nothing sensitive (database, login, API, deploy).</span></label>
      <label className="space-y-1 text-sm"><span className="font-medium">Daily review</span><select className={`${field} block w-full`} value={w?.daily?.enabled ? "on" : "off"} disabled={busy || !reviewer} onChange={e => send({ action: "daily", enabled: e.target.value === "on", profileId: reviewer?.id ?? "none" })}><option value="off">Off</option><option value="on">On: looks at one screen a day</option></select><span className="block text-xs text-muted-foreground">Describes the screen and suggests up to three improvements. Read-only.{w?.daily?.lastRunDate ? ` Last ran ${w.daily.lastRunDate}.` : ""}</span></label>
    </div>
    <details><summary className="cursor-pointer text-sm font-medium">How Build works</summary>
      <ol className="mt-2 grid gap-2 sm:grid-cols-3">{loop.map((l, i) => <li key={l.step} className="rounded-md border p-2 text-xs"><span className="text-muted-foreground">{i + 1} · {l.who}</span><span className="block text-sm font-medium">{l.step}</span>{l.text}</li>)}</ol>
      <p className="mt-2 text-xs text-muted-foreground">Build never merges or deploys. The full explainer is documentation/software-factory.md.</p></details>
  </section>;
}
