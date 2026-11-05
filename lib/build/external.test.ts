import test from "node:test";
import assert from "node:assert/strict";
import { externalCommand, externalId, trackExternal } from "./external";
const threadId = "73b15758-ef2d-45c2-9055-69d72ce849f6";
test("external updates require revision and result evidence; reject execution fields", () => {
  const update = { threadId, revision: 1, status: "working", note: "Implementing" };
  assert.ok(externalCommand.safeParse(update).success);
  assert.ok(!externalCommand.safeParse({ ...update, status: "done" }).success);
  assert.ok(!externalCommand.safeParse({ ...update, approval: true }).success);
  assert.ok(!externalCommand.safeParse({ threadId, status: "working", note: "Scope missing" }).success);
});
test("external updates preserve identity and never claim a worker lease", async () => {
  let written: any;
  const tx: any = { buildJob: {
    findUnique: async () => ({ revision: 2, state: "external-working", checkpoint: {} }),
    update: async (v: any) => { written = v; return { ...v.data, revision: 3 }; },
  } };
  const command = externalCommand.parse({ threadId, revision: 2, status: "blocked", note: "Needs runtime acceptance" });
  const result = await trackExternal(tx, command);
  assert.equal(result.id, externalId(threadId));
  assert.equal(written.data.state, "external-blocked");
  for (const key of ["approval", "leaseToken", "leaseUntil", "workerId", "attempt"]) assert.ok(!(key in written.data));
  await assert.rejects(trackExternal(tx, { ...command, revision: 1 }), /conflict/);
  tx.buildJob.findUnique = async () => ({ revision: 2, state: "working" });
  await assert.rejects(trackExternal(tx, command), /conflict/);
});
test("registration uses stable ledger key, and duplicate registration cannot overwrite scope", async () => {
  let record: any;
  const tx: any = { buildJob: {
    findUnique: async () => record,
    create: async ({ data }: any) => { record = { ...data, revision: 1 }; return record; },
  } };
  const spec = { title: "Library", outcome: "Cards", reason: "Owner request", scope: ["lib/studio/"], nodeIds: [], acceptance: ["Cards render"], baseRevision: "a".repeat(40), endpoint: "review", taskType: "implementation", profileId: "external-t3", quality: 3, tools: ["code-write"], owner: "estio-build" };
  const command = externalCommand.parse({ threadId, spec, status: "working", note: "Already executing" });
  const result = await trackExternal(tx, command);
  assert.equal(record.key, result.id);
  assert.equal(record.state, "external-working");
  assert.equal(record.approval, undefined);
  await assert.rejects(trackExternal(tx, command), /conflict/);
  await assert.rejects(trackExternal(tx, { ...command, revision: 1 }), /immutable/);
});
