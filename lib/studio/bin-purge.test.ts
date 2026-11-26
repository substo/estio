import assert from "node:assert/strict";
import test from "node:test";
import { binCutoff, BIN_RETENTION_DAYS, purgeKeys, type PurgePlanItem } from "./bin-policy";
import { runStudioBinPurge } from "./bin-purge";
import { characterSheetKey } from "./character-profile";

const LOC = "loc_1";
const piece: PurgePlanItem = {
  kind: "content", locationId: LOC, id: "11111111-1111-1111-1111-111111111111",
  objects: [{ bucket: "bkt", key: `${LOC}/uploads/u1/original` }, { bucket: "bkt", key: `${LOC}/video-frames/t/0-abc.jpg` }, { bucket: "other", key: `${LOC}/uploads/u9/original` }, { bucket: "bkt", key: "someone-else/uploads/u2/original" }],
  jobs: [{ id: "22222222-2222-2222-2222-222222222222", userId: "user_a", files: ["frame-1.png", "frame-2.png", "../evil.png"] }, { id: "33333333-3333-3333-3333-333333333333", userId: "user_a", files: ["transcript.json"] }, { id: "44444444-4444-4444-4444-444444444444", userId: "user_a", files: null }],
};

test("the cutoff is exactly 30 days back", () => {
  const now = new Date("2026-12-31T00:00:00Z");
  assert.equal(BIN_RETENTION_DAYS, 30);
  assert.equal(binCutoff(now).toISOString(), "2026-12-01T00:00:00.000Z");
});

test("purge keys cover media, frames, storyboard pictures and transcripts, and nothing foreign", () => {
  const keys = purgeKeys(piece, "bkt").sort();
  assert.deepEqual(keys, [
    `${LOC}/uploads/u1/original`, `${LOC}/video-frames/t/0-abc.jpg`,
    characterSheetKey(LOC, "user_a", piece.jobs[0].id, "frame-1.png"), characterSheetKey(LOC, "user_a", piece.jobs[0].id, "frame-2.png"),
    characterSheetKey(LOC, "user_a", piece.jobs[1].id, "transcript.json"),
  ].sort());
});

function harness(plan: PurgePlanItem[], failKey?: string) {
  const calls: string[] = [], deleted: string[] = [];
  const db = { async call<T>(fn: string, args?: Record<string, unknown>) {
    if (fn === "studio_bin_purge_plan") { calls.push(`plan ${args?.p_cutoff}`); return plan as T; }
    calls.push(`finish ${args?.p_kind} ${args?.p_id}`); return true as T;
  } };
  const store = { bucket: "bkt", async deleteObject(key: string) { if (key === failKey) throw new Error("r2 down"); calls.push(`r2 ${key}`); deleted.push(key); } };
  return { calls, deleted, db, store };
}

test("files are removed from R2 before the database rows, and the plan uses the 30-day cutoff", async () => {
  const h = harness([piece]);
  const r = await runStudioBinPurge({ db: h.db, store: h.store, now: new Date("2026-12-31T00:00:00Z") });
  assert.deepEqual(r, { purged: 1, failed: 0, objectsDeleted: 5 });
  assert.match(h.calls[0], /^plan 2026-12-01T00:00:00.000Z$/);
  const finish = h.calls.findIndex(c => c.startsWith("finish"));
  assert.equal(finish, h.calls.length - 1);
  assert.ok(h.calls.slice(1, finish).every(c => c.startsWith("r2 ")));
});

test("a file that cannot be removed leaves its item in the bin; other items still purge", async () => {
  const other: PurgePlanItem = { kind: "upload", locationId: LOC, id: "55555555-5555-5555-5555-555555555555", objects: [{ bucket: "bkt", key: `${LOC}/uploads/z/original` }], jobs: [] };
  const h = harness([piece, other], `${LOC}/uploads/u1/original`);
  const logs: string[] = [];
  const r = await runStudioBinPurge({ db: h.db, store: h.store, log: m => logs.push(m) });
  assert.deepEqual({ purged: r.purged, failed: r.failed }, { purged: 1, failed: 1 });
  assert.ok(!h.calls.some(c => c === `finish content ${piece.id}`));
  assert.ok(h.calls.includes(`finish upload ${other.id}`));
  assert.equal(logs.length, 1);
});

test("an empty bin purges nothing", async () => {
  const h = harness([]);
  assert.deepEqual(await runStudioBinPurge({ db: h.db, store: h.store }), { purged: 0, failed: 0, objectsDeleted: 0 });
});
