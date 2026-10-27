import assert from "node:assert/strict";
import test from "node:test";
import { checkStudioReadiness, hasReadyWorker, readReadinessSnapshot, STUDIO_WORKER_HANDLERS, studioReadinessRequired, type ReadinessSnapshot } from "./readiness";
import { checkStudioMediaTools } from "./readiness-runtime";
import { StudioRestError } from "./rest-client";
const env = { NODE_ENV: "test", STUDIO_SUPABASE_URL: "https://studio.example", STUDIO_SUPABASE_SERVICE_ROLE_KEY: "synthetic-role",
 STUDIO_R2_ENDPOINT: "https://r2.example", STUDIO_R2_ACCESS_KEY_ID: "synthetic-access", STUDIO_R2_SECRET_ACCESS_KEY: "synthetic-secret", STUDIO_R2_BUCKET_NAME: "studio-media",
 STUDIO_SECRETS_KEY: Buffer.alloc(32, 1).toString("base64") } as const;
const snapshot = (): ReadinessSnapshot => ({ schema: 27, protocol: 1, checkedAt: "2026-10-24T12:00:00Z", keyIds: ["v1"],
 queue: { due: 5, oldestDueAt: "2026-10-24T11:00:00Z", expiredLeases: 1, uncertainAttempts: 2 },
 workers: [{ release: "release-a", instance_id: "instance-a", protocol: 1, handlers: [...STUDIO_WORKER_HANDLERS], healthy: true, draining: false,
 seen_at: "2026-10-24T11:59:59Z", started_at: "2026-10-24T11:00:00Z" }] });
function deps() { return { mode: "worker" as const, env, release: "release-a", instanceId: "instance-a", startedAfter: Date.parse("2026-10-24T10:59:59Z"), snapshot: async () => snapshot(), media: async () => {}, tools: async () => {} }; }
test("Business-only dormancy probes nothing; any Studio database or hostname configuration requires readiness", async () => {
 assert.equal(studioReadinessRequired({ NODE_ENV: "test", STUDIO_R2_BUCKET_NAME: "dormant", STUDIO_SECRETS_KEY: "dormant" }), false);
 for (const e of [{ STUDIO_SUPABASE_URL: "invalid" }, { STUDIO_SUPABASE_SERVICE_ROLE_KEY: "partial" }, { SUBSTO_APP_HOSTS: "substo.com" }, { STUDIO_READINESS_REQUIRED: "0" }]) assert.equal(studioReadinessRequired({ NODE_ENV: "test", ...e }), true);
 const d = deps(); const no = async () => { throw new Error("must not probe"); };
 assert.deepEqual(await checkStudioReadiness({ ...d, env: { NODE_ENV: "test" }, snapshot: no, tools: no, media: no }), { required: false, ready: true, checks: [] });
});
test("healthy expected release/instance returns only sanitized checks and queue counts; busy/uncertain queue is diagnostic", async () => {
 const result = await checkStudioReadiness(deps()); assert.equal(result.ready, true); assert.equal(result.queue?.due, 5);
 const serialized = JSON.stringify(result); for (const secret of [env.STUDIO_SECRETS_KEY, env.STUDIO_R2_ACCESS_KEY_ID, env.STUDIO_SUPABASE_URL, "instance-a"]) assert.ok(!serialized.includes(secret));
});
test("missing config, wrong schema, R2 denial, missing tools, absent old encryption keys and hung probes fail closed", async () => {
 for (const field of ["STUDIO_SUPABASE_URL", "STUDIO_SECRETS_KEY", "STUDIO_R2_SECRET_ACCESS_KEY"]) {
  const result = await checkStudioReadiness({ ...deps(), env: { ...env, [field]: "" } }); assert.equal(result.ready, false);
 }
 for (const field of ["snapshot", "media", "tools"] as const) {
  const result = await checkStudioReadiness({ ...deps(), [field]: async () => { throw new Error("secret must not escape"); } });
  assert.equal(result.ready, false); assert.ok(!JSON.stringify(result).includes("secret must not escape"));
 }
 assert.equal((await checkStudioReadiness({ ...deps(), snapshot: async () => ({ ...snapshot(), schema: 26 }) })).ready, false);
 assert.equal((await checkStudioReadiness({ ...deps(), snapshot: async () => ({ ...snapshot(), keyIds: ["missing"] }) })).ready, false);
 let aborted = false;
 const result = await checkStudioReadiness({ ...deps(), timeoutMs: 10, media: async signal => { signal.addEventListener("abort", () => { aborted = true; }); await new Promise<void>(() => {}); } });
 assert.equal(result.ready, false); assert.equal(aborted, true);
});
test("stale/future/legacy/draining/incapable/unhealthy workers and wrong build or process never satisfy readiness", () => {
 for (const patch of [{ release: "old" }, { instance_id: "old" }, { protocol: 0 }, { healthy: false }, { draining: true }, { handlers: ["studio.diagnostic"] },
  { seen_at: "2026-10-24T11:58:00Z" }, { seen_at: "2026-10-24T13:00:00Z" }, { started_at: "invalid" }]) {
  const s = snapshot(); Object.assign(s.workers[0], patch); assert.equal(hasReadyWorker(s, "release-a", "instance-a"), false, JSON.stringify(patch));
 }
 const s = snapshot(); s.workers = []; assert.equal(hasReadyWorker(s, "release-a"), false);
});
test("snapshot shape is bounded and validates operational fields", () => {
 for (const value of [null, {}, { ...snapshot(), keyIds: [null] }, { ...snapshot(), workers: Array(101).fill({}) }, { ...snapshot(), queue: { ...snapshot().queue, due: -1 } }]) assert.throws(() => readReadinessSnapshot(value));
});
test("real local media codec/probe/temp check passes without network or customer data", async () => {
 await checkStudioMediaTools(AbortSignal.timeout(10_000), { NODE_ENV: "test", STUDIO_MIN_FREE_BYTES: String(64 * 1024 ** 2) });
 await assert.rejects(checkStudioMediaTools(AbortSignal.timeout(10_000), { NODE_ENV: "test", STUDIO_MIN_FREE_BYTES: "invalid" }), /invalid_minimum/);
});

test("a prior PM2 process report cannot qualify after automatic restart under the same launch instance", async () => {
 const d = deps();
 assert.equal((await checkStudioReadiness({ ...d, startedAfter: Date.parse("2026-10-24T11:00:01Z") })).ready, false);
 assert.equal((await checkStudioReadiness({ ...d, startedAfter: undefined })).ready, false);
 assert.equal(hasReadyWorker(snapshot(), "release-a", "instance-a", Date.parse("2026-10-24T10:59:59Z")), true);
});
test("an explicit provider restriction deploys degraded; every other database failure still blocks", async () => {
 const restricted = async () => { throw new StudioRestError(402, undefined, true); };
 for (const mode of ["dependencies", "worker"] as const) {
  const result = await checkStudioReadiness({ ...deps(), mode, snapshot: restricted });
  assert.equal(result.ready, true); assert.equal(result.degraded, "studio_provider_restricted");
  assert.ok(!result.checks.some(c => c.name === "database_schema" || c.name === "worker"));
 }
 // The degraded path never hides media, tool or configuration failures.
 assert.equal((await checkStudioReadiness({ ...deps(), snapshot: restricted, media: async () => { throw new Error("r2"); } })).ready, false);
 assert.equal((await checkStudioReadiness({ ...deps(), snapshot: restricted, env: { ...env, STUDIO_SECRETS_KEY: "" } })).ready, false);
 const blocking = [
  async () => { throw new StudioRestError(402); },
  async () => { throw new StudioRestError(503); },
  async () => { throw new StudioRestError(500, "PGRST"); },
  async () => ({ ...snapshot(), schema: 26 }),
  () => new Promise(() => {}),
 ];
 for (const probe of blocking) {
  const result = await checkStudioReadiness({ ...deps(), mode: "dependencies", snapshot: probe, timeoutMs: 50 });
  assert.equal(result.ready, false); assert.equal(result.degraded, undefined);
 }
});
