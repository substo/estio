import { test } from "node:test";
import assert from "node:assert/strict";
import { dispatchDueStudioSchedules, type DueSchedule } from "./schedule-dispatcher";
import { authorizeScheduledTextJob, authorizeEstioSchedule } from "./schedule-authority";
const due: DueSchedule = { workspace_id: "w", schedule_id: "s", activation_token: "a", next_run_at: "2026-10-24T00:00:00Z", actor_brand: "substo", authorized_by: "owner" };
test("bounded dispatch binds exact due/token identities; SQL handles Substo authority", async () => {
  const calls: Array<{ path: string; body: any }> = [];
  const result = await dispatchDueStudioSchedules({ now: new Date("2026-10-24T01:00:00Z"),
    rest: async <T>(path: string, init?: RequestInit) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      return (init ? { outcome: "queued" } : [due]) as T;
    }, authorizeEstio: async () => { throw Error("Substo must not use Business authority"); } });
  const query = new URLSearchParams(calls[0].path.split("?")[1]);
  assert.equal(query.get("enabled"), "eq.true"); assert.equal(query.get("limit"), "25");
  assert.equal(query.get("next_run_at"), "lte.2026-10-24T01:00:00.000Z");
  assert.equal(calls[1].body.p_activation_token, "a"); assert.equal(calls[1].body.p_due_at, due.next_run_at);
  assert.deepEqual(result, { examined: 1, outcomes: { queued: 1 } });
});
test("confirmed Estio denial reaches SQL for pause; authority outages leave due work retryable", async () => {
  let dispatched = 0;
  for (const outage of [false, true]) {
    const result = await dispatchDueStudioSchedules({ rest: async <T>(_path: string, init?: RequestInit) => {
      if (!init) return [{ ...due, actor_brand: "estio" }] as T;
      dispatched++; assert.equal(JSON.parse(String(init.body)).p_estio_authorized, false);
      return { outcome: "authority_revoked" } as T;
    }, authorizeEstio: async () => { if (outage) throw Error("Database unavailable"); return false; } });
    assert.equal(result.outcomes[outage ? "unconfirmed" : "authority_revoked"], 1);
  }
  assert.equal(dispatched, 1);
});
test("scheduled paid checks bind persisted realm/author/workspace and reject missing Estio mappings", async () => {
  let actor = "estio"; let mapping: string | null = "location"; let called = 0;
  const rest = async <T>(path: string) => (path.startsWith("platform_profile_deletions") ? [] : path.startsWith("studio_schedule_executions")
    ? [{ actor_brand: actor, created_by_clerk_user_id: "persisted-author" }]
    : [{ brand: "estio", estio_location_id: mapping }]) as T;
  const check = async (user: string, location: string) => { called++; assert.equal(user, "persisted-author"); assert.equal(location, "location"); return false; };
  assert.equal(await authorizeScheduledTextJob(rest, "w", "j", check), false);
  actor = "substo";
  assert.equal(await authorizeScheduledTextJob(rest, "w", "j", check), true);
  mapping = null;
  assert.equal(await authorizeEstioSchedule(rest, "w", "persisted-author", check), false);
  assert.equal(called, 1);
  assert.equal(await authorizeScheduledTextJob(async <T>() => [] as T, "w", "j", check), true);
});
