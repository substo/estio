import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson, normalizeLegacyLibrary } from "../lib/studio/import/legacy-library";
import { main, validateImportManifest } from "./studio-import-apply";

const workspaceId = "70000000-0000-0000-0000-000000000001";
const ownerId = "user_fixture_owner";

function fixture() {
  const source = { version: 1, records: [
    { id: "80000000-0000-0000-0000-000000000001", kind: "reference", title: "Original source", linkedIds: ["80000000-0000-0000-0000-000000000002"], transcript: "Words\nexactly", approved: false },
    { id: "80000000-0000-0000-0000-000000000002", kind: "channel", title: "Channel" },
  ], files: [{ id: "90000000-0000-0000-0000-000000000001", recordId: "80000000-0000-0000-0000-000000000001", name: "own.mov", size: 42, type: "video/quicktime" }] };
  const normalized = normalizeLegacyLibrary(source);
  return { ...normalized, mode: "dry-run" as const, mediaReady: true,
    media: normalized.files.map((file) => ({ id: file.id, relativePath: file.relativePath, status: "present" as const, actualBytes: 42 })) };
}

test("apply validation rejects tampered projections, relationships, counts, and media evidence", () => {
  assert.equal(validateImportManifest(fixture()).valid, true);
  const wrappers = fixture();
  wrappers.records[0].linkedIds = [];
  assert.throws(() => validateImportManifest(wrappers), /manifest_records_mismatch/);
  const counts = fixture();
  counts.counts.links = 0;
  assert.throws(() => validateImportManifest(counts), /manifest_counts_mismatch/);
  const media = fixture();
  media.media[0].actualBytes = 41;
  assert.throws(() => validateImportManifest(media), /manifest_media_mismatch/);
  const relation = fixture();
  relation.records[0].payload.linkedIds = ["80000000-0000-0000-0000-000000000099"];
  assert.throws(() => validateImportManifest(relation), /manifest_records_mismatch/);
});

test("canonical source snapshot digest rejects consistently edited wrappers and payloads", () => {
  const changed = fixture();
  changed.records[0].payload.transcript = "Edited transcript";
  changed.records[0].payload = structuredClone(changed.records[0].payload);
  changed.records[0].title = "Original source";
  assert.throws(() => validateImportManifest(changed), /manifest_records_mismatch/);

  const rewritten = fixture();
  const snapshot = JSON.parse(rewritten.sourceCanonicalJson);
  snapshot.records[0].transcript = "Edited transcript";
  rewritten.sourceCanonicalJson = canonicalJson(snapshot);
  assert.throws(() => validateImportManifest(rewritten), /manifest_source_digest_mismatch/);
});

async function withFixture(run: (args: string[], manifest: ReturnType<typeof fixture>, calls: Array<{ url: URL; init: RequestInit }>, setResponses: (responses: unknown[]) => void, output: string[]) => Promise<void>) {
  const folder = await mkdtemp(path.join(tmpdir(), "studio-import-apply-test-"));
  const manifest = fixture();
  const file = path.join(folder, "manifest.json");
  const bytes = JSON.stringify(manifest);
  await writeFile(file, bytes, { mode: 0o600 });
  const args = ["--manifest", file, "--workspace", workspaceId, "--owner-user-id", ownerId, "--expected-sha256", createHash("sha256").update(bytes).digest("hex"), "--apply"];
  const calls: Array<{ url: URL; init: RequestInit }> = [];
  const output: string[] = [];
  let responses: unknown[] = [];
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const previousUrl = process.env.STUDIO_SUPABASE_URL;
  const previousKey = process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY;
  process.env.STUDIO_SUPABASE_URL = "https://fixture.example.invalid";
  process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY = "fixture-service-secret";
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: new URL(String(input)), init });
    assert.ok(responses.length, "Unexpected network request");
    return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  console.log = (value: unknown) => output.push(String(value));
  try { await run(args, manifest, calls, (values) => { responses = values; }, output); }
  finally {
    globalThis.fetch = previousFetch;
    console.log = previousLog;
    if (previousUrl === undefined) delete process.env.STUDIO_SUPABASE_URL; else process.env.STUDIO_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY; else process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY = previousKey;
    await rm(folder, { recursive: true, force: true });
  }
}

test("pinned manifest bytes are checked before any fetch", async () => {
  await withFixture(async (args, _manifest, calls) => {
    args[7] = "0".repeat(64);
    await assert.rejects(main(args), /manifest_hash_mismatch/);
    assert.equal(calls.length, 0);
  });
});

test("Estio targets and mismatched owners cannot reach the import RPC", async () => {
  await withFixture(async (args, _manifest, calls, setResponses) => {
    setResponses([[{ id: workspaceId, brand: "estio", workspace_type: "estio_location" }]]);
    await assert.rejects(main(args), /target_is_not_substo_workspace/);
    assert.equal(calls.length, 1);
    calls.length = 0;
    setResponses([[{ id: workspaceId, brand: "substo", workspace_type: "substo_standalone" }], []]);
    await assert.rejects(main(args), /target_owner_mismatch/);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => !call.url.pathname.includes("rpc")));
  });
});

test("successful mocked import reconciles counts and reports pending media without content or secrets", async () => {
  await withFixture(async (args, manifest, calls, setResponses, output) => {
    const result = { runId: "70000000-0000-0000-0000-000000000002", workspaceId, sourceDigest: manifest.sourceDigest, counts: manifest.counts, mediaPending: 1, replayed: false };
    const prefix = [[{ id: workspaceId, brand: "substo", workspace_type: "substo_standalone" }], [{ clerk_user_id: ownerId, role: "owner" }]];
    setResponses([...prefix, result]);
    await main(args);
    assert.equal(calls.length, 3);
    const request = JSON.parse(String(calls[2].init.body));
    assert.equal(request.p_workspace_id, workspaceId);
    assert.equal(request.p_owner_clerk_user_id, ownerId);
    assert.deepEqual(request.p_manifest.records[0].payload, manifest.records[0].payload);
    assert.deepEqual(JSON.parse(output[0]).counts, manifest.counts);
    assert.equal(JSON.parse(output[0]).mediaPending, 1);
    assert.ok(!output[0].includes("Words") && !output[0].includes("fixture-service-secret"));
    setResponses([...prefix, { ...result, counts: { ...manifest.counts, files: 0 } }]);
    await assert.rejects(main(args), /remote_counts_did_not_reconcile/);
  });
});
