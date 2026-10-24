import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectLegacyMedia } from "../lib/studio/import/inspect-media";
import { StudioMediaStoreError, type StudioObjectStore } from "../lib/studio/media-r2";
import { main } from "./studio-media-upload";

const workspaceId = "70000000-0000-4000-8000-000000000001";
const ownerId = "user_fixture_owner";
const recordId = "11111111-1111-4111-8111-111111111111";
const fileId = "22222222-2222-4222-8222-222222222222";
const bucket = "studio-media-fixture";
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const origin = "https://fixture.example.invalid";

/** In-memory R2 bucket honoring create-only writes. */
function fakeStore(options: { storedOverride?: Buffer } = {}) {
  const objects = new Map<string, Buffer>();
  const calls: string[] = [];
  const store: StudioObjectStore = {
    bucket,
    async readDigest(key) { calls.push(`read ${key}`); const b = objects.has(key) ? options.storedOverride ?? objects.get(key)! : null; return b && { sha256: sha(b), byteSize: b.length }; },
    async uploadCreateOnly({ key, filePath }) {
      calls.push(`upload ${key}`);
      if (objects.has(key)) throw new StudioMediaStoreError("stored_object_already_exists");
      objects.set(key, await import("node:fs/promises").then(fs => fs.readFile(filePath)));
    },
    async presignRead() { throw new Error("not used"); },
  };
  return { store, objects, calls };
}

/** Supabase REST/RPC fake; storage requests must never reach Supabase. */
function fakeSupabase(reservedStatus: "pending" | "verified" = "pending") {
  const calls: string[] = [];
  const rpc: Array<Record<string, unknown>> = [];
  const fetcher = async (input: URL | RequestInfo, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    assert.ok(url.pathname.startsWith("/rest/v1/"), "media bytes must not go to Supabase");
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/rest/v1/studio_workspaces") return json([{ id: workspaceId, brand: "substo", workspace_type: "substo_standalone" }]);
    if (url.pathname === "/rest/v1/studio_workspace_memberships") return json([{ clerk_user_id: ownerId, role: "owner" }]);
    const body = JSON.parse(String(init.body)); rpc.push(body);
    if (url.pathname === "/rest/v1/rpc/studio_reserve_legacy_media") return json({ workspaceId, mediaSourceDigest: body.p_media_source_digest,
      files: body.p_files.map((f: { id: string; sha256: string }) => ({ fileId: f.id, bucketId: body.p_bucket_id, objectKey: `${workspaceId}/legacy-library/${f.id}/${f.sha256}`, status: reservedStatus, mediaObjectId: null })) });
    if (url.pathname === "/rest/v1/rpc/studio_bind_legacy_media") return json({ fileId: body.p_file_id, mediaObjectId: "99999999-9999-4999-8999-999999999999",
      bucketId: bucket, objectKey: `${workspaceId}/legacy-library/${body.p_file_id}/${body.p_sha256}`, replayed: false });
    throw new Error(`Unexpected ${url.pathname}`);
  };
  return { fetcher: fetcher as typeof fetch, calls, rpc };
}

async function fixture(bytes = Buffer.from("original attachment bytes")) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "studio-media-upload-")));
  const dataDir = path.join(root, "data"); await mkdir(path.join(dataDir, "files"), { recursive: true });
  await writeFile(path.join(dataDir, "store.json"), JSON.stringify({ version: 1, records: [{ id: recordId, kind: "reference", title: "PRIVATE_TITLE" }],
    files: [{ id: fileId, recordId, name: "PRIVATE_NAME.mov", type: "video/quicktime", size: bytes.length }] }));
  await writeFile(path.join(dataDir, "files", fileId), bytes);
  const manifestBytes = JSON.stringify(await inspectLegacyMedia(dataDir));
  const manifest = path.join(root, "manifest.json"); await writeFile(manifest, manifestBytes, { mode: 0o600 });
  const args = ["--manifest", manifest, "--expected-sha256", sha(Buffer.from(manifestBytes)), "--data-dir", dataDir, "--workspace", workspaceId, "--owner-user-id", ownerId, "--apply"];
  return { dataDir, bytes, args, key: `${workspaceId}/legacy-library/${fileId}/${sha(bytes)}`, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function withEnv(fetcher: typeof fetch, run: (output: string[]) => Promise<void>) {
  const previous = { fetch: globalThis.fetch, log: console.log, url: process.env.STUDIO_SUPABASE_URL, key: process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY, exit: process.exitCode };
  const output: string[] = [];
  process.env.STUDIO_SUPABASE_URL = origin; process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY = "fixture-service-secret";
  globalThis.fetch = fetcher; console.log = (value: unknown) => output.push(String(value));
  try { await run(output); }
  finally {
    globalThis.fetch = previous.fetch; console.log = previous.log; process.exitCode = previous.exit;
    if (previous.url === undefined) delete process.env.STUDIO_SUPABASE_URL; else process.env.STUDIO_SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY; else process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY = previous.key;
  }
}

test("uploads bytes to R2, reads them back, then binds metadata in Supabase", async () => {
  const f = await fixture(); const r2 = fakeStore(); const db = fakeSupabase();
  try {
    await withEnv(db.fetcher, async (output) => {
      await main(f.args, r2.store);
      assert.deepEqual(r2.objects.get(f.key), f.bytes);
      assert.deepEqual(r2.calls, [`read ${f.key}`, `upload ${f.key}`, `read ${f.key}`]);
      assert.equal(db.rpc[0].p_bucket_id, bucket);
      assert.deepEqual(db.rpc[1], { p_workspace_id: workspaceId, p_owner_clerk_user_id: ownerId, p_file_id: fileId, p_sha256: sha(f.bytes), p_byte_size: f.bytes.length });
      const summary = JSON.parse(output[0]);
      assert.deepEqual(summary.counts, { files: 1, verified: 1, alreadyVerified: 0, pending: 0 });
      assert.equal(summary.hostedReconciled, true);
      assert.ok(!output[0].includes("PRIVATE") && !output[0].includes("fixture-service-secret"));
    });
  } finally { await f.cleanup(); }
});

test("stored bytes that do not match leave the attachment pending and unbound", async () => {
  const f = await fixture(); const r2 = fakeStore({ storedOverride: Buffer.from("tampered") }); const db = fakeSupabase();
  try {
    await withEnv(db.fetcher, async (output) => {
      await main(f.args, r2.store);
      assert.deepEqual(JSON.parse(output[0]).pending, [{ fileId, code: "stored_bytes_mismatch" }]);
      assert.ok(!db.calls.includes("/rest/v1/rpc/studio_bind_legacy_media")); assert.equal(process.exitCode, 2);
    });
  } finally { await f.cleanup(); }
});

test("an existing matching object is verified without re-upload, and verified rows are skipped", async () => {
  const f = await fixture(); const r2 = fakeStore(); r2.objects.set(f.key, f.bytes);
  try {
    await withEnv(fakeSupabase().fetcher, async () => {
      await main(f.args, r2.store);
      assert.ok(!r2.calls.some(call => call.startsWith("upload")));
    });
    const again = fakeStore();
    await withEnv(fakeSupabase("verified").fetcher, async (output) => {
      await main(f.args, again.store);
      assert.equal(JSON.parse(output[0]).counts.alreadyVerified, 1); assert.equal(again.calls.length, 0);
    });
  } finally { await f.cleanup(); }
});

test("pinned manifest must match a fresh source rebuild before any network request", async () => {
  const f = await fixture(Buffer.from("reviewed bytes")); const r2 = fakeStore(); const db = fakeSupabase();
  try {
    await withEnv(db.fetcher, async () => {
      const wrongPin = [...f.args]; wrongPin[3] = "0".repeat(64);
      await assert.rejects(main(wrongPin, r2.store), /manifest_hash_mismatch/);
      await writeFile(path.join(f.dataDir, "files", fileId), Buffer.from("edited_bytes!!"));
      await assert.rejects(main(f.args, r2.store), /manifest_does_not_match_source/);
      await assert.rejects(main(f.args.slice(0, -1), r2.store), /invalid_arguments/);
      assert.equal(db.calls.length, 0); assert.equal(r2.calls.length, 0);
    });
  } finally { await f.cleanup(); }
});
