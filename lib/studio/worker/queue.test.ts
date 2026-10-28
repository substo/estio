import assert from "node:assert/strict";
import test from "node:test";
import type { StudioDb } from "../db";
import { createDbStudioQueue } from "./queue";

test("queue sends the claim generation with every lease mutation", async () => {
  const requests: Array<{ name: string; body: Record<string, unknown> }> = [];
  const queue = createDbStudioQueue({ call: async (name, body) => {
    requests.push({ name, body: body ?? {} });
    return true;
  } } as StudioDb);
  await queue.extend("j", "w", 120, "claim");
  await queue.complete("j", "w", { ok: true }, "claim");
  await queue.fail("j", "w", { code: "failed", message: "Failed", retryable: false }, "claim");
  assert.deepEqual(requests.map(r => r.name), ["studio_extend_job_lease", "studio_complete_job", "studio_fail_job"]);
  assert.ok(requests.every(r => r.body.p_lease_token === "claim" && r.body.p_worker_id === "w" && r.body.p_job_id === "j"));
});

test("capable reports carry exact process instance, release and drain/claim state", async () => {
  let body: Record<string, unknown> = {};
  const queue = createDbStudioQueue({ call: async (name, args) => {
    assert.equal(name, "studio_report_worker"); body = args ?? {}; return null;
  } } as StudioDb);
  await queue.heartbeat("worker-a", "release-a", new Date("2026-10-24T00:00:00Z"), { instanceId: "instance-a", handlers: ["studio.diagnostic"], healthy: false, draining: true });
  assert.deepEqual(body, { p_worker_id: "worker-a", p_release: "release-a", p_started_at: "2026-10-24T00:00:00.000Z",
    p_instance_id: "instance-a", p_handlers: ["studio.diagnostic"], p_healthy: false, p_draining: true });
});
