import test from "node:test";
import assert from "node:assert/strict";
import { archivedPlan, autoArchive, jobsOfTalk, reopenedPlan, talkIdOfJob, talkWords } from "./conversations";
import { talkOwnerCommand } from "./talk";

const now = new Date("2026-11-07T10:00:00Z");
const plan = (started: string[], items = 2) => ({ runId: "run-1", items: Array.from({ length: items }, (_, i) => ({ title: `T${i}` })), started, at: "2026-11-04T17:00:00Z" });
const job = (key: string, state: string, merge?: string) => ({ id: `j-${key}`, key, state, checkpoint: merge ? { merge: { state: merge } } : {} });
const k = (i: number) => `talk-cmw2dtzl4000ma4cutf5cwhfc-1567d869-${i}`;

test("work links to its conversation by key or checkpoint, in plan order", () => {
  assert.equal(talkIdOfJob({ key: k(0), checkpoint: null }), "cmw2dtzl4000ma4cutf5cwhfc");
  assert.equal(talkIdOfJob({ key: "external-t3:abc", checkpoint: { talkId: "t-9" } }), "t-9");
  assert.equal(talkIdOfJob({ key: "external-t3:abc", checkpoint: {} }), null);
  const jobs = [job(k(1), "working"), job("other", "done"), job(k(0), "done")];
  assert.deepEqual(jobsOfTalk({ id: "cmw2dtzl4000ma4cutf5cwhfc", plan: plan([k(0), k(1)]) }, jobs).map(j => j.key), [k(0), k(1)]);
  assert.deepEqual(jobsOfTalk({ id: "cmw2dtzl4000ma4cutf5cwhfc", plan: null }, jobs).map(j => j.key), [k(1), k(0)]);
});

test("a conversation archives itself only when every task it started is finished", () => {
  const talk = (started: string[], state = "idle", items = 2) => ({ state, plan: plan(started, items) });
  const done = [job(k(0), "done", "merged"), job(k(1), "done")];
  assert.deepEqual(autoArchive(talk([k(0), k(1)]), done, now), { at: now.toISOString(), by: "auto", reason: "All 2 tasks it started are done." });
  assert.equal(autoArchive(talk([k(0)], "idle", 1), done, now)?.reason, "Its task is done.");
  assert.equal(autoArchive(talk([k(0)]), done, now), null, "part of the plan not started");
  assert.equal(autoArchive(talk([k(0), k(1)]), [done[0], job(k(1), "review")], now), null, "a task waits for review");
  assert.equal(autoArchive(talk([k(0), k(1)]), [done[0], job(k(1), "done", "merging")], now), null, "a merge is in flight");
  assert.equal(autoArchive(talk([k(0), k(1)]), [done[0]], now), null, "a task is missing");
  assert.equal(autoArchive(talk([k(0), k(1)], "thinking"), done, now), null, "the agent is replying");
  assert.equal(autoArchive(talk([k(0), k(1)]), [job(k(0), "revoked"), job(k(1), "revoked")], now), null, "all dropped");
  assert.equal(autoArchive(talk([k(0), k(1)]), [job(k(0), "revoked"), job(k(1), "external-done")], now)?.reason, "All 1 tasks it started are done.");
  assert.equal(autoArchive({ state: "idle", plan: null }, done, now), null);
});

test("archive and reopen are recorded on the plan; a reopened one stays open until a new plan", () => {
  const archived = archivedPlan(plan([k(0)], 1), { at: now.toISOString(), by: "owner", reason: "Closed by you." });
  assert.equal(archived.archived?.by, "owner");
  assert.deepEqual(archivedPlan(null, { at: now.toISOString(), by: "owner", reason: "x" }), { runId: "", items: [], started: [], at: now.toISOString(), archived: { at: now.toISOString(), by: "owner", reason: "x" } });
  const reopened = reopenedPlan(archived, now)!;
  assert.equal(reopened.archived, undefined);
  assert.equal(reopened.reopened, now.toISOString());
  assert.equal(autoArchive({ state: "idle", plan: reopened }, [job(k(0), "done")], now), null);
  assert.equal(reopenedPlan(null), null);
  assert.equal(talkWords({ state: "archived", plan: archived }), "Archived: you closed it.");
  assert.equal(talkWords({ state: "idle", plan: plan([], 1) }), "Plan ready to start.");
  assert.ok(talkOwnerCommand.safeParse({ action: "talk-reopen", id: "abc" }).success);
});
