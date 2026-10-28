import assert from "node:assert/strict";
import test from "node:test";
import { CONTENT_STAGES, contentListQuery, contentStageForDisplay, filterContentSummaries, readContentDraft, readContentFilters } from "./content-policy";

function form(): FormData { const value = new FormData(); value.set("title", "A content idea"); return value; }

test("content edits preserve exact script text and never accept relationship mutations", () => {
  const value = form();
  const script = "  Opening line…\n\n[Pause] A quotation: ‘exact’.  ";
  value.set("script", script); value.set("linkedIds", "attacker-selected-id"); value.set("stage", "script");
  const result = readContentDraft(value);
  assert.equal(result.kind, "content"); assert.equal(result.payload.script, script);
  assert.equal(Object.hasOwn(result.payload, "linkedIds"), false);
  assert.equal(Object.hasOwn(result.payload, "notes"), false);
  assert.equal(Object.hasOwn(result.payload, "approved"), false);
});

test("stage, audience stage and pillar reject unsupported values without coercion", () => {
  for (const [key, invalid] of [["stage", "published"], ["level", "anything"], ["pillar", "1.0"], ["pillar", "0"], ["pillar", "0x1"]]) {
    const value = form(); value.set(key, invalid); assert.throws(() => readContentDraft(value));
  }
  const value = form(); value.set("stage", "ready"); value.set("level", "retain"); value.set("pillar", "4");
  value.set("approvedPresent", "1");
  assert.deepEqual(readContentDraft(value).payload, { title: "A content idea", stage: "ready", level: "retain", pillar: 4, approved: false });
  value.set("pillar", ""); assert.equal(readContentDraft(value).payload.pillar, null);
  value.set("script", "x".repeat(100_001)); assert.throws(() => readContentDraft(value), /too long/);
});

test("pipeline projections stay scoped and do not fetch script/transcript bodies", () => {
  const query = contentListQuery("authorized-location", false);
  assert.deepEqual(query.values, ["authorized-location"]); assert.match(query.sql, /kind = 'content'/);
  assert.match(query.sql, /archived = false/); assert.doesNotMatch(contentListQuery("authorized-location", true).sql, /archived = false/);
  assert.match(query.sql, /payload->>'stage' as stage/); assert.doesNotMatch(query.sql, /script|transcript/);
  assert.equal(contentStageForDisplay("ready"), "ready"); assert.equal(contentStageForDisplay("not-a-stage"), "unclassified");
});


test("content filters safely ignore repeated query values and bound scalar search", () => {
  assert.deepEqual(readContentFilters({ q: ["a", "b"], archived: ["1", "1"] }), { search: "", showArchived: false, stage: "all" });
  assert.deepEqual(readContentFilters({ q: "  title  ", archived: "1" }), { search: "title", showArchived: true, stage: "all" });
  assert.deepEqual(readContentFilters({}), { search: "", showArchived: false, stage: "all" });
  assert.equal(readContentFilters({ q: "x".repeat(201) }).search.length, 200);
});

test("stage URLs accept only explicit supported stages and safely ignore repeated/unknown values", () => {
  for (const stage of [...CONTENT_STAGES, "unclassified"] as const) assert.equal(readContentFilters({ stage }).stage, stage);
  for (const stage of [["idea", "ready"], "published", "IDEA", " idea ", "not.in.(idea)", ""]) assert.equal(readContentFilters({ stage }).stage, "all");
  assert.deepEqual(readContentFilters({ q: "  quotation  ", archived: "1", stage: "script" }), { search: "quotation", showArchived: true, stage: "script" });
});

test("combined stage and search filters retain exact summary rows, ordering and unclassified imports", () => {
  const records = [
    { id: "new-script", title: "Café guide", summary: "  Exact summary\n", stage: "script", archived: false, version: 3 },
    { id: "idea", title: "Café idea", summary: null, stage: "idea", archived: false, version: 1 },
    { id: "old-script", title: "Earlier draft", summary: "CAFÉ details", stage: "script", archived: true, version: 7 },
    { id: "missing", title: "Imported missing stage", summary: null, stage: null, archived: false, version: 1 },
    { id: "unknown", title: "Imported legacy stage", summary: null, stage: "published", archived: false, version: 1 },
    { id: "malformed", title: "Imported structured stage", summary: null, stage: { name: "idea" }, archived: false, version: 1 },
  ];
  const before = structuredClone(records);
  const visible = filterContentSummaries(records, readContentFilters({ stage: "script", q: "café", archived: "1" }));
  assert.deepEqual(visible.map(record => record.id), ["new-script", "old-script"]);
  assert.equal(visible[0], records[0]); assert.equal(visible[1], records[2]);
  assert.deepEqual(filterContentSummaries(records, readContentFilters({ stage: "unclassified" })).map(record => record.id), ["missing", "unknown", "malformed"]);
  assert.deepEqual(filterContentSummaries(records, readContentFilters({ stage: "ready" })), []);
  assert.deepEqual(filterContentSummaries(records, readContentFilters({ stage: ["idea", "script"] })), records);
  assert.deepEqual(records, before, "filtering cannot rewrite imported stages, approval, versions or text");
  // Archive visibility is still scoped by the existing authorized list query.
  assert.match(contentListQuery("resolved-location", false).text, /and archived = false/);
  assert.doesNotMatch(contentListQuery("resolved-location", true).text, /archived = false/);
});
