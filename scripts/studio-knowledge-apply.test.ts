import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson, normalizeLegacyLibrary } from "../lib/studio/import/legacy-library";
import { canonicalKnowledgeJson, normalizeLegacyKnowledge } from "../lib/studio/import/legacy-knowledge";
import { main, validateKnowledgeApplyManifest } from "./studio-knowledge-apply";

const workspaceId = "70000000-0000-0000-0000-000000000001";
const ownerId = "user_fixture_owner";
const sourceId = "80000000-0000-0000-0000-000000000001";

function fixture() {
  const librarySource = { version: 1, records: [{ id: sourceId, kind: "channel", title: "Original source" }], files: [] };
  const library = normalizeLegacyLibrary(librarySource);
  const raw = {
    version: 1,
    topics: [{ id: "81000000-0000-0000-0000-000000000001", name: "Topic", name_key: "topic", summary: "", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
    sources: [{ id: sourceId, title: "Source", url: "https://example.test", platform: "youtube", observed_at: "2026-01-01T00:00:00Z", transcription_id: "tx-1", total_units: 1, covered_units: 1 }],
    insights: [{ id: "82000000-0000-0000-0000-000000000001", source_id: sourceId, topic_id: "81000000-0000-0000-0000-000000000001", suggested_topic: "Topic", kind: "claim", statement: "  Exact statement  ", status: "approved", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
    evidence: [],
    reviews: [],
    sourceUnits: [{ recordId: sourceId, payload: { transcriptionId: "tx-1", units: [{ text: "exact unit" }] } }],
  };
  const knowledge = normalizeLegacyKnowledge(raw, { recordIds: [sourceId] });
  const sourceFiles = ["knowledge.sqlite", "store.json"].map((relativePath) => ({ relativePath, bytes: 1, sha256: createHash("sha256").update(relativePath).digest("hex") }));
  return {
    ...knowledge, mode: "dry-run" as const, snapshotCheckedUnchanged: true as const, mediaReconciled: false as const,
    librarySource: { sourceDigest: library.sourceDigest, sourceCanonicalJson: library.sourceCanonicalJson }, sourceFiles,
  };
}

test("apply validation rebuilds exact source, sidecar readiness, and normalized projections", () => {
  assert.equal(validateKnowledgeApplyManifest(fixture()).valid, true);
  const edited = fixture();
  edited.insights[0].statement = "changed consistently";
  assert.throws(() => validateKnowledgeApplyManifest(edited), /manifest_insights_mismatch/);
  const staleHash = fixture();
  const changed = JSON.parse(staleHash.sourceCanonicalJson);
  changed.insights[0].statement = "changed at source";
  staleHash.sourceCanonicalJson = canonicalKnowledgeJson(changed);
  assert.throws(() => validateKnowledgeApplyManifest(staleHash), /manifest_source_digest_mismatch/);
  const missingSidecar = fixture();
  const rawMissing = JSON.parse(missingSidecar.sourceCanonicalJson);
  rawMissing.sourceUnits = [];
  missingSidecar.sourceCanonicalJson = canonicalKnowledgeJson(rawMissing);
  missingSidecar.sourceDigest = createHash("sha256").update(missingSidecar.sourceCanonicalJson).digest("hex");
  assert.throws(() => validateKnowledgeApplyManifest(missingSidecar), /manifest_knowledge_invalid/);
  const oversizedRows = fixture();
  const oversizedSnapshot = JSON.parse(oversizedRows.sourceCanonicalJson);
  oversizedSnapshot.topics = Array.from({ length: 100_001 }, () => ({}));
  oversizedRows.sourceCanonicalJson = canonicalKnowledgeJson(oversizedSnapshot);
  oversizedRows.sourceDigest = createHash("sha256").update(oversizedRows.sourceCanonicalJson).digest("hex");
  assert.throws(() => validateKnowledgeApplyManifest(oversizedRows), /manifest_row_limit/);
});

async function withApplyFixture(run: (args: string[], manifest: ReturnType<typeof fixture>, calls: Array<{ url: URL; init: RequestInit }>, setResponses: (responses: unknown[]) => void, output: string[]) => Promise<void>) {
  const folder = await mkdtemp(path.join(tmpdir(), "studio-knowledge-apply-test-"));
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

test("pinned bytes and target/library owner checks precede the RPC", async () => {
  await withApplyFixture(async (args, manifest, calls, setResponses) => {
    args[7] = "0".repeat(64);
    await assert.rejects(main(args), /manifest_hash_mismatch/);
    assert.equal(calls.length, 0);

    args[7] = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
    setResponses([[{ id: workspaceId, brand: "substo", workspace_type: "substo_standalone" }], [{ clerk_user_id: ownerId, role: "owner" }], []]);
    await assert.rejects(main(args), /target_library_snapshot_missing/);
    assert.equal(calls.length, 3);
    assert.ok(calls.every((call) => !call.url.pathname.includes("rpc")));
  });
});

test("successful apply sends the pinned manifest and reconciles server counts", async () => {
  await withApplyFixture(async (args, manifest, calls, setResponses, output) => {
    const runId = "70000000-0000-0000-0000-000000000002";
    const counts = manifest.counts;
    setResponses([
      [{ id: workspaceId, brand: "substo", workspace_type: "substo_standalone" }],
      [{ clerk_user_id: ownerId, role: "owner" }],
      [{ source_digest: manifest.librarySource.sourceDigest }],
      { runId, workspaceId, sourceDigest: manifest.sourceDigest, counts, replayed: false },
    ]);
    await main(args);
    assert.equal(calls.length, 4);
    const request = JSON.parse(String(calls[3].init.body));
    assert.equal(request.p_workspace_id, workspaceId);
    assert.equal(request.p_owner_clerk_user_id, ownerId);
    assert.equal(request.p_source_digest, manifest.sourceDigest);
    assert.deepEqual(request.p_manifest.sourceUnits, manifest.sourceUnits);
    assert.equal(JSON.parse(output[0]).mode, "applied-knowledge-metadata-only");
    assert.ok(!output[0].includes("exact statement") && !output[0].includes("fixture-service-secret"));
  });
});
