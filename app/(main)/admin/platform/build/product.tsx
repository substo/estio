"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { applyFilters, areas, defaultFilters, kindWords, statusWords, statuses, type Feature, type Filters, type Kind, type ProductMap, type Status } from "@/lib/build/features";
import { undescribed, type Profile } from "@/lib/build/contract";
import { suggestedReferences } from "@/lib/build/watch-suggestions";
import type { Release } from "@/lib/build/release";
import { Chevron, Dot, StoryView, WorkItem, btn, type Job } from "./progress";

type MapNode = { id: string; revision: number; spec: { kind: string; name: string; purpose: string; section?: string; route?: string; journey?: string; observed?: string; intent?: string; draft?: unknown; watch?: { status: string; url: string; latest?: string; seen?: string } } };
type Edge = { fromId: string; toId: string; kind: string };
type Send = (command: unknown) => Promise<boolean>;
export type Focus = { id: string; n: number } | null;

const label = "text-xs font-medium uppercase tracking-wide text-muted-foreground";
const solid = "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50";
const field = "rounded-md border bg-background p-2 text-sm";
const pill = (on: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? "border-foreground/70 bg-foreground/[0.06] font-medium" : "text-muted-foreground hover:bg-muted"}`;
const select = "rounded-full border bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const kindPlural: Record<Kind, string> = { feature: "Features", page: "Pages", process: "Background processes", technology: "Technologies" };
const statusText: Record<Status, string> = { idea: "text-muted-foreground", doing: "text-amber-700 dark:text-amber-400", done: "text-emerald-700 dark:text-emerald-400" };
/** Bookkeeping prefixes ("Idea:", "Owner clarified scope …:") removed from record text. */
const clean = (text: string) => { const p = /^([^:.]{0,90}):\s+/.exec(text.trim()); return (p && /\b(idea|owner|retain|note|scope|correction)\b/i.test(p[1]) ? text.trim().slice(p[0].length) : text.trim()).replace(/^[a-z]/, c => c.toUpperCase()); };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The product, one list: features, pages with work, background processes and technologies, each once, with its status.
 * Done is hidden until asked for. A row opens to its story, its work and what it is linked to. See lib/build/features.ts.
 */
type TalkLink = { talkOf: (job: Job) => { id: string; title: string } | null; openTalk: (id: string) => void };
export function ProductList({ map, jobs, nodes, release, profiles, busy, send, ask, focus, talkOf, openTalk }: { map: ProductMap; jobs: Job[]; nodes: MapNode[]; release: Release | null; profiles: Profile[]; busy: boolean; send: Send; ask: (text: string) => void; focus: Focus } & TalkLink) {
  const [filters, setFilters] = useState<Filters>(defaultFilters), [open, setOpen] = useState<Set<string>>(new Set());
  const [openJob, setOpenJob] = useState<{ id: string; n: number } | null>(null);
  const { shown, counts } = useMemo(() => applyFilters(map.features, filters), [map, filters]);
  const set = (patch: Partial<Filters>) => setFilters(f => ({ ...f, ...patch }));
  const toggle = (id: string) => setOpen(o => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const filtered = !!(filters.q || filters.area || filters.app || filters.kind || filters.tech);
  const jobById = useMemo(() => new Map(jobs.map(j => [j.id, j])), [jobs]);
  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  // Reveal an entry (from The app, a link inside another entry, or a #record link): clear filters, open it, scroll.
  const reveal = (id: string) => {
    const f = map.byId.get(id) ?? map.byId.get(map.byJob.get(id) ?? "");
    if (!f) return;
    setFilters({ statuses: [...new Set([...defaultFilters.statuses, f.status])] });
    setOpen(o => new Set(o).add(f.id));
    if (map.byJob.has(id)) setOpenJob({ id, n: Date.now() });
    setTimeout(() => document.getElementById(map.byJob.has(id) ? id : `item-${f.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  useEffect(() => { if (focus) reveal(focus.id); }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const id = decodeURIComponent(location.hash.slice(1)); if (id) reveal(id); }, [map.features.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const doneHidden = !filters.statuses.includes("done");

  return <section aria-labelledby="product-heading" className="space-y-3">
    <h2 id="product-heading" className={label}>Product</h2>
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={filters.q ?? ""} onChange={e => set({ q: e.target.value })} placeholder="Search" aria-label="Search features, pages and technologies"
          className="min-w-44 flex-1 rounded-full border bg-background px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <select aria-label="App" className={select} value={filters.app ?? ""} onChange={e => set({ app: (e.target.value || undefined) as Filters["app"] })}>
          <option value="">Both apps</option><option value="estio">Estio</option><option value="substo">Substo</option></select>
        <select aria-label="Kind" className={select} value={filters.kind ?? ""} onChange={e => set({ kind: (e.target.value || undefined) as Kind | undefined })}>
          <option value="">Any kind</option>{(Object.keys(kindPlural) as Kind[]).map(k => <option key={k} value={k}>{kindPlural[k]}</option>)}</select>
        <select aria-label="Technology" className={select} value={filters.tech ?? ""} onChange={e => set({ tech: e.target.value || undefined })}>
          <option value="">Any technology</option>{map.technologies.map(t => <option key={t}>{t}</option>)}</select>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="group" aria-label="Status" className="flex flex-wrap gap-1.5">{statuses.map(s => { const on = filters.statuses.includes(s);
          return <button key={s} aria-pressed={on} className={pill(on)} onClick={() => set({ statuses: on ? filters.statuses.filter(x => x !== s) : [...filters.statuses, s] })}>
            <Dot status={s} />{statusWords[s]}<span className="tabular-nums text-muted-foreground">{counts[s]}</span></button>; })}</div>
        <span aria-hidden className="hidden h-5 w-px bg-border sm:block" />
        <div role="group" aria-label="Area" className="flex flex-wrap gap-1.5">
          {[undefined, ...areas].map(a => <button key={a ?? "all"} aria-pressed={filters.area === a} className={pill(filters.area === a)} onClick={() => set({ area: a })}>{a ?? "All areas"}</button>)}
        </div>
        {filtered && <button className="px-1 text-sm text-muted-foreground underline underline-offset-2" onClick={() => setFilters({ statuses: filters.statuses })}>Clear</button>}
      </div>
    </div>

    {!map.features.length ? <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Nothing here yet. The Mac maps the code when it connects; new ideas start in Talk.</p>
      : !shown.length ? <div className="space-y-2 rounded-xl border p-6 text-center text-sm">
        <p>Nothing matches{filtered ? " these filters" : ""}.</p>
        <div className="flex flex-wrap justify-center gap-2">
          {filtered && <button className={btn} onClick={() => setFilters({ statuses: filters.statuses })}>Clear filters</button>}
          {doneHidden && counts.done > 0 && <button className={btn} onClick={() => set({ statuses: [...filters.statuses, "done"] })}>Show done · {counts.done}</button>}
          {!filtered && !filters.statuses.length && <button className={btn} onClick={() => setFilters(defaultFilters)}>Show what&apos;s open</button>}
        </div></div>
      : <ul className="divide-y overflow-hidden rounded-xl border">{shown.map(f => <li key={f.id} id={`item-${f.id}`} className="scroll-mt-24">
        <button onClick={() => toggle(f.id)} aria-expanded={open.has(f.id)} aria-controls={`detail-${f.id}`}
          className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none">
          <Dot status={f.status} className="mt-[7px]" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium">{f.name}</span>
              <span className="text-xs text-muted-foreground">{kindWords[f.kind]}{f.kind !== "technology" ? ` · ${f.areas.join(", ")}` : ""}</span></span>
            {f.summary && !open.has(f.id) && <span className="mt-0.5 block truncate text-sm text-muted-foreground">{f.summary}</span>}
          </span>
          <span className={`mt-0.5 hidden shrink-0 text-xs font-medium sm:block ${statusText[f.status]}`}>{statusWords[f.status]}</span>
          <span className="sr-only sm:hidden">{statusWords[f.status]}</span>
          <Chevron open={open.has(f.id)} />
        </button>
        {open.has(f.id) && <div id={`detail-${f.id}`}><Detail f={f} map={map} jobById={jobById} nodeById={nodeById} release={release} profiles={profiles} busy={busy} send={send} ask={ask} talkOf={talkOf} openTalk={openTalk} openJob={openJob}
          reveal={reveal} byTech={t => { setFilters({ ...defaultFilters, tech: t }); document.getElementById("product-heading")?.scrollIntoView({ behavior: "smooth" }); }} /></div>}
      </li>)}</ul>}
    {!!shown.length && doneHidden && counts.done > 0 && <button className="text-sm text-muted-foreground underline underline-offset-2" onClick={() => set({ statuses: [...filters.statuses, "done"] })}>Show done · {counts.done}</button>}
  </section>;
}

function Group({ title, count, children, open }: { title: string; count?: number; children: ReactNode; open?: boolean }) {
  return <details open={open} className="group">
    <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
      <svg aria-hidden viewBox="0 0 20 20" className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90"><path d="M7.5 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {title}{count !== undefined && <span className="font-normal text-muted-foreground">{count}</span>}</summary>
    <div className="mt-1.5 pl-5">{children}</div>
  </details>;
}
function Links({ items, reveal }: { items: Feature[]; reveal: (id: string) => void }) {
  return <ul className="space-y-0.5">{items.map(x => <li key={x.id}><button onClick={() => reveal(x.id)} className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted/60">
    <Dot status={x.status} className="mt-1.5" /><span className="min-w-0"><span>{x.name}</span>{x.summary && <span className="block truncate text-xs text-muted-foreground">{x.summary}</span>}</span></button></li>)}</ul>;
}

/** An opened entry: its story, then its work, pages, processes, related features and technologies; files last. */
function Detail({ f, map, jobById, nodeById, release, profiles, busy, send, ask, reveal, byTech, talkOf, openTalk, openJob }: { f: Feature; map: ProductMap; jobById: Map<string, Job>; nodeById: Map<string, MapNode>; release: Release | null; profiles: Profile[]; busy: boolean; send: Send; ask: (text: string) => void; reveal: (id: string) => void; byTech: (t: string) => void } & TalkLink & { openJob?: { id: string; n: number } | null }) {
  const node = f.nodeId ? nodeById.get(f.nodeId) : undefined;
  const work = f.jobIds.map(id => jobById.get(id)).filter((j): j is Job => !!j);
  const pages = f.pageIds.map(id => nodeById.get(id)).filter((n): n is MapNode => !!n);
  const get = (ids: string[]) => ids.map(id => map.byId.get(id)).filter((x): x is Feature => !!x);
  const usedBy = f.kind === "process" ? map.features.filter(x => x.processIds.includes(f.id)) : f.kind === "technology" ? map.features.filter(x => x.kind !== "technology" && x.kind !== "process" && x.tech.includes(f.name)) : [];
  const described = node && node.spec.kind === "feature" ? clean(node.spec.purpose) : node && node.spec.purpose !== undescribed ? node.spec.purpose : null;
  return <div className="space-y-4 pb-5 pl-[2.6rem] pr-5">
    {f.story ? <StoryView story={f.story} /> : <p className="text-sm leading-relaxed">{described ?? (f.kind === "page" ? "This page isn't described yet. The daily review describes pages one at a time." : f.summary)}</p>}
    {f.tech.length > 0 && f.kind !== "technology" && <div className="flex flex-wrap items-center gap-1.5 text-sm"><span className="text-xs text-muted-foreground">Uses</span>
      {f.tech.map(t => <button key={t} onClick={() => byTech(t)} className="rounded-full bg-muted px-2.5 py-0.5 text-xs hover:bg-muted/70" title={`Show everything that uses ${t}`}>{t}</button>)}</div>}
    <div className="space-y-2.5">
      {work.length > 0 && <Group title="Work" count={work.length} open={work.length <= 4 || work.some(j => j.id === openJob?.id)}>
        <ul className="-ml-2 space-y-0.5">{work.map(j => <WorkItem key={j.id} job={j} sameStory={!!f.story && (j.checkpoint as { story?: { updatedAt?: string } } | null)?.story?.updatedAt === f.story.updatedAt} profiles={profiles} release={release} busy={busy} send={send} talk={talkOf(j)} openTalk={openTalk} opened={openJob?.id === j.id ? openJob.n : undefined} />)}</ul></Group>}
      {f.relatedIds.length > 0 && <Group title={f.kind === "feature" && f.nodeId ? "Other features on these pages" : "Features here"} count={f.relatedIds.length}><Links items={get(f.relatedIds)} reveal={reveal} /></Group>}
      {usedBy.length > 0 && <Group title="Used by" count={usedBy.length}><Links items={usedBy} reveal={reveal} /></Group>}
      {pages.length > 0 && f.kind !== "page" && <Group title="Pages" count={pages.length}><ul className="space-y-1 text-sm">{pages.map(p => <li key={p.id}>{p.spec.section} › {p.spec.name}<span className="ml-2 font-mono text-xs text-muted-foreground">{p.spec.route}</span></li>)}</ul></Group>}
      {f.processIds.length > 0 && <Group title="Background processes" count={f.processIds.length}><Links items={get(f.processIds)} reveal={reveal} /></Group>}
      {(f.files.length > 0 || node) && <Group title="Files and record" count={f.files.length || undefined}>
        <div className="space-y-2 text-xs text-muted-foreground">
          {f.kind === "page" && node?.spec.route && <p>Address: <span className="font-mono">{node.spec.route}</span></p>}
          {node?.spec.kind === "feature" && node.spec.observed && <p className="whitespace-pre-line">{node.spec.observed}</p>}
          <ul className="space-y-0.5 break-all font-mono">{f.files.slice(0, 40).map(p => <li key={p}>{p}</li>)}</ul>
          {f.files.length > 40 && <p>and {f.files.length - 40} more</p>}
          <p>Record {f.id}</p>
        </div></Group>}
    </div>
    <button className={btn} onClick={() => ask(`About "${f.name}" (${kindWords[f.kind].toLowerCase()}): `)}>Ask or change something</button>
  </div>;
}

const sections = ["CRM", "Studio", "Public website", "Platform admin", "Account & onboarding"];
/** The app as users see it: section › page › features. Names only; addresses and details when a page is opened. */
export function AppMap({ map, nodes, edges, busy, send, ask, reveal }: { map: ProductMap; nodes: MapNode[]; edges: Edge[]; busy: boolean; send: Send; ask: (text: string) => void; reveal: (id: string) => void }) {
  const [section, setSection] = useState<string | null>(null), [page, setPage] = useState<string | null>(null);
  const pages = useMemo(() => nodes.filter(n => n.spec.kind === "page").sort((a, b) => a.spec.name.localeCompare(b.spec.name)), [nodes]);
  // Work on a page: entries whose work reaches into the page itself (not just a shared folder above it).
  const workOn = useMemo(() => { const m = new Map<string, Feature[]>(); for (const f of map.features) for (const p of f.workPageIds) m.set(p, [...(m.get(p) ?? []), f]); return m; }, [map]);
  return <section aria-labelledby="app-heading" className="space-y-3">
    <h2 id="app-heading" className={label}>The app</h2>
    <ul className="divide-y overflow-hidden rounded-xl border">{sections.map(s => { const list = pages.filter(p => p.spec.section === s), isOpen = section === s;
      const doing = list.filter(p => workOn.get(p.id)?.some(f => f.status === "doing")).length;
      return <li key={s}>
        <button onClick={() => { setSection(isOpen ? null : s); setPage(null); }} aria-expanded={isOpen} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none">
          <span className="flex-1 font-medium">{s}</span>
          <span className="text-xs text-muted-foreground">{plural(list.length, "page")}{doing ? ` · ${doing} in work` : ""}</span><Chevron open={isOpen} />
        </button>
        {isOpen && <ul className="border-t bg-muted/20 py-1">{list.map(p => { const features = map.featuresOfPage.get(p.id) ?? [], here = workOn.get(p.id) ?? [], pOpen = page === p.id;
          const status = here.some(f => f.status === "doing") ? "doing" : null;
          return <li key={p.id}>
            <button onClick={() => setPage(pOpen ? null : p.id)} aria-expanded={pOpen} className="flex w-full items-center gap-3 py-2.5 pl-8 pr-4 text-left text-sm hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none">
              <span className="flex-1">{p.spec.name}</span>
              {features.length > 0 && <span className="text-xs text-muted-foreground">{plural(features.length, "feature")}</span>}
              {status && <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400"><Dot status="doing" />in work</span>}
              {!!p.spec.draft && <span className="text-xs text-primary">description to confirm</span>}
              <Chevron open={pOpen} />
            </button>
            {pOpen && <PageDetail page={p} features={features.map(id => map.byId.get(id)!).filter(Boolean)} work={here} nodes={nodes} edges={edges} ask={ask} reveal={reveal} />}
          </li>; })}
          {!list.length && <li className="py-2.5 pl-8 pr-4 text-sm text-muted-foreground">No pages in this section yet.</li>}
        </ul>}
      </li>; })}</ul>
    <Watching nodes={nodes} edges={edges} busy={busy} send={send} />
  </section>;
}
function PageDetail({ page, features, work, nodes, edges, ask, reveal }: { page: MapNode; features: Feature[]; work: Feature[]; nodes: MapNode[]; edges: Edge[]; ask: (text: string) => void; reveal: (id: string) => void }) {
  const linked = (kind: string, from: boolean) => edges.filter(e => e.kind === kind && (from ? e.fromId === page.id : e.toId === page.id)).map(e => nodes.find(n => n.id === (from ? e.toId : e.fromId))).filter((n): n is MapNode => !!n);
  const rules = linked("governed-by", true), refs = linked("inspires", false);
  const described = page.spec.purpose !== undescribed;
  return <div className="space-y-3 pb-4 pl-8 pr-5 pt-1 text-sm">
    <p className={described ? "leading-relaxed" : "text-muted-foreground"}>{described ? page.spec.purpose : "Not described yet. The daily review describes pages one at a time, or ask about it below."}</p>
    {described && page.spec.journey && !/^Not /.test(page.spec.journey) && <p className="text-muted-foreground">{page.spec.journey}</p>}
    {features.length > 0 && <div><p className="mb-1 text-xs font-semibold text-muted-foreground">Features</p><Links items={features} reveal={reveal} /></div>}
    {work.length > 0 && <div><p className="mb-1 text-xs font-semibold text-muted-foreground">Work touching this page</p><Links items={work.filter(w => !features.includes(w))} reveal={reveal} /></div>}
    {rules.length > 0 && <p className="text-xs text-muted-foreground">Rules: {rules.map(r => r.spec.name).join(", ")}</p>}
    {refs.length > 0 && <p className="text-xs text-muted-foreground">Watching for ideas: {refs.map(r => r.spec.name).join(", ")}</p>}
    <p className="text-xs text-muted-foreground">Address: <span className="font-mono">{page.spec.route}</span></p>
    <button className={btn} onClick={() => ask(`About the ${page.spec.section} page "${page.spec.name}" (${page.spec.route}): `)}>Ask or change something here</button>
  </div>;
}

/** Links worth learning from, each with why it's here and the pages it could improve. */
function Watching({ nodes, edges, busy, send }: { nodes: MapNode[]; edges: Edge[]; busy: boolean; send: Send }) {
  const [adding, setAdding] = useState(false);
  const refs = nodes.filter(n => n.spec.kind === "reference" && n.spec.watch?.status !== "rejected");
  const linked = (id: string) => edges.filter(e => e.fromId === id && e.kind === "inspires").map(e => nodes.find(n => n.id === e.toId)?.spec.name).filter(Boolean);
  const suggestions = suggestedReferences.filter(r => !nodes.some(n => n.spec.watch?.url === r.url));
  return <details className="group rounded-xl border px-4 py-3">
    <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
      <svg aria-hidden viewBox="0 0 20 20" className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90"><path d="M7.5 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      Watching for ideas <span className="font-normal text-muted-foreground">{refs.length}</span></summary>
    <p className="mt-2 text-xs text-muted-foreground">Repos, apps and videos to learn from. GitHub repos are checked daily without using AI; when one changes, the daily review looks at its linked page with that in mind.</p>
    <div className="mt-2 space-y-1.5">{refs.map(n => { const updated = !!n.spec.watch?.latest && n.spec.watch.latest !== n.spec.watch.seen, screens = linked(n.id);
      return <div key={n.id} className="flex flex-wrap items-start gap-2 rounded-md border p-2 text-sm"><div className="min-w-0 flex-1">
        <a href={n.spec.watch?.url} target="_blank" rel="noreferrer" className="font-medium underline">{n.spec.name}</a>{updated && <span className="ml-1 text-xs text-amber-600">· updated</span>}
        <p className="text-xs">Why: {n.spec.intent}</p><p className="text-xs text-muted-foreground">{screens.length ? `For: ${screens.join(", ")}` : "Not linked to a page yet; ask in Talk which page it fits"}</p></div>
        <select aria-label="Status" className={`${field} !p-1 text-xs`} value={n.spec.watch?.status} disabled={busy} onChange={e => send({ action: "watch-update", id: n.id, status: e.target.value })}><option value="watching">Watching</option><option value="adopted">Adopted</option><option value="rejected">Not for us</option></select></div>; })}</div>
    {adding ? <form className="mt-2 flex flex-wrap gap-2" onSubmit={async e => { e.preventDefault(); const f = new FormData(e.currentTarget); if (await send({ action: "watch", url: String(f.get("url")).trim(), note: String(f.get("note") ?? "").trim() || undefined, screenIds: [] })) setAdding(false); }}>
      <input name="url" type="url" required placeholder="Link" className={`${field} min-w-52 flex-1`} /><input name="note" placeholder="What could we take from it?" className={`${field} min-w-52 flex-[2]`} maxLength={1000} /><button className={solid} disabled={busy}>Add</button></form>
      : <button className={`${btn} mt-2`} onClick={() => setAdding(true)}>+ Watch a link</button>}
    {suggestions.length > 0 && <div className="mt-2 space-y-1"><p className="text-xs text-muted-foreground">Mentioned before, not added:</p>{suggestions.map(r => <div key={r.url} className="flex items-start gap-2 text-xs"><button className={btn} disabled={busy} onClick={() => send({ action: "watch", url: r.url, note: r.note, screenIds: [] })}>Add</button><span><span className="break-all">{r.url}</span><br /><span className="text-muted-foreground">{r.note}</span></span></div>)}</div>}
  </details>;
}
