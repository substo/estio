import assert from "node:assert/strict";
import test from "node:test";
import { StudioJobError, studioJobHandlers, type StudioJobHandler } from "./handlers";
import type { StudioJob, StudioQueue } from "./queue";
import { runStudioJob, runStudioWorker } from "./runner";

const job = (id: string, kind = "studio.diagnostic"): StudioJob => ({ id, lease_token: "token", location_id: "w", kind, payload: {}, attempts: 1, max_attempts: 5 });
function fakeQueue(jobs: StudioJob[], options: { extend?: boolean } = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const queue: StudioQueue = {
    async claim(workerId, limit) { calls.push(["claim", limit]); return jobs.splice(0, limit); },
    async extend(id) { calls.push(["extend", id]); return options.extend ?? true; },
    async complete(id, _w, result) { calls.push(["complete", id, result]); return true; },
    async fail(id, _w, failure) { calls.push(["fail", id, failure]); return failure.retryable ? "retry_scheduled" : "failed"; },
    async heartbeat() { calls.push(["heartbeat"]); },
  };
  return { queue, calls };
}

test("success, classified failure, unknown kind and unexpected errors are recorded correctly", async () => {
  const handlers: Record<string, StudioJobHandler> = {
    ok: async () => ({ done: true }),
    limited: async () => { throw new StudioJobError("provider_rate_limited", "OpenAI rate limit", true, 90); },
    bad: async () => { throw new StudioJobError("invalid_input", "Bad input", false); },
    crash: async () => { throw new Error("sk-secret leaked in message"); },
  };
  const { queue, calls } = fakeQueue([]);
  for (const kind of ["ok", "limited", "bad", "crash", "missing"]) await runStudioJob(job(kind, kind), { queue, handlers, workerId: "w1" });
  assert.deepEqual(calls.filter(c => c[0] !== "extend"), [
    ["complete", "ok", { done: true }],
    ["fail", "limited", { code: "provider_rate_limited", message: "OpenAI rate limit", retryable: true, retryAfterSeconds: 90 }],
    ["fail", "bad", { code: "invalid_input", message: "Bad input", retryable: false, retryAfterSeconds: undefined }],
    ["fail", "crash", { code: "unexpected_error", message: "The worker hit an unexpected error. It will retry.", retryable: true }],
    ["fail", "missing", { code: "unknown_job_kind", message: "This job type is not supported by the worker.", retryable: false, retryAfterSeconds: undefined }],
  ]);
});

test("a lost lease aborts the running handler", async () => {
  const { queue } = fakeQueue([], { extend: false });
  let aborted = false;
  const slow: StudioJobHandler = (_job, context) => new Promise(resolve => context.signal.addEventListener("abort", () => { aborted = true; resolve({}); }));
  await runStudioJob(job("slow", "slow"), { queue, handlers: { slow }, workerId: "w1", leaseSeconds: 3 });
  assert.equal(aborted, true);
});

test("worker loop heartbeats, respects concurrency, runs the diagnostic job and drains on shutdown", async () => {
  const { queue, calls } = fakeQueue([job("a"), job("b"), job("c")]);
  const controller = new AbortController();
  const done = runStudioWorker({ queue, handlers: studioJobHandlers, workerId: "w1", concurrency: 2, signal: controller.signal,
    sleep: async () => { if (calls.filter(c => c[0] === "complete").length === 3) controller.abort(); await new Promise(r => setTimeout(r, 1)); } });
  await done;
  assert.equal(calls[0][0], "heartbeat");
  assert.ok(calls.filter(c => c[0] === "claim").every(c => (c[1] as number) <= 2));
  const completed = calls.filter(c => c[0] === "complete");
  assert.deepEqual(completed.map(c => c[1]).sort(), ["a", "b", "c"]);
  assert.equal((completed[0][2] as { ok: boolean }).ok, true);
});


test("renewal transport failures abort work and never report completion", async () => {
  const { queue, calls } = fakeQueue([]);
  queue.extend = async () => { throw new Error("database unavailable"); };
  let observedAbort = false;
  const slow: StudioJobHandler = async (_job, context) => {
    await new Promise(resolve => setTimeout(resolve, 1100));
    observedAbort = context.signal.aborted;
    return {};
  };
  await runStudioJob(job("slow", "slow"), { queue, handlers: { slow }, workerId: "w1", leaseSeconds: 3 });
  assert.equal(observedAbort, true);
  assert.equal(calls.some(c => c[0] === "complete"), false);
});

test("a hung renewal cannot extend work beyond the last confirmed lease", async () => {
  const { queue, calls } = fakeQueue([]);
  queue.extend = async () => new Promise<boolean>(() => {});
  let observedAbort = false;
  const slow: StudioJobHandler = (_job, context) => new Promise(resolve => {
    context.signal.addEventListener("abort", () => { observedAbort = true; resolve({}); }, { once: true });
  });
  await runStudioJob(job("hung", "slow"), { queue, handlers: { slow }, workerId: "w1", leaseSeconds: 3 });
  assert.equal(observedAbort, true);
  assert.equal(calls.some(c => c[0] === "complete" || c[0] === "fail"), false);
});

test("expired claims do not start a handler", async () => {
  const { queue, calls } = fakeQueue([]);
  let started = false;
  await runStudioJob({ ...job("expired", "check"), lease_expires_at: new Date(0).toISOString() }, {
    queue, handlers: { check: async () => { started = true; return {}; } }, workerId: "w1" });
  assert.equal(started, false);
  assert.equal(calls.length, 0);
});

test("saturated workers heartbeat independently and withdraw readiness before draining long jobs", async () => {
  const { queue } = fakeQueue([job("long-a", "slow"), job("long-b", "slow")]);
  const reports: Array<{ healthy: boolean; draining: boolean }> = [];
  queue.heartbeat = async (_worker, _release, _started, report) => { if (report) reports.push(report); };
  const controller = new AbortController();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started = 0, completed = 0;
  const done = runStudioWorker({ queue, handlers: { slow: async () => { started++; await gate; completed++; return {}; } },
    workerId: "w1", release: "release-a", report: { instanceId: "instance-a", handlers: ["slow"] },
    concurrency: 2, pollMs: 2, heartbeatMs: 10, signal: controller.signal });
  try {
    for (let n = 0; n < 100 && reports.filter(r => r.healthy).length < 3; n++) await new Promise(r => setTimeout(r, 5));
    assert.equal(started, 2); assert.equal(completed, 0); assert.ok(reports.filter(r => r.healthy).length >= 3);
    assert.equal(reports[0].healthy, false); // Claim path not proven yet.
    controller.abort();
    for (let n = 0; n < 100 && !reports.at(-1)?.draining; n++) await new Promise(r => setTimeout(r, 2));
    assert.equal(reports.at(-1)?.draining, true); assert.equal(reports.at(-1)?.healthy, false); assert.equal(completed, 0);
  } finally { controller.abort(); release(); await done; }
  assert.equal(completed, 2);
});

test("heartbeat failure blocks claims until confirmed; failed claims withdraw readiness", async () => {
  const { queue, calls } = fakeQueue([]); const controller = new AbortController(); let pulses = 0;
  queue.heartbeat = async (_w, _r, _s, report) => {
    pulses++; if (pulses === 1) throw new Error("offline");
    if (pulses === 2) assert.equal(calls.filter(c => c[0] === "claim").length, 0);
    if (pulses >= 3) { assert.equal(report?.healthy, false); controller.abort(); }
  };
  queue.claim = async () => { calls.push(["claim"]); controller.abort(); throw new Error("claim unavailable"); };
  await runStudioWorker({ queue, handlers: {}, workerId: "w1", release: "release-a", report: { instanceId: "instance-a", handlers: ["studio.diagnostic"] },
    pollMs: 2, heartbeatMs: 10, signal: controller.signal });
  assert.equal(calls.filter(c => c[0] === "claim").length, 1); assert.ok(pulses >= 3);
});

test("an idle queue is polled less often up to the cap, and found work resets it", async () => {
  const batches: StudioJob[][] = [[], [], [], [], [], [job("a")], [], []];
  const { queue } = fakeQueue([]);
  queue.claim = async () => batches.shift() ?? [];
  const controller = new AbortController();
  const delays: number[] = [];
  await runStudioWorker({ queue, handlers: { "studio.diagnostic": async () => ({}) }, workerId: "w1", pollMs: 100, idlePollMaxMs: 400, heartbeatMs: 60_000,
    signal: controller.signal, sleep: async (ms) => { delays.push(ms); if (delays.length === 8) controller.abort(); } });
  // Equal jitter keeps each delay within [cap/2, cap]: 100, 200, 400, 400, 400; the claim polls again at once, then the streak restarts.
  const caps = [100, 200, 400, 400, 400, 100, 200, 400];
  assert.equal(delays.length, 8);
  delays.forEach((ms, i) => assert.ok(ms >= caps[i] / 2 && ms <= caps[i], `delay ${i}: ${ms} not within ${caps[i]}`));
});

test("failed claims back off up to the failure cap", async () => {
  const { queue } = fakeQueue([]);
  queue.claim = async () => { throw new Error("database unavailable"); };
  const controller = new AbortController();
  const delays: number[] = [];
  await runStudioWorker({ queue, handlers: {}, workerId: "w1", pollMs: 100, failurePollMaxMs: 800, heartbeatMs: 60_000,
    signal: controller.signal, sleep: async (ms) => { delays.push(ms); if (delays.length === 6) controller.abort(); } });
  const caps = [200, 400, 800, 800, 800, 800];
  delays.forEach((ms, i) => assert.ok(ms >= caps[i] / 2 && ms <= caps[i], `delay ${i}: ${ms} not within ${caps[i]}`));
});
