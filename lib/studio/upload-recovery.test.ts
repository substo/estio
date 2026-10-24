import assert from "node:assert/strict";
import test from "node:test";
import { readUploadCommand, recoverUpload, type RecoverableUpload } from "./upload-recovery";
import { studioCommandResponse } from "./command-http";
const upload: RecoverableUpload = { id: "a3000000-0000-4000-8000-000000000001", record_id: "a2000000-0000-4000-8000-000000000001",
  object_key: "private/original", byte_size: 100, bucket_id: "studio-media", content_type: "video/mp4", original_filename: "a.mp4",
  status: "awaiting_upload", created_by_clerk_user_id: "user_a", expires_at: "2026-10-24T01:00:00Z" };
const scope = { userId: "user_a", recordId: upload.record_id };
function fixture() {
  const calls: string[] = [];
  const deps = { bucket: "studio-media", now: Date.parse("2026-10-24T00:30:00Z"),
    head: async (_key: string): Promise<{ byteSize: number; contentType: string } | null> => { calls.push("head"); return null; },
    sign: async (input: unknown) => { calls.push("sign"); assert.deepEqual(input, { key: upload.object_key, contentType: "video/mp4", byteSize: 100 }); return "https://private.invalid/signed"; },
    complete: async (id: string, size: number) => { calls.push("complete"); assert.equal(id, upload.id); assert.equal(size, 100); } };
  return { deps, calls };
}
test("lost registration response reuses one ID; missing object renews a create-only target", async () => {
  const { deps, calls } = fixture();
  const first = await recoverUpload(upload, scope, deps), retry = await recoverUpload(upload, scope, deps);
  assert.deepEqual(first, retry); assert.equal(first.status, "ready");
  if (first.status === "ready") assert.deepEqual(first.headers, { "Content-Type": "video/mp4", "If-None-Match": "*" });
  assert.deepEqual(calls, ["head", "sign", "head", "sign"]);
});
test("lost PUT response finalizes landed bytes without signing another PUT", async () => {
  const { deps, calls } = fixture(); deps.head = async () => { calls.push("head"); return { byteSize: 100, contentType: "video/mp4" }; };
  assert.deepEqual(await recoverUpload(upload, scope, deps), { status: "uploaded", uploadId: upload.id });
  assert.deepEqual(calls, ["head", "complete"]);
});
test("lost finish response retries durable completion; saved completion needs no R2 read", async () => {
  const { deps, calls } = fixture(); let saved = false;
  deps.head = async () => ({ byteSize: 100, contentType: "video/mp4" });
  deps.complete = async () => { saved = true; throw new Error("response lost after commit"); };
  await assert.rejects(recoverUpload(upload, scope, deps), /response lost/); assert.equal(saved, true);
  assert.deepEqual(await recoverUpload({ ...upload, status: "uploaded" }, scope, deps), { status: "uploaded", uploadId: upload.id });
  assert.deepEqual(calls, []);
});
test("wrong principal, record or bucket and absent uploads do not touch storage", async () => {
  const { deps, calls } = fixture();
  for (const row of [null, { ...upload, created_by_clerk_user_id: "other" }, { ...upload, record_id: "other" }, { ...upload, bucket_id: "other" }]) {
    await assert.rejects(recoverUpload(row, scope, deps), /not found/);
  }
  assert.deepEqual(calls, []);
});
test("expiry is terminal for pending rows, while old completed rows remain replayable", async () => {
  const { deps, calls } = fixture(); deps.now = Date.parse("2026-10-24T07:00:00Z");
  await assert.rejects(recoverUpload(upload, scope, deps), /expired/);
  await assert.rejects(recoverUpload({ ...upload, expires_at: "invalid" }, scope, deps), /expired/);
  assert.equal((await recoverUpload({ ...upload, status: "uploaded" }, scope, deps)).status, "uploaded"); assert.deepEqual(calls, []);
});
test("size/type mismatch and storage outage never sign or complete", async () => {
  const { deps, calls } = fixture();
  for (const head of [{ byteSize: 99, contentType: "video/mp4" }, { byteSize: 100, contentType: "audio/mp4" }]) {
    deps.head = async () => head; await assert.rejects(recoverUpload(upload, scope, deps), /does not match/);
  }
  deps.head = async () => { throw new Error("storage offline"); };
  await assert.rejects(recoverUpload(upload, scope, deps), /storage offline/); assert.deepEqual(calls, []);
});
test("command parser pins UUID and bounded normalized metadata", () => {
  const input = { recordId: upload.record_id, filename: "a.mp4", contentType: "", byteSize: 100 };
  assert.deepEqual(readUploadCommand({ action: "start", uploadId: upload.id.toUpperCase(), input }), {
    action: "start", uploadId: upload.id, input: { ...input, contentType: "video/mp4" } });
  for (const value of [null, [], {}, { action: "recover", uploadId: "foreign", recordId: upload.record_id },
    { action: "start", uploadId: upload.id, input: { ...input, byteSize: 0 } }]) assert.throws(() => readUploadCommand(value));
});
test("HTTP recovery is own-origin, bounded, no-store and preserves uncertain outcome for retry", async () => {
  const body = { action: "recover", uploadId: upload.id, recordId: upload.record_id }; let executes = 0;
  const deps = { profile: async () => ({ origin: "https://substo.test" }), parse: readUploadCommand,
    execute: async () => { executes++; throw new Error("lost response"); } };
  const request = (origin = "https://substo.test", value: unknown = body) => new Request("https://substo.test/studio/api", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(value) });
  assert.equal((await studioCommandResponse(request("https://other.test"), deps)).status, 403);
  assert.equal((await studioCommandResponse(request(undefined, { ...body, extra: "x".repeat(17000) }), deps)).status, 413);
  const response = await studioCommandResponse(request(), deps);
  assert.equal(response.status, 503); assert.match(response.headers.get("cache-control")!, /no-store/); assert.equal(executes, 1);
  assert.equal((await studioCommandResponse(request(), { ...deps, profile: async () => null })).status, 401);
});
