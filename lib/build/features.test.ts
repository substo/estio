import test from "node:test";
import assert from "node:assert/strict";
import { applyFilters, defaultFilters, firstLine, placeOf, productMap, techOf, workStatus } from "./features";
import { deployed, mergeWords, releaseFrom } from "./release";

const file = (id: string, path: string, kind = "resource", extra: object = {}) => ({ id, spec: { kind, name: path, purpose: "Source inventory; purpose needs owner curation", sourceRefs: [path], ...extra } });
const page = (id: string, path: string, section: string, name: string, route: string) => file(id, path, "page", { section, name, route });
const at = (h: number) => new Date(Date.UTC(2026, 10, 6, h)).toISOString();
const story = (area: string, concept: string, h = 1) => ({ area, concept, achieved: [], howItWorks: [], next: [], updatedAt: at(h) });
const job = (id: string, state: string, opts: { title?: string; scope?: string[]; nodeIds?: string[]; story?: object; merge?: object; h?: number } = {}) => ({
  id, state, updatedAt: at(opts.h ?? 1),
  spec: { title: opts.title ?? id, outcome: `${id} outcome. More.`, scope: opts.scope ?? ["lib/x.ts"], nodeIds: opts.nodeIds ?? [] },
  checkpoint: { ...(opts.story ? { story: opts.story } : {}), ...(opts.merge ? { merge: opts.merge } : {}) },
});

const nodes = [
  page("p-lib", "app/(main)/studio/library/page.tsx", "Studio", "Library", "/studio/library"),
  page("p-conv", "app/(main)/admin/conversations/page.tsx", "CRM", "Conversations", "/admin/conversations"),
  page("p-onb", "app/(main)/admin/onboarding/page.tsx", "CRM", "Onboarding", "/admin/onboarding"),
  file("f-libimport", "lib/studio/library-import.ts"),
  file("f-libcomp", "app/(main)/studio/library/_components/card.tsx"),
  file("f-convlist", "components/conversations/list.tsx"),
  file("f-wa", "lib/whatsapp/send.ts"),
  file("f-cron", "app/api/cron/whatsapp-outbound/route.ts"),
  file("f-queue", "lib/queue/whatsapp-outbound.ts"),
  file("f-jobid", "lib/queue/job-id.ts"),
  file("f-onb", "lib/onboarding/flow.ts"),
  { id: "concept-research", spec: { kind: "feature", name: "Continuous research", purpose: "Idea: find outlier videos; explain why.", product: "studio", coverage: "inferred", sourceRefs: ["lib/studio/library-import.ts"] } },
  { id: "feature-abc", spec: { kind: "feature", name: "Conversation list", purpose: "Shows every conversation.", product: "crm", coverage: "confirmed", sourceRefs: [] } },
  { id: "rule-x", spec: { kind: "rule", name: "Boundaries", purpose: "Rules", sourceRefs: [] } },
];
const edges = [
  { fromId: "p-conv", toId: "f-convlist", kind: "uses" }, { fromId: "f-convlist", toId: "f-wa", kind: "uses" },
  { fromId: "f-cron", toId: "f-queue", kind: "uses" }, { fromId: "f-queue", toId: "f-wa", kind: "uses" },
  { fromId: "p-lib", toId: "f-libcomp", kind: "uses" }, { fromId: "f-libcomp", toId: "f-libimport", kind: "uses" },
  { fromId: "p-lib", toId: "concept-research", kind: "contains" }, { fromId: "p-conv", toId: "feature-abc", kind: "contains" },
  { fromId: "concept-research", toId: "f-libimport", kind: "reads" },
];
const jobs = [
  job("lib-1", "external-working", { title: "Studio Library redesign", scope: ["app/(main)/studio/", "lib/studio/"], story: story("Studio Library", "The Library keeps sources.", 5), h: 5 }),
  job("lib-2", "done", { title: "Library cards", scope: ["app/(main)/studio/library/_components/card.tsx"], story: story("Studio Library", "Cards only.", 6), h: 6, merge: { state: "merged", at: at(6), sha: "a".repeat(40) } }),
  job("onb", "external-done", { title: "Business onboarding", scope: ["lib/onboarding/", "app/(main)/admin/onboarding/"], story: story("Onboarding", "Research-first chat.") }),
  job("idea-1", "proposed", { title: "Tidy conversations", nodeIds: ["f-convlist"] }),
  job("research", "approved", { nodeIds: ["concept-research"] }),
  job("wa", "done", { scope: ["lib/whatsapp/send.ts"], story: story("WhatsApp", "WhatsApp sending."), merge: { state: "queued", at: at(2) } }),
  job("loose", "failed", { title: "Loose task" }),
  job("dropped", "revoked", { title: "Dropped" }),
];
const map = productMap({ nodes, edges, jobs });
const item = (name: string) => map.features.find(f => f.name === name)!;

test("each piece of work belongs to exactly one entry, in the documented order", () => {
  const attached = map.features.flatMap(f => f.jobIds);
  assert.equal(attached.length, new Set(attached).size);
  assert.deepEqual([...attached].sort(), ["idea-1", "lib-1", "lib-2", "loose", "onb", "research", "wa"]);
  assert.equal(map.byJob.get("research"), "concept-research"); // 1. a feature record it names
  assert.equal(map.byJob.get("wa"), "tech:whatsapp"); // 2. an entry named like its story area
  assert.deepEqual(item("Studio Library").jobIds, ["lib-2", "lib-1"]); // 3. a shared story area, newest first
  assert.equal(map.byJob.get("idea-1"), "page:p-conv"); // 4. the page importing a named file
  assert.equal(item("Loose task").kind, "feature"); // 5. itself
  assert.ok(!map.features.some(f => f.name === "Dropped" || f.name === "Boundaries"));
});

test("status: doing beats done beats ideas; things that exist are done", () => {
  assert.equal(item("Studio Library").status, "doing");
  assert.equal(item("Onboarding").status, "done");
  assert.equal(item("CRM › Conversations").status, "idea");
  assert.equal(item("Continuous research").status, "doing");
  assert.equal(item("Conversation list").status, "done"); // confirmed from a screen: exists
  assert.equal(item("WhatsApp").status, "doing"); // finished but its merge is queued
  assert.equal(item("WhatsApp outbound").status, "done");
  assert.equal(workStatus({ state: "revoked", checkpoint: null }), null);
  assert.equal(workStatus({ state: "review", checkpoint: null }), "doing");
  const bare = productMap({ nodes: [nodes[11]], edges: [], jobs: [] });
  assert.equal(bare.features[0].status, "idea");
});

test("the story is told by the record covering the most, and the summary is its first sentence", () => {
  assert.equal(item("Studio Library").story?.concept, "The Library keeps sources.");
  assert.equal(item("Studio Library").summary, "The Library keeps sources.");
  assert.equal(item("Continuous research").summary, "Find outlier videos.");
  assert.equal(firstLine("Owner clarified scope 2026-11-05: PLATFORM BUILD owns requests; more"), "Platform Build owns requests.");
});

test("places, apps, pages and technologies come from paths and links", () => {
  const lib = item("Studio Library");
  assert.deepEqual(lib.areas, ["Studio"]);
  assert.equal(lib.app, "substo");
  assert.deepEqual(lib.pageIds, ["p-lib"]);
  assert.deepEqual(lib.workPageIds, ["p-lib"]); // a file in the page's private folder
  assert.deepEqual(item("Onboarding").areas, ["Platform"]);
  assert.deepEqual(item("Onboarding").workPageIds, ["p-onb"]);
  const proc = item("WhatsApp outbound");
  assert.equal(proc.kind, "process");
  assert.deepEqual(proc.tech, ["WhatsApp"]);
  assert.match(proc.summary, /^Runs on a schedule and through the background queue\. Uses WhatsApp\.$/);
  assert.ok(!map.features.some(f => f.name === "Job id"));
  const wa = item("WhatsApp");
  assert.deepEqual(wa.pageIds, ["p-conv"]); // reached within two imports
  assert.deepEqual(wa.processIds, [proc.id]);
  assert.deepEqual(item("CRM › Conversations").tech, ["WhatsApp"]);
  assert.deepEqual(item("Continuous research").relatedIds, []);
  assert.deepEqual(item("CRM › Conversations").relatedIds, ["feature-abc"]);
  assert.deepEqual(map.featuresOfPage.get("p-lib"), ["concept-research"]);
  assert.deepEqual(techOf("lib/crm/puppeteer-service.ts"), ["Puppeteer", "Old CRM"]);
  assert.deepEqual(placeOf("app/(substo-site)/sites/[slug]/page.tsx"), { area: "Website", app: "substo" });
  assert.equal(placeOf("lib/db.ts"), null);
});

test("filters: open work by default, then area, app, kind, technology and search words", () => {
  const names = (f = defaultFilters) => applyFilters(map.features, f).shown.map(x => x.name);
  assert.ok(!names().includes("Onboarding"));
  assert.ok(names({ statuses: ["done"] }).includes("Onboarding"));
  assert.deepEqual(applyFilters(map.features, defaultFilters).counts, { doing: 4, idea: 1, done: 3 });
  assert.deepEqual(names({ ...defaultFilters, area: "Studio" }), ["Studio Library", "Continuous research"]);
  assert.ok(!names({ ...defaultFilters, app: "estio" }).includes("Studio Library"));
  assert.deepEqual(names({ ...defaultFilters, kind: "technology" }), ["WhatsApp"]);
  assert.deepEqual(names({ statuses: ["doing", "idea", "done"], tech: "WhatsApp" }).sort(), ["CRM › Conversations", "WhatsApp", "WhatsApp outbound"].sort());
  assert.deepEqual(names({ ...defaultFilters, q: "library sources" }), ["Studio Library"]);
  assert.deepEqual(names({ ...defaultFilters, q: "nothing like this" }), []);
});

test("merged work says deployed only when the live release is known", () => {
  const merge = { state: "merged", at: at(6), sha: "a".repeat(40) };
  assert.equal(mergeWords(merge, null), "Merged");
  assert.equal(mergeWords(merge, { revision: "a".repeat(40), at: at(1) }), "Merged and deployed");
  assert.equal(mergeWords(merge, { revision: "b".repeat(40), at: at(7) }), "Merged and deployed");
  assert.equal(mergeWords(merge, { revision: "b".repeat(40), at: at(5) }), "Merged, not deployed yet");
  assert.equal(deployed(merge, undefined), null);
  assert.equal(releaseFrom({ revision: "short", at: at(1) }), null);
  assert.deepEqual(releaseFrom({ revision: "c".repeat(40), at: at(1), slot: "blue" }), { revision: "c".repeat(40), at: at(1) });
});
