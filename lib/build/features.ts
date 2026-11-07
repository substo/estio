import { experienceFor, label } from "./experience";
import { storyFrom, type Story } from "./story";

/**
 * The product list: one entry per thing the product is (a feature, a page with work, a background process or a
 * technology), each with a status derived from the work attached to it. Derived on every load from BuildNode,
 * BuildEdge and BuildJob with no model call and no stored mapping; client-safe.
 *
 * Every work record belongs to exactly one entry, picked in this order:
 *   1. a feature record it names in nodeIds;
 *   2. an entry whose name equals its story area (a feature record, background process or technology);
 *   3. its story area, which becomes a feature of its own (several records can share one area);
 *   4. the page it names (or the page that imports a file it names);
 *   5. otherwise itself, under its title.
 * Status: Doing when any attached work is approved, running, in review, failed, stuck or merging; Done when there is
 * finished work and nothing open; Ideas when there are only suggestions, or no work on a concept that isn't built yet.
 * Background processes, technologies and owner-confirmed screen features with no work are Done: they exist.
 */
export type Kind = "feature" | "page" | "process" | "technology";
export type Status = "idea" | "doing" | "done";
export type Area = "CRM" | "Studio" | "Website" | "Platform";
export type App = "estio" | "substo" | "both";
export const kinds: Kind[] = ["feature", "page", "process", "technology"];
export const statuses: Status[] = ["doing", "idea", "done"];
export const areas: Area[] = ["CRM", "Studio", "Website", "Platform"];
export const kindWords: Record<Kind, string> = { feature: "Feature", page: "Page", process: "Background process", technology: "Technology" };
export const statusWords: Record<Status, string> = { idea: "Ideas", doing: "Doing now", done: "Done" };

type NodeLike = { id: string; spec: { kind: string; name: string; purpose: string; product?: string; section?: string; route?: string; sourceRefs?: string[]; coverage?: string; intent?: string; journey?: string; observed?: string } };
type EdgeLike = { fromId: string; toId: string; kind: string };
type JobLike = { id: string; state: string; updatedAt: string; spec: { title: string; outcome: string; scope: string[]; nodeIds: string[] }; checkpoint: unknown };

export type Feature = {
  id: string; kind: Kind; name: string; summary: string; status: Status;
  areas: Area[]; app: App; tech: string[];
  /** Attached work, newest first. */
  jobIds: string[]; story?: Story; nodeId?: string;
  /** All pages it is linked to; workPageIds: the pages its work reaches into (a page's own folder or file, or named). */
  pageIds: string[]; workPageIds: string[]; processIds: string[]; relatedIds: string[]; files: string[];
  updatedAt?: string; text: string;
};
export type ProductMap = { features: Feature[]; byId: Map<string, Feature>; byJob: Map<string, string>; featuresOfPage: Map<string, string[]>; technologies: string[] };

/**
 * Technologies, recognised from file paths only. A file belongs to a technology when its path matches; pages and
 * processes use it when their files reach such a file within two imports.
 */
export const technologies: { name: string; match: RegExp; about: string }[] = [
  { name: "AI", match: /(^|\/)ai(\/|-|\.)|openai|gemini|anthropic|llm/i, about: "AI models used for writing, research, summaries and automations." },
  { name: "WhatsApp", match: /whatsapp/i, about: "Messaging with contacts over WhatsApp, through the Business API and the WhatsApp Web bridge." },
  { name: "Google", match: /google|gmail|youtube/i, about: "Google sign-in, Gmail, Calendar and YouTube connections." },
  { name: "Microsoft", match: /microsoft|outlook|(^|\/)owa-/i, about: "Outlook mail and calendar connections." },
  { name: "Puppeteer", match: /puppeteer/i, about: "A controlled browser for sites without an API: the old CRM, Outlook web and printing." },
  { name: "Web scraping", match: /scrap|crawl/i, about: "Reading listings and pages from other websites." },
  { name: "Old CRM", match: /lib\/crm\/|old-crm|legacy-crm/i, about: "Importing and syncing properties, leads and contacts from the previous CRM." },
  { name: "GoHighLevel", match: /(^|\/|-)ghl/i, about: "The GoHighLevel connection: contacts, calendars and messages." },
  { name: "SMS", match: /(^|\/|-)sms|twilio/i, about: "Text messages, through Twilio or a paired phone." },
  { name: "Mac companion", match: /device-tunnel|device-relay|companion/i, about: "The paired Mac that runs work on the business's own subscriptions." },
  { name: "Clerk", match: /clerk/i, about: "Sign-in and accounts." },
  { name: "Cloudflare", match: /cloudflare/i, about: "Image hosting and delivery." },
];
export const techOf = (path: string) => technologies.filter(t => t.match.test(path)).map(t => t.name);

/** Where a file sits in the product, or null when it is shared code that says nothing on its own. */
export function placeOf(path: string): { area: Area; app: App } | null {
  if (/\(substo-site\)|substo-site|(^|\/)sites\//.test(path)) return { area: "Website", app: "substo" };
  if (/\(public-site\)|\[domain\]|(^|\/)widget\/|public-site|(^|\/)website\//.test(path)) return { area: "Website", app: "estio" };
  if (/studio/.test(path)) return { area: "Studio", app: "substo" };
  if (/admin\/platform|(^|\/)build(\/|-)|onboarding|business-profile|(^|\/)auth\/|(^|\/)platform\//.test(path)) return { area: "Platform", app: "both" };
  if (/^app\/\(main\)\/admin\/|^app\/api\/(?!cron\/)|^lib\/(crm|contacts|companies|deals|conversations|leads|properties|viewings|whatsapp|ghl|tasks|sms|twilio|google|microsoft|feed|scraping|queue|property-match)/.test(path)) return { area: "CRM", app: "estio" };
  return null;
}
const processWords: Record<string, string> = { ai: "AI", sms: "SMS", crm: "CRM", ghl: "GoHighLevel", whatsapp: "WhatsApp", gmail: "Gmail", outlook: "Outlook" };
const sectionArea: Record<string, Area> = { CRM: "CRM", Studio: "Studio", "Public website": "Website", "Platform admin": "Platform", "Account & onboarding": "Platform" };

/** Status of one work record, or null for dropped work. */
export function workStatus(job: Pick<JobLike, "state" | "checkpoint">): Status | null {
  const merge = (job.checkpoint as { merge?: { state?: string } } | null)?.merge?.state;
  if (job.state === "revoked") return null;
  if (job.state === "proposed") return "idea";
  if (["queued", "merging", "resolving"].includes(merge ?? "")) return "doing";
  if (job.state === "done" || job.state === "external-done") return "done";
  return "doing";
}
export function statusOf(list: (Status | null)[], fallback: Status): Status {
  if (list.includes("doing")) return "doing";
  if (list.includes("done")) return "done";
  if (list.includes("idea")) return "idea";
  return fallback;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const slug = (s: string) => norm(s).replace(/ /g, "-");
/** One plain line: the first sentence, without bookkeeping prefixes such as "Idea:" or "Owner clarified scope …:". */
export function firstLine(text: string) {
  let t = text.replace(/\s+/g, " ").trim();
  const prefix = /^([^:.]{0,90}):\s+/.exec(t);
  if (prefix && /\b(idea|owner|retain|note|scope|correction)\b/i.test(prefix[1])) t = t.slice(prefix[0].length);
  // Shouted words read as plain words ("PLATFORM BUILD" → "Platform Build"); short acronyms stay.
  t = t.replace(/\b[A-Z]{5,}\b/g, w => w[0] + w.slice(1).toLowerCase()).replace(/^[a-z]/, c => c.toUpperCase());
  const end = t.search(/[.;](\s|$)/);
  const sentence = end > 0 ? `${t.slice(0, end)}.` : t;
  return sentence.length > 160 ? `${sentence.slice(0, 159).trimEnd()}…` : sentence;
}
const pageDir = (p: NodeLike) => (p.spec.sourceRefs?.[0] ?? "").replace(/page\.tsx$/, "");
const inScope = (path: string, scope: string[]) => scope.some(s => s.endsWith("/") ? path.startsWith(s) : path === s);

export function productMap({ nodes, edges, jobs }: { nodes: NodeLike[]; edges: EdgeLike[]; jobs: JobLike[] }): ProductMap {
  const pathOf = new Map<string, string>(), nodeById = new Map(nodes.map(n => [n.id, n]));
  for (const n of nodes) if ((n.spec.kind === "resource" || n.spec.kind === "page") && n.spec.sourceRefs?.[0]) pathOf.set(n.id, n.spec.sourceRefs[0]);
  const imports = new Map<string, string[]>(), importers = new Map<string, string[]>();
  for (const e of edges) if (e.kind === "uses") { imports.set(e.fromId, [...(imports.get(e.fromId) ?? []), e.toId]); importers.set(e.toId, [...(importers.get(e.toId) ?? []), e.fromId]); }
  // Hubs (files imported almost everywhere, like the database client) say nothing about what a file is part of.
  const hub = (id: string) => (importers.get(id)?.length ?? 0) > 15;
  /** A file and what it imports, up to two steps. */
  const reach = (id: string) => { const one = imports.get(id) ?? []; return [id, ...one, ...one.flatMap(x => imports.get(x) ?? [])]; };
  const paths = (ids: Iterable<string>) => [...new Set([...ids].map(id => pathOf.get(id)).filter((p): p is string => !!p))];
  const pages = nodes.filter(n => n.spec.kind === "page").sort((a, b) => pageName(a).localeCompare(pageName(b)));
  const pageReach = new Map(pages.map(p => [p.id, paths(reach(p.id))]));

  const features: Feature[] = [], index = new Map<string, Feature>();
  // Seeds: the status with no work, and a place fixed by the record itself (feature records naming their product).
  const seed = new Map<string, { fallback: Status; fixed: boolean; roots: string[] }>();
  type Draft = Pick<Feature, "id" | "kind" | "name" | "summary" | "pageIds" | "files"> & Partial<Pick<Feature, "nodeId" | "areas" | "app">> & { fallback: Status; roots?: string[] };
  const draft = ({ fallback, roots, ...f }: Draft) => {
    const item: Feature = { areas: [], app: "both", ...f, status: fallback, tech: [], jobIds: [], workPageIds: [], processIds: [], relatedIds: [], text: "" };
    seed.set(item.id, { fallback, fixed: !!f.areas, roots: roots ?? [] });
    features.push(item); index.set(item.id, item);
    return item;
  };

  // Feature records: concepts are ideas until work starts; features confirmed from a screen describe what exists.
  for (const n of nodes.filter(n => n.spec.kind === "feature")) {
    const exists = n.id.startsWith("feature-") || n.spec.coverage === "confirmed";
    const linked = edges.filter(e => e.fromId === n.id && ["reads", "writes", "uses"].includes(e.kind)).map(e => e.toId);
    draft({ id: n.id, nodeId: n.id, kind: "feature", name: n.spec.name, summary: firstLine(n.spec.purpose), fallback: exists ? "done" : "idea",
      pageIds: edges.filter(e => e.toId === n.id && e.kind === "contains" && nodeById.get(e.fromId)?.spec.kind === "page").map(e => e.fromId),
      files: [...new Set([...(n.spec.sourceRefs ?? []), ...paths(linked)])],
      ...(n.spec.product === "studio" ? { areas: ["Studio"] as Area[], app: "substo" as App } : {}) });
  }
  // Background processes: scheduled routes and queue workers, one entry per name.
  const processFiles = new Map<string, { ids: string[]; cron: boolean; queue: boolean }>();
  for (const [id, p] of pathOf) {
    const m = /^app\/api\/cron\/([^/]+)\/route\.ts$/.exec(p) ?? /^lib\/queue\/([^/.]+)\.ts$/.exec(p);
    if (!m || /^job-id$/.test(m[1])) continue;
    const words = label(m[1]).toLowerCase();
    const name = (words[0].toUpperCase() + words.slice(1)).replace(/\b(ai|sms|crm|ghl|whatsapp|gmail|outlook)\b/gi, w => processWords[w.toLowerCase()]);
    const entry = processFiles.get(name) ?? { ids: [], cron: false, queue: false };
    entry.ids.push(id); if (p.startsWith("app/")) entry.cron = true; else entry.queue = true;
    processFiles.set(name, entry);
  }
  for (const [name, e] of [...processFiles].sort((a, b) => a[0].localeCompare(b[0]))) {
    const place = paths(e.ids).map(placeOf).find(Boolean) ?? { area: "CRM" as Area, app: "estio" as App };
    draft({ id: `process:${slug(name)}`, kind: "process", name, summary: e.cron && e.queue ? "Runs on a schedule and through the background queue." : e.cron ? "Runs on a schedule." : "Runs in the background queue.",
      fallback: "done", pageIds: [], files: paths(e.ids.flatMap(reach)), roots: paths(e.ids.flatMap(id => [id, ...(imports.get(id) ?? []).filter(x => !hub(x))])), areas: [place.area], app: place.app });
  }
  // Technologies.
  for (const t of technologies) {
    const files = [...pathOf.values()].filter(p => t.match.test(p));
    if (!files.length) continue;
    draft({ id: `tech:${slug(t.name)}`, kind: "technology", name: t.name, summary: t.about, fallback: "done", files,
      pageIds: pages.filter(p => pageReach.get(p.id)!.some(x => t.match.test(x))).map(p => p.id) });
  }

  // Work: each record attaches to exactly one entry.
  const byJob = new Map<string, string>(), storyRank = new Map<string, string>(), named = new Map<string, Feature>();
  for (const f of features) if (!named.has(norm(f.name))) named.set(norm(f.name), f);
  const pageOfJob = (j: JobLike) => {
    const ids = new Set(j.spec.nodeIds.flatMap(id => [id, ...(importers.get(id) ?? [])]));
    return pages.find(p => ids.has(p.id));
  };
  const scopeFiles = (j: JobLike) => [...new Set([...j.spec.scope.filter(s => !s.endsWith("/")), ...[...pathOf.values()].filter(p => inScope(p, j.spec.scope)), ...paths(j.spec.nodeIds)])];
  const sorted = [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const j of sorted) {
    if (workStatus(j) === null) continue;
    const story = storyFrom(j.checkpoint), area = story?.area?.trim();
    let target = j.spec.nodeIds.map(id => index.get(id)).find(f => f?.kind === "feature" && f.nodeId)
      ?? (area ? named.get(norm(area)) : undefined);
    if (!target && area) {
      target = draft({ id: `area:${slug(area)}`, kind: "feature", name: area, summary: "", fallback: "idea", pageIds: [], files: [] });
      named.set(norm(area), target);
    }
    if (!target) {
      const page = pageOfJob(j);
      if (page) target = index.get(`page:${page.id}`) ?? draft({ id: `page:${page.id}`, nodeId: page.id, kind: "page", name: pageName(page), summary: "", fallback: "idea", pageIds: [page.id], files: paths(reach(page.id)) });
    }
    target ??= draft({ id: `job:${j.id}`, kind: "feature", name: j.spec.title, summary: firstLine(j.spec.outcome), fallback: "idea", pageIds: [], files: [] });
    target.jobIds.push(j.id);
    byJob.set(j.id, target.id);
    target.updatedAt ??= j.updatedAt;
    // The item's story is told by the record covering the most of it (whole folders in scope, e.g. the overall
    // "Business data consolidation" rather than one of its steps), then the most recently written.
    const rank = story && `${String(j.spec.scope.filter(x => x.endsWith("/")).length).padStart(3, "0")}${story.updatedAt}`;
    if (story && rank && (!target.story || rank > storyRank.get(target.id)!)) { target.story = story; storyRank.set(target.id, rank); }
    // Work brings its pages and files along.
    const files = scopeFiles(j);
    target.files = [...new Set([...target.files, ...files])];
    // Work reaches a page when its scope is the page's own folder, or a file in it (or in a private "_" folder under it).
    const namedPage = pageOfJob(j);
    const own = (s: string) => s.endsWith("/") ? s : s.replace(/[^/]+$/, "").replace(/(?:_[^/]+\/)+$/, "");
    const reached = pages.filter(p => j.spec.scope.some(s => pageDir(p) === own(s))).map(p => p.id);
    target.workPageIds = [...new Set([...target.workPageIds, ...reached, ...(namedPage ? [namedPage.id] : [])])];
    if (target.kind !== "page") target.pageIds = [...new Set([...target.pageIds, ...pages.filter(p => inScope(p.spec.sourceRefs?.[0] ?? "", j.spec.scope)).map(p => p.id), ...(namedPage ? [namedPage.id] : [])])];
  }

  // Derived fields: status, summary, places, technologies, processes and related features.
  const jobById = new Map(jobs.map(j => [j.id, j]));
  const processes = features.filter(f => f.kind === "process");
  for (const f of features) {
    const { fallback, fixed } = seed.get(f.id)!, work = f.jobIds.map(id => jobById.get(id)!);
    f.status = statusOf(work.map(workStatus), fallback);
    if (f.story) f.summary = firstLine(f.story.concept);
    else if (!f.summary) {
      const page = f.kind === "page" ? nodeById.get(f.nodeId!) : undefined;
      f.summary = page && !/^Source inventory/.test(page.spec.purpose) ? firstLine(page.spec.purpose) : work[0] ? firstLine(work[0].spec.outcome) : "";
    }
    // Place: the sections of its pages and the areas of its files; the leading areas win.
    const pagePlace = (p: NodeLike | undefined) => p && (placeOf(p.spec.sourceRefs?.[0] ?? "") ?? (p.spec.section ? { area: sectionArea[p.spec.section] ?? "Platform", app: (p.spec.section === "Studio" ? "substo" : p.spec.section === "CRM" ? "estio" : "both") as App } : undefined));
    const placed = [...f.pageIds.map(id => pagePlace(nodeById.get(id))).filter((x): x is { area: Area; app: App } => !!x),
      ...f.files.map(placeOf).filter((x): x is { area: Area; app: App } => !!x)];
    if (f.kind === "technology") { f.areas = areas.filter(a => placed.some(p => p.area === a)); f.app = "both"; }
    else if (!fixed) {
      const count = new Map<Area, number>(); for (const p of placed) count.set(p.area, (count.get(p.area) ?? 0) + 1);
      const top = Math.max(0, ...count.values());
      f.areas = top ? areas.filter(a => (count.get(a) ?? 0) >= top * 0.5) : ["Platform"];
      const apps = new Set(placed.filter(p => f.areas.includes(p.area)).map(p => p.app));
      f.app = !apps.size || apps.has("both") || (apps.has("estio") && apps.has("substo")) ? "both" : [...apps][0];
    }
    const tech = technologies.find(t => t.name === f.name && f.kind === "technology");
    f.tech = tech ? [tech.name] : technologies.filter(t => f.files.some(p => t.match.test(p))).map(t => t.name);
    if (f.kind === "process" && f.tech.length && !f.story) f.summary = `${f.summary} Uses ${f.tech.length > 1 ? `${f.tech.slice(0, -1).join(", ")} and ${f.tech.at(-1)}` : f.tech[0]}.`;
    const fileSet = new Set(f.files);
    if (tech) f.processIds = processes.filter(p => p.files.some(x => tech.match.test(x))).map(p => p.id);
    else if (f.kind !== "process") f.processIds = processes.filter(p => seed.get(p.id)!.roots.some(x => fileSet.has(x))).map(p => p.id);
  }
  const featuresOfPage = new Map<string, string[]>();
  for (const f of features) if (f.kind === "feature" && f.nodeId) for (const p of f.pageIds) featuresOfPage.set(p, [...(featuresOfPage.get(p) ?? []), f.id]);
  for (const f of features) {
    if (f.kind === "feature" || f.kind === "page") f.relatedIds = [...new Set(f.pageIds.flatMap(p => featuresOfPage.get(p) ?? []))].filter(id => id !== f.id);
    const story = f.story;
    f.text = norm([f.name, f.summary, kindWords[f.kind], ...f.tech, ...f.areas, ...(story ? [story.concept, ...story.achieved, ...story.howItWorks, ...story.next] : []),
      ...f.jobIds.map(id => jobById.get(id)!.spec.title), ...(f.kind === "technology" ? [] : f.pageIds.map(id => pageName(nodeById.get(id)!)))].join(" "));
  }
  const order = (f: Feature) => statuses.indexOf(f.status) * 10 + kinds.indexOf(f.kind);
  features.sort((a, b) => order(a) - order(b) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.name.localeCompare(b.name));
  return { features, byId: new Map(features.map(f => [f.id, f])), byJob, featuresOfPage, technologies: technologies.map(t => t.name).filter(n => features.some(f => f.tech.includes(n))) };
}

/** A page's name as the user sees it: section › page. */
export function pageName(n: NodeLike) { return n.spec.section ? `${n.spec.section} › ${n.spec.name}` : n.spec.name; }

export type Filters = { q?: string; area?: Area; app?: "estio" | "substo"; kind?: Kind; tech?: string; statuses: Status[] };
export const defaultFilters: Filters = { statuses: ["doing", "idea"] };
/** Everything but status; status counts are shown on the status buttons. */
export function matches(f: Feature, filters: Omit<Filters, "statuses">) {
  const words = norm(filters.q ?? "").split(" ").filter(Boolean);
  return (!filters.area || f.areas.includes(filters.area)) && (!filters.app || f.app === filters.app || f.app === "both") && (!filters.kind || f.kind === filters.kind)
    && (!filters.tech || f.tech.includes(filters.tech)) && words.every(w => f.text.includes(w));
}
export function applyFilters(features: Feature[], filters: Filters) {
  const base = features.filter(f => matches(f, filters));
  return { shown: base.filter(f => filters.statuses.includes(f.status)), counts: Object.fromEntries(statuses.map(s => [s, base.filter(f => f.status === s).length])) as Record<Status, number> };
}
