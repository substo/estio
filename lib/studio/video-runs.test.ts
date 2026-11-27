import assert from "node:assert/strict";
import { test } from "node:test";
import { pickVideoRuns } from "./video-runs";

const run = (id: string, status: string, frame_count = 0) => ({ id, status, frame_count });

test("a later failed re-run does not hide the earlier saved result and its frames", () => {
  const r = pickVideoRuns([run("new", "failed"), run("old", "partial", 6)]);
  assert.equal(r.latest?.id, "old");
  assert.equal(r.framesFrom, "old");
  assert.equal(r.lastAttempt?.id, "new");
});
test("a running re-run is headlined while the earlier frames stay listed", () => {
  const r = pickVideoRuns([run("new", "running"), run("old", "ready", 4)]);
  assert.equal(r.latest?.id, "new");
  assert.equal(r.framesFrom, "old");
  assert.equal(r.lastAttempt, null);
});
test("only failures: show the newest, no frames", () => {
  const r = pickVideoRuns([run("b", "failed"), run("a", "failed")]);
  assert.equal(r.latest?.id, "b");
  assert.equal(r.framesFrom, null);
  assert.equal(r.lastAttempt, null);
});
test("frames come from the newest saved run that has any", () => {
  assert.equal(pickVideoRuns([run("n", "ready", 0), run("o", "ready", 3)]).framesFrom, "o");
});
