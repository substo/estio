import assert from "node:assert/strict";
import test from "node:test";
import { pollDelay } from "./poll-backoff";

test("poll delay doubles per empty poll, is capped, and keeps half of it random", () => {
  assert.equal(pollDelay(0, 5000, 60_000, () => 1), 5000);
  assert.equal(pollDelay(0, 5000, 60_000, () => 0), 2500);
  assert.equal(pollDelay(3, 5000, 60_000, () => 1), 40_000);
  assert.equal(pollDelay(4, 5000, 60_000, () => 1), 60_000);
  assert.equal(pollDelay(1000, 5000, 60_000, () => 0), 30_000);
  assert.equal(pollDelay(-1, 5000, 60_000, () => 1), 5000);
});
