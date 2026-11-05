import { businessProfileSchema, type BusinessProfile } from "@/lib/business-profile/schema";
import type { FieldKind, FieldStatus, FieldValue } from "./topics";

/**
 * Plain onboarding values <-> Business profile facts. Pure and client-safe. A research suggestion is a known fact with
 * URL sources and confirmedAt null; the owner confirming it, or typing a value, sets confirmedAt on it and every nested
 * fact. A confirmed fact is never replaced by a suggestion.
 */
export type Source = { kind: "url"; url: string; retrievedAt: string | null } | { kind: "owner"; ownerId: string; suppliedAt: string | null };
type Fact = { status: "known" | "unknown" | "not_applicable"; value?: unknown; reason?: string; sources: Source[]; confirmedAt: string | null };
type Profile = Record<string, unknown>;
const isFact = (v: unknown): v is Fact => !!v && typeof v === "object" && "status" in (v as object) && "sources" in (v as object);
const logoVariants = ["primary", "light", "icon", "favicon", "other"];
const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "area";

/** Reads the fact at a dotted path, stepping into fact wrappers (e.g. realEstate) on the way. */
export function factAt(profile: BusinessProfile | null | undefined, path: string): Fact | undefined {
  let node: unknown = profile;
  const parts = path.split(".");
  for (const [i, part] of parts.entries()) {
    if (isFact(node) && i > 0) node = node.value;
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return isFact(node) ? node : undefined;
}
function setAt(profile: Profile, path: string, fact: Fact | undefined, wrapper: { sources: Source[]; confirmedAt: string | null }) {
  const [head, ...rest] = path.split(".");
  if (!rest.length) { if (fact) profile[head] = fact; else delete profile[head]; return; }
  let container = profile[head] as Record<string, unknown> | undefined;
  // realEstate is a fact around its section: keep (or create) the wrapper and edit inside its value.
  if (head === "realEstate") {
    const outer = (isFact(container) ? container : { status: "known", value: {}, sources: [], confirmedAt: null }) as Fact;
    const section = { ...((outer.value as Record<string, unknown>) ?? {}) };
    if (fact) section[rest.join(".")] = fact; else delete section[rest.join(".")];
    if (!Object.keys(section).length) { delete profile[head]; return; }
    profile[head] = { ...outer, value: section, sources: outer.sources.length ? outer.sources : wrapper.sources, confirmedAt: outer.confirmedAt ?? wrapper.confirmedAt };
    return;
  }
  container = { ...(container ?? {}) };
  if (fact) container[rest.join(".")] = fact; else delete container[rest.join(".")];
  if (Object.keys(container).length) profile[head] = container; else delete profile[head];
}

/** Builds the fact tree for a plain value; every nested fact gets the same sources and confirmation. */
export function toFact(kind: FieldKind, path: string, value: FieldValue, sources: Source[], confirmedAt: string | null): Fact | undefined {
  const mk = (v: unknown): Fact => ({ status: "known", value: v, sources, confirmedAt });
  const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
  const arr = <T>(v: unknown) => (Array.isArray(v) ? v : []) as T[];
  switch (kind) {
    case "text": case "longtext": case "url": case "email": case "timezone": { const s = text(value); return s ? mk(s) : undefined; }
    case "countryCode": case "currencyCode": { const s = text(value).toUpperCase(); return s ? mk(s) : undefined; }
    case "address": { const s = text(value); return s ? mk({ formatted: mk(s) }) : undefined; }
    case "list": {
      const items = arr<string>(value).map(text).filter(Boolean);
      if (!items.length) return undefined;
      // Real-estate choices are open-vocabulary selections; other lists are plain text entries.
      return mk(path.startsWith("realEstate.") ? items.map(code => ({ code: mk(code) })) : items.map(mk));
    }
    case "areas": { const items = arr<string>(value).map(text).filter(Boolean); return items.length ? mk(items.map(label => ({ id: mk(slug(label)), label: mk(label) }))) : undefined; }
    case "phones": { const items = arr<{ label?: string; number: string }>(value).filter(x => text(x?.number)); return items.length ? mk(items.map(x => ({ number: mk(text(x.number)), ...(text(x.label) ? { label: mk(text(x.label)) } : {}) }))) : undefined; }
    case "maps": { const items = arr<{ url: string; title?: string }>(value).filter(x => text(x?.url)); return items.length ? mk(items.map(x => ({ url: mk(text(x.url)), ...(text(x.title) ? { title: mk(text(x.title)) } : {}) }))) : undefined; }
    case "links": { const items = arr<{ platform: string; url: string }>(value).filter(x => text(x?.url)); return items.length ? mk(items.map(x => ({ platform: mk(text(x.platform) || "website"), url: mk(text(x.url)) }))) : undefined; }
    case "logos": { const items = arr<{ variant: string; url: string }>(value).filter(x => text(x?.url)); return items.length ? mk(items.map(x => ({ variant: mk(logoVariants.includes(x.variant) ? x.variant : "other"), url: mk(text(x.url)) }))) : undefined; }
    case "colours": { const items = arr<{ role: string; hex: string }>(value).filter(x => text(x?.hex)); return items.length ? mk(items.map(x => ({ role: mk(text(x.role) || "brand"), hex: mk(text(x.hex)) }))) : undefined; }
    case "competitors": { const items = arr<{ name: string; website?: string; notes?: string }>(value).filter(x => text(x?.name)); return items.length ? mk(items.map(x => ({ name: mk(text(x.name)), ...(text(x.website) ? { website: mk(text(x.website)) } : {}), ...(text(x.notes) ? { notes: mk(text(x.notes)) } : {}) }))) : undefined; }
    case "hours": {
      const items = arr<{ day: string; closed: boolean; opens?: string; closes?: string }>(value).filter(x => days.includes(x?.day));
      if (!items.length) return undefined;
      return mk(items.map(x => {
        const open = !x.closed && text(x.opens) && text(x.closes);
        const interval = open ? [{ opens: mk(text(x.opens)), closes: mk(text(x.closes)), ...(text(x.closes) <= text(x.opens) ? { closesNextDay: mk(true) } : {}) }] : [];
        return { day: mk(x.day), closed: mk(!open), intervals: mk(interval) };
      }));
    }
  }
}

/** The plain value of a fact (known facts only), for display and editing. */
export function fromFact(kind: FieldKind, fact: Fact | undefined): FieldValue | null {
  if (!fact || fact.status !== "known") return null;
  const v = (f: unknown) => (isFact(f) && f.status === "known" ? f.value : undefined);
  const list = (fact.value as unknown[]) ?? [];
  switch (kind) {
    case "text": case "longtext": case "url": case "email": case "countryCode": case "currencyCode": case "timezone": return String(fact.value ?? "");
    case "address": return String(v((fact.value as Record<string, unknown>)?.formatted) ?? "");
    case "list": return list.map(e => String(isFact(e) ? e.value : v((e as Record<string, unknown>)?.code) ?? "")).filter(Boolean);
    case "areas": return list.map(e => String(v((e as Record<string, unknown>).label) ?? "")).filter(Boolean);
    case "phones": return list.map(e => { const o = e as Record<string, unknown>; return { number: String(v(o.number) ?? ""), ...(v(o.label) ? { label: String(v(o.label)) } : {}) }; });
    case "maps": return list.map(e => { const o = e as Record<string, unknown>; return { url: String(v(o.url) ?? ""), ...(v(o.title) ? { title: String(v(o.title)) } : {}) }; });
    case "links": return list.map(e => { const o = e as Record<string, unknown>; return { platform: String(v(o.platform) ?? ""), url: String(v(o.url) ?? "") }; });
    case "logos": return list.map(e => { const o = e as Record<string, unknown>; return { variant: String(v(o.variant) ?? "other"), url: String(v(o.url) ?? "") }; });
    case "colours": return list.map(e => { const o = e as Record<string, unknown>; return { role: String(v(o.role) ?? ""), hex: String(v(o.hex) ?? "") }; });
    case "competitors": return list.map(e => { const o = e as Record<string, unknown>; return { name: String(v(o.name) ?? ""), ...(v(o.website) ? { website: String(v(o.website)) } : {}), ...(v(o.notes) ? { notes: String(v(o.notes)) } : {}) }; });
    case "hours": return list.map(e => { const o = e as Record<string, unknown>; const first = ((v(o.intervals) as unknown[]) ?? [])[0] as Record<string, unknown> | undefined;
      return { day: String(v(o.day) ?? ""), closed: v(o.closed) === true, ...(first ? { opens: String(v(first.opens) ?? ""), closes: String(v(first.closes) ?? "") } : {}) }; });
  }
}

export function fieldStatus(fact: Fact | undefined): FieldStatus {
  if (!fact || fact.status === "unknown") return "empty";
  if (fact.status === "not_applicable") return "not_applicable";
  return fact.confirmedAt ? "confirmed" : "suggested";
}
const sourcesOf = (fact: Fact | undefined) => (fact?.sources ?? []).flatMap(s => s.kind === "url" ? [s.url] : []);
export const factSources = sourcesOf;

function confirmDeep(node: unknown, at: string): unknown {
  if (Array.isArray(node)) return node.map(n => confirmDeep(n, at));
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(node)) out[k] = k === "sources" ? val : confirmDeep(val, at);
  if (isFact(node)) out.confirmedAt = (node as Fact).confirmedAt ?? at;
  return out;
}
const parse = (profile: Profile) => businessProfileSchema.parse(profile) as BusinessProfile;
const clone = (profile: BusinessProfile | null | undefined): Profile => structuredClone(profile ?? { schemaVersion: 1 }) as Profile;

/** Suggestions from research. Each is applied only if it validates and the field isn't already confirmed. */
export function applySuggestions(profile: BusinessProfile | null | undefined, items: { kind: FieldKind; path: string; value: FieldValue; sources: string[] }[], retrievedAt: string) {
  let current = clone(profile);
  const applied: string[] = [], rejected: string[] = [];
  for (const item of items) {
    const existing = factAt(current as BusinessProfile, item.path);
    if (existing?.confirmedAt || existing?.status === "not_applicable") { rejected.push(`${item.path}: already confirmed`); continue; }
    const sources: Source[] = item.sources.filter(u => /^https?:\/\//.test(u)).slice(0, 10).map(url => ({ kind: "url", url, retrievedAt }));
    const fact = toFact(item.kind, item.path, item.value, sources, null);
    if (!fact) continue;
    const next = structuredClone(current);
    setAt(next, item.path, fact, { sources, confirmedAt: null });
    try { current = parse(next) as Profile; applied.push(item.path); } catch { rejected.push(`${item.path}: invalid value`); }
  }
  return { profile: parse(current), applied, rejected };
}
/** The owner accepts what is there (a suggestion or partly confirmed value). */
export function confirmField(profile: BusinessProfile | null | undefined, path: string, now = new Date()) {
  const current = clone(profile), at = now.toISOString();
  const fact = factAt(current as BusinessProfile, path);
  if (!fact) return parse(current);
  setAt(current, path, confirmDeep(fact, at) as Fact, { sources: fact.sources, confirmedAt: at });
  if (path.startsWith("realEstate.") && isFact(current.realEstate)) (current.realEstate as Fact).confirmedAt ??= at;
  return parse(current);
}
/** The owner types or edits a value: a confirmed fact with the owner as source. Empty removes the field. */
export function setOwnerField(profile: BusinessProfile | null | undefined, kind: FieldKind, path: string, value: FieldValue | null, ownerId: string, now = new Date()) {
  const current = clone(profile), at = now.toISOString();
  const sources: Source[] = [{ kind: "owner", ownerId, suppliedAt: at }];
  const fact = value === null ? undefined : toFact(kind, path, value, sources, at);
  setAt(current, path, fact, { sources, confirmedAt: at });
  if (fact && path.startsWith("realEstate.") && isFact(current.realEstate)) (current.realEstate as Fact).confirmedAt ??= at;
  return parse(current);
}
/** The owner says a field doesn't apply to them. */
export function markNotApplicable(profile: BusinessProfile | null | undefined, path: string, ownerId: string, now = new Date()) {
  const current = clone(profile), at = now.toISOString();
  const sources: Source[] = [{ kind: "owner", ownerId, suppliedAt: at }];
  setAt(current, path, { status: "not_applicable", reason: "Owner said this does not apply", sources, confirmedAt: at }, { sources, confirmedAt: at });
  return parse(current);
}
