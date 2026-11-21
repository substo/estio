import assert from "node:assert/strict";
import test from "node:test";
import { nativeSubscriptionBlocked } from "../subscription-readiness";
import type { Usage } from "../../build/contract";
import { createCapacityTracker, describeCapacity, validBuckets } from "./capacity";

const T0 = Date.parse("2026-11-19T14:00:00Z");
const reading = (remaining: number, at: number, resetsAt?: string): Usage[string] => ({ remaining, at: new Date(at).toISOString().replace(/\.\d+Z$/, "Z"), windows: [{ label: "Session", remaining, ...(resetsAt ? { resetsAt } : {}) }] });

test("describeCapacity separates ok, used up (with reset), unreadable, stale and future readings", () => {
  const usage: Usage = { codex: reading(0, T0, "2026-11-19T15:10:35Z"), claudeAgent: reading(50, T0 - 31 * 60_000) };
  assert.equal(nativeSubscriptionBlocked(usage, "codex", undefined, T0), true);
  assert.equal(nativeSubscriptionBlocked(usage, "claude", undefined, T0), false);
  assert.deepEqual(describeCapacity(usage, T0), { status: { codex: "exhausted", claude: "stale" }, resetsAt: { codex: "2026-11-19T15:10:35Z" } });
  assert.deepEqual(describeCapacity({ codex: reading(60, T0) }, T0).status, { codex: "ok", claude: "unreadable" });
  assert.equal(describeCapacity({ codex: reading(60, T0 + 60_000) }, T0).status.codex, "stale");
});

test("one malformed provider bucket does not discard the other provider's good reading", () => {
  const good = reading(60, T0);
  const mixed = { codex: good, claudeAgent: { remaining: "lots", windows: [], at: "now" } };
  assert.deepEqual(Object.keys(validBuckets(mixed)), ["codex"]);
  assert.deepEqual(validBuckets(null), {});
});

test("a failed or empty re-read keeps the last good reading, retries after a minute, and is never run twice at once", async () => {
  let now = T0; const reads: Array<Usage | Error> = [{ codex: reading(60, T0), claudeAgent: reading(50, T0) }, new Error("native usage timed out"), {}, { codex: reading(55, T0 + 600_000), claudeAgent: reading(50, T0 + 600_000) }];
  let calls = 0; const changes: string[] = [];
  const tracker = createCapacityTracker(async () => { const next = reads[calls++]!; if (next instanceof Error) throw next; return next; }, { now: () => now, onChange: report => changes.push(JSON.stringify(report.status)) });
  await tracker.usage();
  assert.deepEqual(tracker.report().status, { codex: "ok", claude: "ok" });
  now += 4 * 60_000; await tracker.usage(); assert.equal(calls, 1, "steady interval is five minutes");
  now += 61_000; await tracker.usage(); assert.equal(calls, 2);
  assert.deepEqual(tracker.report().status, { codex: "ok", claude: "ok" }, "failed read keeps the last good reading");
  now += 5 * 60_000; await Promise.all([tracker.usage(), tracker.usage(), tracker.refresh()]); assert.equal(calls, 3, "concurrent callers share one probe");
  assert.deepEqual(tracker.report().status, { codex: "ok", claude: "ok" });
  // Past the shared 30-minute fence a missing re-read is stale, so capacity is dropped rather than invented, and retried every minute.
  now += 40 * 60_000; await tracker.usage(); assert.equal(calls, 4);
  assert.deepEqual(tracker.report().status, { codex: "stale", claude: "stale" });
  assert.deepEqual(changes, [JSON.stringify({ codex: "ok", claude: "ok" }), JSON.stringify({ codex: "stale", claude: "stale" })], "only changes are announced");
});

test("a stale reading becomes unknown and cannot block a native request", async () => {
  let now = T0; let calls = 0;
  const tracker = createCapacityTracker(async (): Promise<Usage> => (calls++ === 0 ? { codex: reading(60, T0) } : {}), { now: () => now });
  await tracker.usage();
  assert.equal(tracker.report().status.codex, "ok"); assert.equal(tracker.report().status.claude, "unreadable");
  now += 29 * 60_000; await tracker.usage();
  now += 2 * 60_000; await tracker.usage();
  assert.equal(tracker.report().status.codex, "stale");
  assert.equal(nativeSubscriptionBlocked(tracker.snapshot(), "codex", undefined, now), false);
  assert.ok(calls >= 3, "unreadable providers are retried every minute, not every five");
});
