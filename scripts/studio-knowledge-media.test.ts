import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { inspectLegacyKnowledgeMedia } from "../lib/studio/import/inspect-knowledge-media";
import { StudioMediaStoreError, type StudioObjectStore } from "../lib/studio/media-r2";
import { main } from "./studio-knowledge-media-upload";

const source = "11111111-1111-4111-8111-111111111111";
const insight = "33333333-3333-4333-8333-333333333333";
const evidence = "44444444-4444-4444-8444-444444444444";
const workspaceId = "70000000-0000-4000-8000-000000000001";
const ownerId = "user_fixture_owner";
const at = "2026-01-01T00:00:00Z";
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const schema = `
  PRAGMA journal_mode=DELETE;
  CREATE TABLE topics(id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,summary TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE sources(id TEXT PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL DEFAULT '',platform TEXT NOT NULL DEFAULT '',observed_at TEXT NOT NULL,transcription_id TEXT NOT NULL DEFAULT '',total_units INTEGER NOT NULL DEFAULT 0,covered_units INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE insights(id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES sources(id),topic_id TEXT REFERENCES topics(id),suggested_topic TEXT NOT NULL,kind TEXT NOT NULL,statement TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE evidence(id TEXT PRIMARY KEY,insight_id TEXT NOT NULL REFERENCES insights(id),source_id TEXT NOT NULL REFERENCES sources(id),quote TEXT NOT NULL,start_sec REAL,end_sec REAL,frame_file TEXT NOT NULL DEFAULT '',source_url TEXT NOT NULL DEFAULT '',observed_at TEXT NOT NULL);
  CREATE TABLE reviews(id TEXT PRIMARY KEY,insight_id TEXT NOT NULL REFERENCES insights(id),action TEXT NOT NULL,previous_status TEXT NOT NULL,new_status TEXT NOT NULL,at TEXT NOT NULL);
`;

async function fixture(unitFrames: string[] = ["frame-a.jpg", "frame-missing.jpg"], evidenceFrame = `${insight}.jpg`) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "studio-knowledge-media-")));
  const dataDir = path.join(root, "data"); await mkdir(dataDir);
  const db = new DatabaseSync(path.join(dataDir, "knowledge.sqlite"));
  try {
    db.exec(schema);
    db.prepare("INSERT INTO sources VALUES(?,?,?,?,?,?,?,?)").run(source, "Source", "https://example.test/v", "YouTube", at, "tx-1", unitFrames.length, unitFrames.length);
    db.prepare("INSERT INTO insights VALUES(?,?,?,?,?,?,?,?,?)").run(insight, source, null, "Strategy", "claim", "Statement", "pending", at, at);
    db.prepare("INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?)").run(evidence, insight, source, "quote", 1, 2, evidenceFrame, "https://example.test/v", at);
  } finally { db.close(); }
  await writeFile(path.join(dataDir, "store.json"), JSON.stringify({ version: 1, records: [{ id: source, kind: "reference", title: "Source" }], files: [] }));
  await mkdir(path.join(dataDir, "knowledge-source-units"));
  await writeFile(path.join(dataDir, "knowledge-source-units", `${source}.json`), JSON.stringify({ transcriptionId: "tx-1", units: unitFrames.map((frameFile, i) => ({ text: `PRIVATE unit ${i}`, start: i, end: i + 1, frameFile })) }));
  await mkdir(path.join(dataDir, "knowledge-media")); await mkdir(path.join(dataDir, "frames", "tx-1"), { recursive: true });
  await writeFile(path.join(dataDir, "knowledge-media", `${insight}.jpg`), "EVIDENCE-JPEG");
  await writeFile(path.join(dataDir, "frames", "tx-1", "frame-a.jpg"), "UNIT-JPEG");
  return { root, dataDir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("frame preview hashes evidence and unit frames, keeps missing frames visible as warnings", async () => {
  const f = await fixture();
  try {
    const m = await inspectLegacyKnowledgeMedia(f.dataDir);
    assert.equal(m.valid, true); assert.equal(m.knowledgeValid, true); assert.equal(m.hostedReconciled, false);
    assert.deepEqual(m.counts, { references: 3, hashed: 2, missing: 1, unsafe: 0, hashedBytes: 13 + 9 });
    const ev = m.references.find(r => r.refKind === "evidence")!;
    assert.deepEqual(ev, { refKind: "evidence", refId: evidence, frameFile: `${insight}.jpg`, relativePath: `knowledge-media/${insight}.jpg`, contentType: "image/jpeg", byteSize: 13, sha256: sha("EVIDENCE-JPEG"), status: "hashed" });
    const units = m.references.filter(r => r.refKind === "unit");
    assert.deepEqual(units.map(u => [u.relativePath, u.status]).sort(), [["frames/tx-1/frame-a.jpg", "hashed"], ["frames/tx-1/frame-missing.jpg", "missing"]]);
    assert.ok(m.issues.every(i => i.severity === "warning"));
    assert.deepEqual(await inspectLegacyKnowledgeMedia(f.dataDir), m);
    await writeFile(path.join(f.dataDir, "frames", "tx-1", "frame-a.jpg"), "UNIT-JPEX");
    assert.notEqual((await inspectLegacyKnowledgeMedia(f.dataDir)).sourceDigest, m.sourceDigest);
  } finally { await f.cleanup(); }
});

test("traversal names, symlinked frames and unsupported types are unsafe and block", async () => {
  const f = await fixture(["../../store.json", "frame-a.svg"], "../store.json");
  try {
    const m = await inspectLegacyKnowledgeMedia(f.dataDir);
    assert.equal(m.valid, false); assert.equal(m.counts.unsafe, 3);
    assert.ok(m.references.every(r => r.relativePath === null && r.sha256 === null));
  } finally { await f.cleanup(); }
  const g = await fixture(["frame-a.jpg"]);
  try {
    await rm(path.join(g.dataDir, "frames", "tx-1", "frame-a.jpg"));
    await symlink(path.join(g.dataDir, "store.json"), path.join(g.dataDir, "frames", "tx-1", "frame-a.jpg"));
    const m = await inspectLegacyKnowledgeMedia(g.dataDir);
    assert.equal(m.references.find(r => r.refKind === "unit")!.status, "unsafe"); assert.equal(m.valid, false);
  } finally { await g.cleanup(); }
});

function fakeStore() {
  const objects = new Map<string, Buffer>();
  const store: StudioObjectStore = {
    bucket: "studio-media",
    async readDigest(key) { const b = objects.get(key); return b ? { sha256: sha(b), byteSize: b.length } : null; },
    async uploadCreateOnly({ key, filePath }) { if (objects.has(key)) throw new StudioMediaStoreError("stored_object_already_exists"); objects.set(key, await readFile(filePath)); },
    async presignRead() { throw new Error("unused"); },
  };
  return { store, objects };
}

test("knowledge frame upload reserves hashed frames only, verifies bytes in R2, then binds", async () => {
  const f = await fixture();
  const r2 = fakeStore();
  const rpc: Array<{ path: string; body: Record<string, any> }> = [];
  const previous = { fetch: globalThis.fetch, log: console.log, url: process.env.STUDIO_SUPABASE_URL, key: process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY, exit: process.exitCode };
  const output: string[] = [];
  try {
    const manifestBytes = JSON.stringify(await inspectLegacyKnowledgeMedia(f.dataDir));
    const manifestPath = path.join(f.root, "km.json"); await writeFile(manifestPath, manifestBytes, { mode: 0o600 });
    process.env.STUDIO_SUPABASE_URL = "https://fixture.example.invalid"; process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY = "fixture-service-secret";
    console.log = (v: unknown) => output.push(String(v));
    globalThis.fetch = (async (input: URL | RequestInfo, init: RequestInit = {}) => {
      const url = new URL(String(input));
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.pathname === "/rest/v1/studio_workspaces") return json([{ id: workspaceId, brand: "substo", workspace_type: "substo_standalone" }]);
      if (url.pathname === "/rest/v1/studio_workspace_memberships") return json([{ clerk_user_id: ownerId, role: "owner" }]);
      const body = JSON.parse(String(init.body)); rpc.push({ path: url.pathname, body });
      if (url.pathname.endsWith("studio_reserve_knowledge_media")) return json({ workspaceId, mediaSourceDigest: body.p_media_source_digest,
        references: body.p_refs.map((r: any) => ({ refKind: r.refKind, refId: r.refId, bucketId: body.p_bucket_id, objectKey: `${workspaceId}/legacy-knowledge/${r.refKind}/${r.refId}/${r.sha256}`, status: "pending" })) });
      return json({ refKind: body.p_ref_kind, refId: body.p_ref_id, mediaObjectId: "99999999-9999-4999-8999-999999999999", bucketId: "studio-media",
        objectKey: `${workspaceId}/legacy-knowledge/${body.p_ref_kind}/${body.p_ref_id}/${body.p_sha256}` });
    }) as typeof fetch;
    const args = ["--manifest", manifestPath, "--expected-sha256", sha(manifestBytes), "--data-dir", f.dataDir, "--workspace", workspaceId, "--owner-user-id", ownerId, "--apply"];
    await main(args, r2.store);
    assert.equal(rpc[0].body.p_refs.length, 2, "missing frame is not reserved");
    assert.equal(rpc.filter(c => c.path.endsWith("studio_bind_knowledge_media")).length, 2);
    assert.ok([...r2.objects.values()].some(b => b.toString() === "EVIDENCE-JPEG"));
    const summary = JSON.parse(output[0]);
    assert.deepEqual(summary.counts, { references: 3, unavailableInSource: 1, verified: 2, alreadyVerified: 0, pending: 0 });
    assert.ok(!output[0].includes("PRIVATE") && !output[0].includes("fixture-service-secret"));
    await writeFile(path.join(f.dataDir, "knowledge-media", `${insight}.jpg`), "EVIDENCE-JPEX");
    await assert.rejects(main(args, r2.store), /manifest_does_not_match_source/);
  } finally {
    globalThis.fetch = previous.fetch; console.log = previous.log; process.exitCode = previous.exit;
    if (previous.url === undefined) delete process.env.STUDIO_SUPABASE_URL; else process.env.STUDIO_SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY; else process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY = previous.key;
    await f.cleanup();
  }
});
