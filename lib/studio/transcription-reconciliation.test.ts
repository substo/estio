import assert from "node:assert/strict";
import test from "node:test";
import { canReviewTranscription, readReconciliationCommand, reconciliationCostMicros } from "./transcription-reconciliation-policy";

const command = { requestId: "d4000000-0000-4000-8000-000000000001", attemptId: "d5000000-0000-4000-8000-000000000001",
  expectedVersion: 1, action: "no_charge", evidence: "Provider support case 123 confirms no processing or charge.", costMicros: 0, confirmPaid: false };

test("reconciliation needs precise evidence and a versioned idempotent request", () => {
  assert.deepEqual(readReconciliationCommand(command), command);
  for (const patch of [{ expectedVersion: 0 }, { expectedVersion: 1.5 }, { requestId: "bad" }, { attemptId: "bad" },
    { evidence: "timeout" }, { evidence: "x".repeat(2001) }, { evidence: "Key sk-abcdefghijklmnopqrstuvwxy is private" },
    { action: "release" }, { action: "no_charge", costMicros: 1 }, { action: "billed", costMicros: 0 },
    { action: "billed", costMicros: 0.1 }, { action: "billed", costMicros: 100_000_000_001 }, { confirmPaid: true }]) {
    assert.throws(() => readReconciliationCommand({ ...command, ...patch }));
  }
  assert.equal(readReconciliationCommand({ ...command, action: "billed", costMicros: 600 }).costMicros, 600);
});

test("replacement requires a separate explicit paid authorization", () => {
  const replacement = { ...command, action: "authorize_replacement", costMicros: null, confirmPaid: true };
  assert.equal(readReconciliationCommand(replacement).action, "authorize_replacement");
  assert.throws(() => readReconciliationCommand({ ...replacement, confirmPaid: false }));
  assert.throws(() => readReconciliationCommand({ ...replacement, costMicros: 0 }));
});

test("confirmed costs retain sub-cent precision without floating point conversion", () => {
  assert.equal(reconciliationCostMicros("0.000001"), 1);
  assert.equal(reconciliationCostMicros("0.006"), 6000);
  assert.equal(reconciliationCostMicros("100000"), 100_000_000_000);
  for (const bad of ["1e2", "-1", "1.0000001", "100000.000001", "NaN"]) assert.throws(() => reconciliationCostMicros(bad));
});

import { transcriptionReviewResponse } from "./transcription-reconciliation-http";
import { ReconciliationError } from "./transcription-reconciliation-policy";
import { StudioDbError as StudioRestError } from "./db";
const request = (body: unknown, origin: string | null = "https://substo.com", contentType = "application/json") => new Request("https://substo.com/studio/review", {
  method: "POST", headers: { ...(origin ? { origin } : {}), "content-type": contentType }, body: JSON.stringify(body) });

test("review endpoint denies unsigned, cross-origin and unauthorized manager writes", async () => {
  let writes = 0;
  const execute = async () => { writes++; return {}; };
  assert.equal((await transcriptionReviewResponse(request(command), { profile: async () => null, execute })).status, 401);
  for (const origin of [null, "https://estio.co", "https://evil.example"]) {
    assert.equal((await transcriptionReviewResponse(request(command, origin), { profile: async () => ({ origin: "https://substo.com" }), execute })).status, 403);
  }
  assert.equal(writes, 0);
  const denied = await transcriptionReviewResponse(request(command), { profile: async () => ({ origin: "https://substo.com" }),
    execute: async () => { throw new ReconciliationError("Manager required.", 403); } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("cache-control"), "private, no-store");
});

test("bounded review endpoint returns explicit conflicts and safe uncertain responses", async () => {
  const profile = async () => ({ origin: "https://substo.com" });
  let received: unknown;
  const execute = async (body: unknown) => { received = body; return { ok: true }; };
  assert.equal((await transcriptionReviewResponse(request(command), { profile, execute })).status, 200);
  assert.deepEqual(received, command);
  assert.equal((await transcriptionReviewResponse(request({ ...command, evidence: "x".repeat(20_000) }), { profile, execute })).status, 413);
  assert.equal((await transcriptionReviewResponse(request(command, "https://substo.com", "text/plain"), { profile, execute })).status, 415);
  for (const code of ["40001", "23505"]) {
    assert.equal((await transcriptionReviewResponse(request(command), { profile, execute: async () => { throw new StudioRestError(400, code); } })).status, 409);
  }
  const lost = await transcriptionReviewResponse(request(command), { profile, execute: async () => { throw new Error("sk-private internal DB response"); } });
  assert.equal(lost.status, 503);
  assert.ok(!(await lost.text()).includes("sk-private"));
});

test("review authority requires a canonical manager in the same realm and signed-in principal", () => {
 const profile={brand:"substo" as const,userId:"same-id"};
 assert.equal(canReviewTranscription(profile,{app:"substo",userId:"same-id",role:"ADMIN"}),true);
 assert.equal(canReviewTranscription(profile,{app:"substo",userId:"same-id",role:"MEMBER"}),false);
 assert.equal(canReviewTranscription(profile,{app:"estio",userId:"same-id",role:"ADMIN"}),false);
 assert.equal(canReviewTranscription(profile,{app:"substo",userId:"other",role:"ADMIN"}),false);
 assert.equal(canReviewTranscription(null,{app:"substo",userId:"same-id",role:"ADMIN"}),false);
 assert.equal(canReviewTranscription(profile,null),false);
});
