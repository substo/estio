import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { normalizeLegacySchedules } from "./legacy-schedules";

const sid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const rid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function scheduleFixture() {
  return { version: 1, unknownTopLevel: { keep: [true, "verbatim"] }, schedules: [{
    id: sid, presetId: "youtube-discovery", query: "  exact focus  ", channelUrl: "https://www.youtube.com/@example",
    channelTargets: [{ role: "owner", url: "https://www.youtube.com/@example", title: "Owner" }],
    intervalHours: 24, enabled: true, dailyTime: "09:00", timeZone: "Asia/Nicosia", autoKnowledgeScan: true,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", nextRunAt: "2026-01-03T07:00:00.000Z",
    unknownScheduleField: { original: true },
  }], runs: [{ id: rid, scheduleId: sid, presetId: "youtube-discovery", status: "completed",
    startedAt: "2026-01-02T07:00:00.000Z", completedAt: "2026-01-02T07:01:00.000Z",
    output: "  Private output.\nExact script/citations: https://example.test\n", error: " exact stderr\n", jobId: "legacy-job",
    unknownRunField: [1, 2, 3],
  }] };
}

test("deterministic preview preserves full source, exact payloads, links, and original order", () => {
  const source = scheduleFixture();
  const before = structuredClone(source);
  const manifest = normalizeLegacySchedules(source);
  assert.equal(manifest.valid, true);
  assert.equal(manifest.applySupported, false);
  assert.equal(manifest.executionEnabled, false);
  assert.deepEqual(manifest.schedules[0].payload, source.schedules[0]);
  assert.deepEqual(manifest.runs[0].payload, source.runs[0]);
  assert.deepEqual(JSON.parse(manifest.sourceCanonicalJson), source);
  assert.equal(manifest.schedules[0].draft?.query, "  exact focus  ");
  assert.equal(manifest.runs[0].scheduleId, sid);
  assert.equal(manifest.sourceDigest, createHash("sha256").update(manifest.sourceCanonicalJson).digest("hex"));
  assert.deepEqual(manifest.counts, { schedules: 1, runs: 1, legacyEnabled: 1, discovery: 1, inFlightRuns: 0 });
  assert.ok(manifest.issues.some(i => i.code === "discovery_authorization_requires_review"));
  assert.ok(manifest.issues.some(i => i.code === "automatic_knowledge_scan_not_ported"));
  assert.ok(manifest.issues.some(i => i.code === "legacy_enabled_not_activated"));
  assert.deepEqual(manifest, normalizeLegacySchedules(source));
  assert.deepEqual(source, before);
  source.runs[0].output = "edited";
  assert.notDeepEqual(manifest.runs[0].payload, source.runs[0]);
});

test("keeps malformed and duplicate rows visible and blocks validity", () => {
  const source = scheduleFixture();
  const malformed = { ...source, schedules: [source.schedules[0], { ...source.schedules[0], id: sid.toUpperCase() }, null], runs: [source.runs[0], source.runs[0], "bad"] };
  const manifest = normalizeLegacySchedules(malformed);
  assert.equal(manifest.valid, false);
  assert.equal(manifest.schedules.length, 3);
  assert.equal(manifest.runs.length, 3);
  assert.equal(manifest.schedules[2].payload, null);
  assert.equal(manifest.runs[2].payload, "bad");
  assert.ok(manifest.issues.some(i => i.code === "duplicate_schedule_id"));
  assert.ok(manifest.issues.some(i => i.code === "duplicate_run_id"));
});

test("orphan links and unsupported workflows/cadences are reported without dropping payloads", () => {
  const source = scheduleFixture();
  source.runs[0].scheduleId = rid;
  source.schedules[0].presetId = "knowledge-extract";
  source.schedules[0].intervalHours = 1;
  const result = normalizeLegacySchedules(source);
  assert.equal(result.valid, false);
  assert.deepEqual(result.schedules[0].payload, source.schedules[0]);
  for (const code of ["missing_run_schedule", "unsupported_workflow", "unsupported_cadence"]) assert.ok(result.issues.some(i => i.code === code));
});

test("in-flight history is retained as history rather than restarted or rewritten", () => {
  for (const status of ["running", "queued"]) {
    const source = scheduleFixture();
    const run = { ...source.runs[0], status, completedAt: null };
    const result = normalizeLegacySchedules({ ...source, runs: [run] });
    assert.equal(result.valid, true);
    assert.equal(result.counts.inFlightRuns, 1);
    assert.deepEqual(result.runs[0].payload, run);
    assert.ok(result.issues.some(i => i.code === "historical_run_not_resumable"));
    assert.equal(result.executionEnabled, false);
  }
});

test("rejects missing timing fields, ambiguous dates, invalid terminal history and unsafe focus", () => {
  const source = scheduleFixture();
  const badSchedules = [
    { ...source.schedules[0], dailyTime: undefined }, { ...source.schedules[0], dailyTime: "24:00" },
    { ...source.schedules[0], timeZone: "UTC" }, { ...source.schedules[0], enabled: "true" },
    { ...source.schedules[0], createdAt: "2026-02-31T00:00:00Z" },
    { ...source.schedules[0], query: "focus\ncontrol" },
  ];
  // JSON serialization models an absent legacy dailyTime rather than inventing a default.
  for (const schedule of badSchedules) assert.equal(normalizeLegacySchedules(JSON.parse(JSON.stringify({ ...source, schedules: [schedule] }))).valid, false);
  for (const run of [{ ...source.runs[0], status: "mystery" }, { ...source.runs[0], completedAt: null }, { ...source.runs[0], completedAt: "2025-01-01T00:00:00Z" }]) {
    assert.equal(normalizeLegacySchedules({ ...source, runs: [run] }).valid, false);
  }
});

test("run workflow need not equal a later edited schedule's workflow", () => {
  const source = scheduleFixture(); source.schedules[0].presetId = "idea-review";
  assert.equal(normalizeLegacySchedules(source).valid, true);
});

test("snapshot identity includes unknown fields and ordering but ignores object key order", () => {
  const source = scheduleFixture();
  const base = normalizeLegacySchedules(source);
  assert.equal(normalizeLegacySchedules({ runs: source.runs, schedules: source.schedules, unknownTopLevel: source.unknownTopLevel, version: 1 }).sourceDigest, base.sourceDigest);
  const changed = structuredClone(source); changed.unknownTopLevel.keep.push("changed");
  assert.notEqual(normalizeLegacySchedules(changed).sourceDigest, base.sourceDigest);
});

test("unsupported top-level shapes, numeric fidelity loss, and row limits fail closed", () => {
  for (const source of [null, { version: 2, schedules: [], runs: [] }, { version: 1, schedules: [], runs: [], unsafe: Number.MAX_SAFE_INTEGER + 1 }]) assert.throws(() => normalizeLegacySchedules(source), /invalid_schedules_v1/);
  assert.throws(() => normalizeLegacySchedules({ version: 1, schedules: Array(10_001).fill(null), runs: [] }), /schedule_row_limit_exceeded/);
});

test("malformed or duplicate channel targets block metadata validity without URL rewriting", () => {
  const source = scheduleFixture();
  const originalUrl = source.schedules[0].channelUrl;
  source.schedules[0].channelTargets.push({ role: "reference", url: "https://m.youtube.com/@example/", title: "duplicate" });
  const duplicate = normalizeLegacySchedules(source);
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.issues.some(i => i.code === "duplicate_channel_target"));
  assert.equal((duplicate.schedules[0].payload as { channelUrl: string }).channelUrl, originalUrl);
  source.schedules[0].channelTargets = [{ role: "unrecognized", url: "javascript:unsafe", title: "raw" }];
  const malformed = normalizeLegacySchedules(source);
  assert.equal(malformed.valid, false);
  assert.ok(malformed.issues.some(i => i.code === "invalid_channel_target"));
});
