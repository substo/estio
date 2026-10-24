import assert from "node:assert/strict";
import test from "node:test";
import { createScheduleHistoryReader, type ScheduleImportSnapshot } from "./schedule-history-reader";
import { historicalRunStatus, scheduleHistoryPage, scheduleHistoryQuery } from "./schedule-history-policy";
import { scheduleImportDownloadResponse } from "./schedule-import-download";

const workspace = "10000000-0000-4000-8000-000000000001";
const schedule = "20000000-0000-4000-8000-000000000002";
const imported = "30000000-0000-4000-8000-000000000003";
const run = "40000000-0000-4000-8000-000000000004";
function reader(authorized = true) {
  const paths: string[] = []; const authorizations: string[] = []; const responses: unknown[] = [];
  const service = createScheduleHistoryReader({
    authorize: async (id: string) => { authorizations.push(id); return authorized ? { workspace: { id: workspace } } : null; },
    read: async <T>(path: string): Promise<T> => { paths.push(path); assert.ok(responses.length, "Unexpected service-role read"); return responses.shift() as T; },
  });
  return { service, paths, authorizations, responses };
}
const query = (value: string) => new URL(`https://fixture.invalid/${value}`).searchParams;

test("all history readers deny service-role reads without workspace authority", async () => {
  const r = reader(false);
  assert.equal(await r.service.schedule(workspace, schedule, 0), null);
  assert.equal(await r.service.run(workspace, schedule, run), null);
  assert.equal(await r.service.snapshot(workspace, imported), null);
  assert.equal(r.paths.length, 0); assert.equal(r.authorizations.length, 3);
});
test("invalid IDs and unsafe pages cannot reach storage", async () => {
  const r = reader();
  assert.equal(await r.service.schedule(workspace, "bad", 0), null);
  for (const page of [-1, NaN, 1.1, 100_000]) assert.equal(await r.service.schedule(workspace, schedule, page), null);
  assert.equal(await r.service.run(workspace, schedule, "bad"), null);
  assert.equal(await r.service.snapshot(workspace, "bad"), null);
  assert.equal(r.paths.length, 0);
});
test("schedule history scopes every read to resolved workspace and immutable import, with bounded summaries", async () => {
  const r = reader();
  r.responses.push([{ id: schedule }], [{ id: schedule, import_run_id: imported, payload: { query: " exact original " } }],
    Array.from({ length: 21 }, (_, source_index) => ({ id: run, source_index })), [{ id: imported }]);
  const result = await r.service.schedule("untrusted-input-workspace", schedule, 2);
  assert.ok(result); assert.equal(result.history.length, 20); assert.equal(result.hasMore, true);
  assert.equal(r.authorizations[0], "untrusted-input-workspace");
  for (const path of r.paths) assert.equal(query(path).get("workspace_id"), `eq.${workspace}`);
  const history = r.paths.find(p => p.startsWith("studio_schedule_legacy_runs"))!;
  assert.equal(query(history).get("schedule_id"), `eq.${schedule}`);
  assert.equal(query(history).get("import_run_id"), `eq.${imported}`);
  assert.equal(query(history).get("offset"), "40");
  assert.equal(query(history).get("limit"), "21");
  assert.equal(query(history).get("order"), "source_index.asc,id.asc");
  assert.doesNotMatch(query(history).get("select")!, /(?:^|,)payload(?:,|$)|output|error/);
  assert.ok(r.paths.every(p => !query(p).get("select")!.includes("source_canonical_json")));
});
test("missing schedule and hosted-only drafts do not query unrelated legacy history", async () => {
  const missing = reader(); missing.responses.push([]);
  assert.equal(await missing.service.schedule(workspace, schedule, 0), null); assert.equal(missing.paths.length, 1);
  const hosted = reader(); hosted.responses.push([{ id: schedule }], []);
  const result = await hosted.service.schedule(workspace, schedule, 0);
  assert.ok(result); assert.deepEqual(result.history, []); assert.equal(result.imported, null); assert.equal(result.legacy, null);
  assert.equal(hosted.paths.length, 2);
});
test("run details require workspace, parent schedule and run ID together, preserving exact payload", async () => {
  const r = reader();
  const payload = { status: "running", output: "  exact output\n<script>untrusted</script>  ", error: " stderr\n", unknown: true };
  r.responses.push([{ id: run, schedule_id: schedule, import_run_id: imported, payload }], [{ id: imported }]);
  const result = await r.service.run(workspace, schedule, run);
  assert.deepEqual(result?.run.payload, payload);
  assert.equal(query(r.paths[0]).get("schedule_id"), `eq.${schedule}`);
  assert.equal(query(r.paths[0]).get("id"), `eq.${run}`);
  assert.equal(query(r.paths[0]).get("workspace_id"), `eq.${workspace}`);
  assert.equal(query(r.paths[1]).get("id"), `eq.${imported}`);
  assert.equal(query(r.paths[1]).get("workspace_id"), `eq.${workspace}`);
  const missing = reader(); missing.responses.push([]);
  assert.equal(await missing.service.run(workspace, schedule, run), null); assert.equal(missing.paths.length, 1);
});
test("full snapshots are fetched only through a separately authorized workspace-scoped read", async () => {
  const r = reader(); r.responses.push([{ id: imported, source_canonical_json: '{"exact":"snapshot"}' }]);
  assert.ok(await r.service.snapshot(workspace, imported));
  assert.equal(query(r.paths[0]).get("workspace_id"), `eq.${workspace}`);
  assert.equal(query(r.paths[0]).get("id"), `eq.${imported}`);
  assert.ok(query(r.paths[0]).get("select")!.includes("source_canonical_json"));
  const missing = reader(); missing.responses.push([]);
  assert.equal(await missing.service.snapshot(workspace, imported), null);
});
test("page parsing rejects repeated/unsafe values and status copy cannot imply hosted execution", () => {
  for (const value of [undefined, ["1", "2"], "-1", "1.1", "1e2", "100000"]) assert.equal(scheduleHistoryPage(value), 0);
  assert.equal(scheduleHistoryPage("2"), 2);
  assert.equal(scheduleHistoryQuery(workspace, schedule, imported, 1).offset, "20");
  for (const status of ["running", "queued"]) assert.match(historicalRunStatus(status), /local snapshot · not resumed/);
  assert.match(historicalRunStatus("failed"), /failed in the local snapshot/);
});
test("provenance downloads preserve private exact content and forbid caching or HTML interpretation", async () => {
  const snapshot: ScheduleImportSnapshot = { id: imported, source_digest: "a".repeat(64), counts: { runs: 1 }, created_at: "2026-01-01T00:00:00Z",
    imported_by_clerk_user_id: "user_fixture", preview_evidence: { issues: [{ code: "legacy_enabled_not_activated" }] },
    source_canonical_json: '{"private":"  exact </script> text\\n"}' };
  const response = scheduleImportDownloadResponse({ access: { workspace: { id: workspace } }, imported: snapshot });
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(response.headers.get("Content-Type")!, /application\/json/);
  assert.match(response.headers.get("Content-Disposition")!, /^attachment;/);
  assert.deepEqual(await response.json(), { workspaceId: workspace, ...snapshot });
  const denied = scheduleImportDownloadResponse(null);
  assert.equal(denied.status, 404); assert.equal(denied.headers.get("Cache-Control"), "private, no-store");
  assert.equal(await denied.text(), "Not found");
});
