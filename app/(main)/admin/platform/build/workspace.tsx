"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { z } from "zod";
import { difficulty, type nodeSpec, type Profile } from "@/lib/build/contract";
import { modelGuidance, unknownGuidance } from "@/lib/build/model-guidance";
import { loop } from "@/lib/build/factory-guide";
import { TalkPanel, type Talk } from "./talk";
import { Playbook } from "./playbook";
import { ago, canMerge, cp, type Checkpoint, type Job } from "./progress";
import { AppMap, ProductList, type Focus } from "./product";
import { productMap } from "@/lib/build/features";
import type { Release } from "@/lib/build/release";
import type { PlaybookEdits } from "@/lib/build/playbook";
import type { MemoryEntry } from "@/lib/build/memory";
import type { Usage } from "@/lib/build/contract";

type Node = { id: string; revision: number; spec: z.infer<typeof nodeSpec>; updatedAt: string };
type Worker = { daily?: { enabled: boolean; profileId: string; lastRunDate?: string }; quotaBuckets?: Record<string, { observedAt: string; reset: string }>; catalog?: CatalogModel[]; catalogAt?: string; autoApprove?: { mode: "off" | "record" | "on" }; head?: string; id?: string; lastSeenAt?: string; playbook?: PlaybookEdits; usage?: Usage; memory?: MemoryEntry[]; docs?: { at?: string; files: { path: string; size: number }[] } };
type Data = { control: { paused: boolean; revision: number; profiles: Profile[]; worker: Worker } | null; release?: Release | null; nodes: Node[]; edges: { fromId: string; toId: string; kind: string }[]; jobs: Job[]; talks?: Talk[] };
type Send = (command: unknown) => Promise<boolean>;
type CatalogModel = { provider: string; model: string; name: string };
type Tier = "off" | "routine" | "hard";

const btn = "rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";
const solid = "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50";
const field = "rounded-md border bg-background p-2 text-sm";
const label = "text-xs font-medium uppercase tracking-wide text-muted-foreground";
// Profiles are generated from catalog choices, never typed. One quota bucket per provider subscription.
const makeProfile = (m: CatalogModel, tier: "routine" | "hard", write: boolean): Profile => ({ id: `${m.provider}.${m.model}`, enabled: true, provider: m.provider, account: "default", billing: "subscription", model: m.model, options: {}, quotaBucket: m.provider, taskTypes: write ? ["inspect", "implementation", "review"] : ["inspect", "review"], tools: write ? ["git-read", "code-write"] : ["git-read"], dataScope: "estio-repository", quality: difficulty[tier], concurrency: 1, maxAttempts: 2, fallbacks: [] });
const blockedStates = ["blocked-lease-expired", "waiting-for-capacity", "blocked-configuration", "blocked-stale-approval"];

/** Build: talk, what needs you, the product with its status, and the app by section. Settings sit behind one button. */
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
  const ask = (text: string) => { setSeed({ text, n: Date.now() }); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const [focus, setFocus] = useState<Focus>(null);
  const map = useMemo(() => productMap({ nodes: data?.nodes ?? [], edges: data?.edges ?? [], jobs: data?.jobs ?? [] }), [data?.nodes, data?.edges, data?.jobs]);
  return <main className="mx-auto max-w-6xl space-y-6 p-3 sm:p-6">
    <Link href="/admin/platform" className="text-sm underline">← Platform</Link>
    <header className="flex flex-wrap items-center gap-2">
      <h1 className="mr-2 text-3xl font-semibold">Build</h1>
      <Pill ok={online}>{online ? "Mac connected" : "Mac offline"}</Pill>
      <button className="contents" disabled={busy || !data} onClick={() => send({ action: "pause", paused: !paused })} title={paused ? "Resume: approved tasks start" : "Pause: nothing new starts"}><Pill ok={!paused}>{paused ? "Paused · resume" : "Running · pause"}</Pill></button>
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
    {data && <ProductList map={map} jobs={data.jobs} nodes={data.nodes} release={data.release ?? null} profiles={data.control?.profiles ?? []} busy={busy} send={send} ask={ask} focus={focus} />}
    {data && <AppMap map={map} nodes={data.nodes} edges={data.edges} busy={busy} send={send} ask={ask} reveal={id => setFocus({ id, n: Date.now() })} />}
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
      {!failed && c.result?.decisions && c.result.decisions !== "none" && <div className="rounded-md border border-amber-400 bg-amber-50 p-2 text-foreground dark:bg-amber-950/30"><p className="font-medium">Decisions it made: check before merging</p><p className="whitespace-pre-wrap">{c.result.decisions}</p></div>}
      {!failed && c.result?.decisions === "none" && <p>It made no decisions beyond the task.</p>}
      {c.review?.length ? <ChangedFiles job={job} files={c.review} /> : null}
      {text && <><button className="underline" onClick={() => setMore(!more)}>{more ? "Hide report" : "Full report"}</button>{more && <p className="max-h-64 overflow-auto whitespace-pre-wrap rounded border bg-background p-2 text-foreground">{text}</p>}</>}
      {redo && <div className="flex flex-wrap items-end gap-2 pt-1"><textarea autoFocus rows={3} className={`${field} min-w-60 flex-1`} placeholder="What should change?" value={note} maxLength={2000} onChange={e => setNote(e.target.value)} /><button className={solid} disabled={busy || note.trim().length < 3} onClick={async () => { if (await send({ action: "redo", id: job.id, revision: job.revision, note: note.trim() })) { setNote(""); setRedo(false); } }}>Send</button></div>}
    </div>}>
    {!failed && canMerge(job) && <button className={solid} disabled={busy} title="Accept and merge into the release branch" onClick={() => send({ action: "merge", id: job.id, revision: job.revision })}>Merge</button>}
    {!failed && <button className={canMerge(job) ? btn : solid} disabled={busy} onClick={() => send({ action: "accept", id: job.id, revision: job.revision })}>{canMerge(job) ? "Accept, merge later" : "Accept"}</button>}
    {failed && retry && <button className={btn} disabled={busy} onClick={retry}>Try again</button>}
    <button className={btn} disabled={busy} onClick={() => setRedo(!redo)}>Redo…</button>
  </Row>;
}

/** What the task changed, readable on the page: new files in full, edits as their changes against the task's base. */
function ChangedFiles({ job, files }: { job: Job; files: NonNullable<Checkpoint["review"]> }) {
  const [open, setOpen] = useState<string | null>(null), [text, setText] = useState<string | null>(null), [error, setError] = useState("");
  async function show(path: string) {
    if (open === path) { setOpen(null); return; }
    setOpen(path); setText(null); setError("");
    try { const res = await fetch(`/api/build?job=${encodeURIComponent(job.id)}&file=${encodeURIComponent(path)}`, { cache: "no-store" }); const value = await res.json(); if (!res.ok) throw new Error(value.error); setText(value.text); }
    catch (e) { setError(e instanceof TypeError ? "Couldn't reach the server." : e instanceof Error ? e.message : String(e)); }
  }
  const mark = { added: "New", modified: "Changed", deleted: "Removed" };
  return <div className="space-y-1">
    <p className="font-medium text-foreground">Changed files · {files.length}</p>
    <div className="flex flex-wrap gap-1.5">{files.map(f => <button key={f.path} onClick={() => void show(f.path)} className={`rounded border px-2 py-0.5 text-left ${open === f.path ? "bg-muted" : "hover:bg-muted"}`}><span className="text-muted-foreground">{mark[f.change]}</span> {f.path}</button>)}</div>
    {open && <div className="max-h-[28rem] overflow-auto rounded border bg-background p-2 font-mono text-[11px] leading-relaxed text-foreground">
      {error ? <p className="text-red-600">{error}</p> : text === null ? <p>Loading…</p> : files.find(f => f.path === open)?.change === "added"
        ? <pre className="whitespace-pre-wrap">{text}</pre>
        : text.split("\n").map((line, i) => <div key={i} className={`whitespace-pre-wrap ${line.startsWith("+") ? "bg-emerald-500/15" : line.startsWith("-") ? "bg-red-500/15" : line.startsWith("@@") ? "text-muted-foreground" : ""}`}>{line || " "}</div>)}
      {files.find(f => f.path === open)?.truncated && <p className="mt-1 text-muted-foreground">Shortened here; the full file is on the branch.</p>}
    </div>}
  </div>;
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
