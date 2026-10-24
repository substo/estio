import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson } from "../lib/studio/import/legacy-library";
import { normalizeLegacySchedules } from "../lib/studio/import/legacy-schedules";
import { main, validateScheduleManifest } from "./studio-schedule-apply";

const workspaceId = "86000000-0000-4000-8000-000000000001";
const ownerId = "user_schedule_fixture";
function fixture() {
  const source = { version: 1, unknown: { preserve: true }, schedules: [{
    id: "87000000-0000-4000-8000-000000000001", presetId: "idea-review", query: "PRIVATE_FOCUS", intervalHours: 24,
    dailyTime: "09:00", timeZone: "Asia/Nicosia", enabled: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", nextRunAt: "2026-01-03T07:00:00.000Z",
  }], runs: [{ id: "88000000-0000-4000-8000-000000000001", scheduleId: "87000000-0000-4000-8000-000000000001", presetId: "idea-review", status: "running", startedAt: "2026-01-02T07:00:00.000Z", completedAt: null, output: "PRIVATE_OUTPUT\n exact", error: "PRIVATE_ERROR", jobId: "local-job" }] };
  const bytes = JSON.stringify(source);
  return { ...normalizeLegacySchedules(source), mode: "dry-run", snapshotCheckedUnchanged: true,
    sourceFiles: [{ relativePath: "schedules.json", bytes: Buffer.byteLength(bytes), sha256: createHash("sha256").update(bytes).digest("hex") }] };
}
test("rebuild rejects tampered projections, history, counts, issues and readiness", () => {
  assert.equal(validateScheduleManifest(fixture()).valid, true);
  for (const mutate of [
    (m: ReturnType<typeof fixture>) => { m.schedules[0].draft!.query = "tampered"; },
    (m: ReturnType<typeof fixture>) => { m.runs[0].scheduleId = workspaceId; },
    (m: ReturnType<typeof fixture>) => { m.runs[0].payload = { output: "tampered" }; },
    (m: ReturnType<typeof fixture>) => { m.counts.runs = 0; },
    (m: ReturnType<typeof fixture>) => { m.issues = []; },
    (m: ReturnType<typeof fixture>) => { m.sourceFiles[0].relativePath = "other.json"; },
    (m: ReturnType<typeof fixture>) => { m.valid = false; },
  ]) { const manifest = fixture(); mutate(manifest); assert.throws(() => validateScheduleManifest(manifest), /manifest_/); }
});
test("canonical source digest rejects consistent wrapper edits and noncanonical or invalid source", () => {
  const m = fixture();
  const source = JSON.parse(m.sourceCanonicalJson); source.schedules[0].query = "changed";
  m.sourceCanonicalJson = canonicalJson(source);
  assert.throws(() => validateScheduleManifest(m), /manifest_source_digest_mismatch/);
  const noncanonical = fixture(); noncanonical.sourceCanonicalJson = JSON.stringify(JSON.parse(noncanonical.sourceCanonicalJson), null, 2);
  assert.throws(() => validateScheduleManifest(noncanonical), /manifest_source_not_canonical/);
  const invalid = fixture(); const raw = JSON.parse(invalid.sourceCanonicalJson); raw.runs[0].scheduleId = workspaceId;
  Object.assign(invalid, normalizeLegacySchedules(raw), { valid: true });
  assert.throws(() => validateScheduleManifest(invalid), /manifest_source_invalid/);
});

async function withFixture(run: (context: {
  args: string[]; manifest: ReturnType<typeof fixture>; calls: Array<{ url: URL; init: RequestInit }>;
  responses: unknown[]; output: string[]; file: string; root: string;
}) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "studio-schedule-apply-")));
  const manifest = fixture(); const file = path.join(root, "manifest.json"); const bytes = JSON.stringify(manifest);
  await writeFile(file, bytes, { mode: 0o600 });
  const calls: Array<{ url: URL; init: RequestInit }> = []; const output: string[] = []; const responses: unknown[] = [];
  const args = ["--manifest", file, "--workspace", workspaceId, "--owner-user-id", ownerId, "--expected-sha256", createHash("sha256").update(bytes).digest("hex"), "--apply"];
  const previousFetch = globalThis.fetch; const previousLog = console.log;
  const previousUrl = process.env.STUDIO_SUPABASE_URL; const previousKey = process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY;
  process.env.STUDIO_SUPABASE_URL = "https://fixture.example.invalid"; process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY = "fixture-service-secret";
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: new URL(String(input)), init }); assert.ok(responses.length, "Unexpected network call");
    return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  console.log = value => output.push(String(value));
  try { await run({ args, manifest, calls, responses, output, file, root }); }
  finally {
    globalThis.fetch = previousFetch; console.log = previousLog;
    if (previousUrl === undefined) delete process.env.STUDIO_SUPABASE_URL; else process.env.STUDIO_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY; else process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY = previousKey;
    await rm(root, { recursive: true, force: true });
  }
}
const target = () => [{ id: workspaceId, brand: "substo", workspace_type: "substo_standalone" }];
const owner = () => [{ clerk_user_id: ownerId, role: "owner" }];
test("pin, explicit apply, and symlink safety fail before any remote request", async () => {
  await withFixture(async ({ args, calls, file, root }) => {
    await assert.rejects(main(args.slice(0, -1)), /invalid_arguments/);
    const badPin = [...args]; badPin[7] = "0".repeat(64);
    await assert.rejects(main(badPin), /manifest_hash_mismatch/);
    const link = path.join(root, "alias.json"); await symlink(file, link);
    const aliasArgs = [...args]; aliasArgs[1] = link;
    await assert.rejects(main(aliasArgs), /unsafe_or_oversized_source_file/);
    assert.equal(calls.length, 0);
  });
});
test("wrong target, wrong owner, and wrong workspace response cannot reach RPC", async () => {
  await withFixture(async ({ args, calls, responses }) => {
    responses.push([{ id: workspaceId, brand: "estio", workspace_type: "estio_location" }]);
    await assert.rejects(main(args), /target_is_not_substo_workspace/);
    responses.push(target(), [{ clerk_user_id: "other-owner", role: "owner" }]);
    await assert.rejects(main(args), /target_owner_mismatch/);
    responses.push([{ id: "86000000-0000-4000-8000-000000000099", brand: "substo", workspace_type: "substo_standalone" }]);
    await assert.rejects(main(args), /target_is_not_substo_workspace/);
    assert.ok(calls.every(c => !c.url.pathname.includes("rpc")));
  });
});
test("RPC receives exact metadata and output is whitelisted for both apply and replay", async () => {
  await withFixture(async ({ args, manifest, calls, responses, output }) => {
    for (const replayed of [false, true]) {
      responses.push(target(), owner(), { runId: "86000000-0000-4000-8000-000000000002", workspaceId, sourceDigest: manifest.sourceDigest, counts: manifest.counts, executionEnabled: false, replayed, privateUnexpectedField: "PRIVATE_RESPONSE" });
      await main(args);
      const request = JSON.parse(String(calls.at(-1)!.init.body));
      assert.equal(request.p_workspace_id, workspaceId); assert.equal(request.p_owner_clerk_user_id, ownerId);
      assert.deepEqual(request.p_manifest.runs[0].payload, manifest.runs[0].payload);
      assert.equal(JSON.parse(output.at(-1)!).replayed, replayed);
      assert.doesNotMatch(output.at(-1)!, /PRIVATE_|fixture-service-secret/);
    }
  });
});
test("remote counts or execution mismatch is not reported as success", async () => {
  await withFixture(async ({ args, manifest, responses, output }) => {
    for (const patch of [{ counts: { ...manifest.counts, runs: 0 } }, { executionEnabled: true }, { workspaceId: "wrong" }]) {
      responses.push(target(), owner(), { runId: "86000000-0000-4000-8000-000000000002", workspaceId, sourceDigest: manifest.sourceDigest, counts: manifest.counts, executionEnabled: false, replayed: false, ...patch });
      await assert.rejects(main(args), /remote_counts_did_not_reconcile/);
    }
    assert.equal(output.length, 0);
  });
});

test("unsupported PostgreSQL text is rejected before any fetch rather than cleaned", () => {
  for (const text of ["nul\u0000text", "unpaired\ud800text"]) {
    const m = fixture(); const source = JSON.parse(m.sourceCanonicalJson);
    source.unknown = { text };
    Object.assign(m, normalizeLegacySchedules(source));
    assert.throws(() => validateScheduleManifest(m), /manifest_database_text_unsupported/);
  }
});
