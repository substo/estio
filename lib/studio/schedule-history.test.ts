import { test } from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import type { StudioDb } from "./db";
import { createScheduleHistoryReader } from "./schedule-history-reader";
const id='10000000-0000-4000-8000-000000000001';
function fixture(allowed=true){const queries:Prisma.Sql[]=[];const responses:unknown[][]=[];
 const db:StudioDb={rows:async<T>(q: Prisma.Sql)=>{queries.push(q);assert.ok(responses.length);return responses.shift() as T[];},one:async()=>null,call:async()=>{throw Error('unexpected write');}};
 return {queries,responses,reader:createScheduleHistoryReader({db,authorize:async()=>allowed?{locationId:'canonical-location'}:null})};}
test('history denies storage before authority and rejects invalid IDs/pages',async()=>{
 const f=fixture(false);assert.equal(await f.reader.schedule('input',id,0),null);assert.equal(await f.reader.run('input',id,id),null);assert.equal(await f.reader.snapshot('input',id),null);assert.equal(f.queries.length,0);
 const valid=fixture();assert.equal(await valid.reader.schedule('input','bad',0),null);assert.equal(await valid.reader.schedule('input',id,-1),null);assert.equal(valid.queries.length,0);
});
test('bounded history scopes every read to canonical Location; summaries omit private payload',async()=>{
 const f=fixture();f.responses.push([{id}],[{id,import_run_id:id}],Array.from({length:21},()=>({id})),[{id}]);
 const result=await f.reader.schedule('untrusted',id,2);assert.ok(result);assert.equal(result.history.length,20);assert.equal(result.hasMore,true);
 for(const q of f.queries){assert.ok(q.values.includes('canonical-location'));assert.ok(!q.values.includes('untrusted'));}
 const history=f.queries[2];assert.match(history.sql,/limit 21 offset \?/);assert.equal(history.values.at(-1),40);assert.match(history.sql,/schedule_id = \?::uuid and import_run_id = \?::uuid/);assert.doesNotMatch(history.sql,/select .*?,payload,/);
});
test('run details bind parent and run; snapshot reads occur only on explicit download',async()=>{
 const f=fixture();const payload={output:' exact\n',unknown:true};f.responses.push([{id,payload}],[{id}]);const result=await f.reader.run('input',id,id);assert.deepEqual(result?.run.payload,payload);assert.match(f.queries[0].sql,/schedule_id = \?::uuid and id = \?::uuid/);
 const g=fixture();g.responses.push([{id,source_canonical_json:' exact snapshot '}]);assert.equal((await g.reader.snapshot('input',id))?.imported.source_canonical_json,' exact snapshot ');assert.match(g.queries[0].sql,/source_canonical_json/);
});
test('missing and hosted-only schedules never read unrelated legacy history',async()=>{const f=fixture();f.responses.push([]);assert.equal(await f.reader.schedule('input',id,0),null);assert.equal(f.queries.length,1);const g=fixture();g.responses.push([{id}],[]);assert.deepEqual((await g.reader.schedule('input',id,0))?.history,[]);assert.equal(g.queries.length,2);});

import { historicalRunStatus, scheduleHistoryPage, scheduleHistoryQuery } from "./schedule-history-policy";
import { scheduleImportDownloadResponse } from "./schedule-import-download";
import type { ScheduleImportSnapshot } from "./schedule-history-reader";
const workspace=id, schedule=id, imported=id;
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
  const response = scheduleImportDownloadResponse({ access: { locationId: workspace }, imported: snapshot });
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(response.headers.get("Content-Type")!, /application\/json/);
  assert.match(response.headers.get("Content-Disposition")!, /^attachment;/);
  assert.deepEqual(await response.json(), { locationId: workspace, ...snapshot });
  const denied = scheduleImportDownloadResponse(null);
  assert.equal(denied.status, 404); assert.equal(denied.headers.get("Cache-Control"), "private, no-store");
  assert.equal(await denied.text(), "Not found");
});
