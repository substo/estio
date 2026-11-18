import test from "node:test";
import assert from "node:assert/strict";
import type { StudioDb } from "./db";
import { createSourceIdeaService } from "./source-idea-service";
const sourceId = "10000000-0000-4000-8000-000000000001";
const ideaId = "20000000-0000-4000-8000-000000000002";
function setup({ allowed = true, impersonating = false, sourceExists = true, failLink = false } = {}) {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  let committed = false, rolledBack = false;
  const db = {
    one: async (query: { values: unknown[] }) => { assert.ok(query.values.includes("authorized-location")); return sourceExists ? { id: sourceId } : null; },
    call: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "studio_save_record") return { version: 1 };
      if (failLink) throw new Error("link unavailable");
      return { sourceId: ideaId, targetId: sourceId, version: 2, changed: true };
    },
  } as unknown as StudioDb;
  const run = createSourceIdeaService({
    authorize: async () => allowed ? { locationId: "authorized-location", app: "substo", userId: "actor" } : null,
    isImpersonating: async () => impersonating,
    transaction: async callback => { try { const result = await callback(db); committed = true; return result; } catch (error) { rolledBack = true; throw error; } },
  });
  return { run: () => run("untrusted-location", sourceId, ideaId, " Idea ", " Original concept "), calls, state: () => ({ committed, rolledBack }) };
}
test("creates unapproved idea and outgoing source link through existing operations", async () => {
  const fixture = setup(); assert.equal(await fixture.run(), ideaId);
  assert.deepEqual(fixture.calls.map(c => c.fn), ["studio_save_record", "studio_change_record_link"]);
  assert.equal(fixture.calls[0].args?.p_location_id, "authorized-location");
  assert.deepEqual(fixture.calls[0].args?.p_payload_patch, { title: "Idea", summary: "Original concept", stage: "idea", level: "discover", approved: false, archived: false });
  assert.equal(fixture.calls[1].args?.p_source_id, ideaId);
  assert.equal(fixture.calls[1].args?.p_target_id, sourceId);
  assert.equal(fixture.calls[1].args?.p_expected_version, 1);
  assert.equal(fixture.state().committed, true);
});
test("a failed link propagates out of the transaction for rollback", async () => {
  const fixture = setup({ failLink: true }); await assert.rejects(fixture.run());
  assert.deepEqual(fixture.state(), { committed: false, rolledBack: true });
});
test("missing, archived or foreign-location sources cannot create an idea", async () => {
  const fixture = setup({ sourceExists: false }); await assert.rejects(fixture.run()); assert.equal(fixture.calls.length, 0);
});
test("denied access and impersonation cannot write", async () => {
  for (const options of [{ allowed: false }, { impersonating: true }]) {
    const fixture = setup(options); await assert.rejects(fixture.run()); assert.equal(fixture.calls.length, 0);
  }
});
