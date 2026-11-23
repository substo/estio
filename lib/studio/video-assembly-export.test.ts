import assert from "node:assert/strict";
import { test } from "node:test";
import { runExportOperation, type ExportStore } from "./video-assembly-export";

const store = (digest: { sha256: string; byteSize: number } | null): ExportStore => ({ bucket: "b-bucket", presignUpload: async i => `https://r2.example/${i.key}`, readDigest: async () => digest });
const sha = "a".repeat(64);
test("reserve signs exactly the reserved key; verify binds only bytes the server read back", async () => {
  const seen: unknown[] = [];
  const reserve = await runExportOperation("video_export_reserve", async o => { seen.push(o); return { uploadId: "u", objectKey: "loc/uploads/u/original", byteSize: 2000, state: "reserved" }; }, store(null)) as { uploadUrl: string };
  assert.deepEqual(seen, [{ bucket: "b-bucket" }]); assert.equal(reserve.uploadUrl, "https://r2.example/loc/uploads/u/original");
  let observed: unknown;
  const reserved = { objectKey: "k", sha256: sha, byteSize: 2000, state: "reserved" };
  await runExportOperation("video_export_verify", async o => { if (o === undefined) return reserved; observed = o; return { uploadId: "u", state: "verified" }; }, store({ sha256: sha, byteSize: 2000 }));
  assert.deepEqual(observed, { bucket: "b-bucket", sha256: sha, byteSize: 2000 });
  await assert.rejects(runExportOperation("video_export_verify", async o => o === undefined ? reserved : {}, store({ sha256: "b".repeat(64), byteSize: 2000 })), /does not match/);
  await assert.rejects(runExportOperation("video_export_verify", async o => o === undefined ? reserved : {}, store(null)), /does not match/);
});
