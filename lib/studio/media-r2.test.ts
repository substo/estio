import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStudioR2Store, MULTIPART_PART_BYTES, readStudioR2Config } from "./media-r2";
import { studioMediaKind, studioMediaResponseHeaders } from "./media-policy";

const config = { endpoint: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com", accessKeyId: "AKFIXTURE", secretAccessKey: "secret-fixture", bucket: "studio-media-fixture" };
type Sent = { name: string; input: Record<string, any> };
function fakeS3(handler: (command: Sent) => unknown) {
  const sent: Sent[] = [];
  return { sent, client: { async send(command: any) { const c = { name: command.constructor.name, input: command.input }; sent.push(c); return handler(c); } } };
}
const s3Error = (name: string, status: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
async function tempFile(bytes: Buffer) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studio-r2-"));
  const file = path.join(dir, "f"); await writeFile(file, bytes);
  return { file, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("config requires a dedicated Studio bucket and https endpoint", () => {
  assert.equal(readStudioR2Config({}), null);
  assert.equal(readStudioR2Config({ STUDIO_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", STUDIO_R2_ACCESS_KEY_ID: "a", STUDIO_R2_SECRET_ACCESS_KEY: "b", STUDIO_R2_BUCKET_NAME: "Bad_Bucket" }), null);
  assert.equal(readStudioR2Config({ STUDIO_R2_ACCESS_KEY_ID: "a", STUDIO_R2_SECRET_ACCESS_KEY: "b", STUDIO_R2_BUCKET_NAME: "ok-bucket", STUDIO_R2_ENDPOINT: "http://x" }), null);
  // The WhatsApp R2 variables are deliberately not used.
  assert.equal(readStudioR2Config({ R2_ACCOUNT_ID: "x", R2_ACCESS_KEY_ID: "a", R2_SECRET_ACCESS_KEY: "b", R2_BUCKET_NAME: "whatsapp-media" }), null);
  assert.deepEqual(readStudioR2Config({ STUDIO_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", STUDIO_R2_ACCESS_KEY_ID: "AKFIXTURE", STUDIO_R2_SECRET_ACCESS_KEY: "secret-fixture", STUDIO_R2_BUCKET_NAME: "studio-media-fixture" }), config);
});

test("small uploads are create-only single puts; existing keys are reported, not overwritten", async () => {
  const t = await tempFile(Buffer.from("bytes"));
  try {
    const ok = fakeS3(() => ({}));
    await createStudioR2Store(config, ok.client).uploadCreateOnly({ key: "w/k", filePath: t.file, byteSize: 5, contentType: "video/mp4" });
    assert.equal(ok.sent[0].name, "PutObjectCommand"); assert.equal(ok.sent[0].input.IfNoneMatch, "*"); assert.equal(ok.sent[0].input.Bucket, config.bucket);
    const exists = fakeS3(() => { throw s3Error("PreconditionFailed", 412); });
    await assert.rejects(createStudioR2Store(config, exists.client).uploadCreateOnly({ key: "w/k", filePath: t.file, byteSize: 5, contentType: "video/mp4" }), /stored_object_already_exists/);
  } finally { await t.cleanup(); }
});

test("large uploads use multipart parts with retry and create-only completion; failures abort", async () => {
  const size = 64 * 1024 * 1024 + 3;
  const t = await tempFile(Buffer.alloc(size, 1));
  try {
    let failed = false;
    const ok = fakeS3(({ name, input }) => {
      if (name === "CreateMultipartUploadCommand") return { UploadId: "up1" };
      if (name === "UploadPartCommand") { if (input.PartNumber === 2 && !failed) { failed = true; throw new Error("reset"); } return { ETag: `"e${input.PartNumber}"` }; }
      return {};
    });
    await createStudioR2Store(config, ok.client).uploadCreateOnly({ key: "w/big", filePath: t.file, byteSize: size, contentType: "video/mp4" });
    const complete = ok.sent.find(c => c.name === "CompleteMultipartUploadCommand")!;
    assert.equal(complete.input.IfNoneMatch, "*");
    assert.equal(complete.input.MultipartUpload.Parts.length, Math.ceil(size / MULTIPART_PART_BYTES));
    assert.equal(ok.sent.filter(c => c.name === "UploadPartCommand").length, Math.ceil(size / MULTIPART_PART_BYTES) + 1);

    const broken = fakeS3(({ name }) => { if (name === "CreateMultipartUploadCommand") return { UploadId: "up2" }; if (name === "UploadPartCommand") throw new Error("down"); return {}; });
    await assert.rejects(createStudioR2Store(config, broken.client, 1).uploadCreateOnly({ key: "w/big", filePath: t.file, byteSize: size, contentType: "video/mp4" }), /upload_part_failed/);
    assert.equal(broken.sent.at(-1)!.name, "AbortMultipartUploadCommand");
  } finally { await t.cleanup(); }
});

test("read-back hashes streamed bytes, treats NoSuchKey as absent and enforces size bound", async () => {
  async function* body() { yield Buffer.from("ab"); yield Buffer.from("c"); }
  const ok = fakeS3(() => ({ Body: body() }));
  assert.deepEqual(await createStudioR2Store(config, ok.client).readDigest("k", 3), { sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", byteSize: 3 });
  await assert.rejects(createStudioR2Store(config, fakeS3(() => ({ Body: body() })).client).readDigest("k", 2), /stored_object_larger_than_expected/);
  assert.equal(await createStudioR2Store(config, fakeS3(() => { throw s3Error("NoSuchKey", 404); }).client).readDigest("k", 3), null);
  await assert.rejects(createStudioR2Store(config, fakeS3(() => { throw s3Error("AccessDenied", 403); }).client).readDigest("k", 3), /stored_object_read_failed/);
});

test("presigned reads are short-lived and carry the safe response headers", async () => {
  const headers = studioMediaResponseHeaders("text/html", "evil.html", true);
  const url = new URL(await createStudioR2Store(config).presignRead({ key: "w/legacy-library/f/h", ...headers }));
  assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
  assert.equal(url.searchParams.get("response-content-type"), "application/octet-stream");
  assert.match(url.searchParams.get("response-content-disposition")!, /^attachment;/);
  assert.equal(url.searchParams.get("response-cache-control"), "private, no-store");
});

test("only passive media types display inline; filenames are header-safe", () => {
  assert.equal(studioMediaKind("video/quicktime"), "video");
  assert.equal(studioMediaKind("image/svg+xml"), null);
  assert.equal(studioMediaKind("application/pdf"), null);
  const inline = studioMediaResponseHeaders("image/png", 'café "x".png', true);
  assert.equal(inline.inline, true);
  assert.equal(inline.contentDisposition, `inline; filename="caf_ _x_.png"; filename*=UTF-8''caf%C3%A9%20%22x%22.png`);
  assert.equal(studioMediaResponseHeaders("image/png", "a.png", false).contentDisposition.startsWith("attachment"), true);
  assert.ok(!studioMediaResponseHeaders("image/png", "a\r\nb.png", true).contentDisposition.includes("\n"));
});

test("readiness uses only a bounded HEAD bucket; denial fails without printing storage details", async () => {
  const ok = fakeS3(() => ({})); await createStudioR2Store(config, ok.client).checkBucket();
  assert.deepEqual(ok.sent, [{ name: "HeadBucketCommand", input: { Bucket: config.bucket } }]);
  const bad = fakeS3(() => { throw new Error("secret access key and private endpoint"); });
  await assert.rejects(createStudioR2Store(config, bad.client).checkBucket(), /^StudioMediaStoreError: media_bucket_unavailable$/);
});

test("browser upload URLs never sign an SDK body checksum that real bytes would fail", async () => {
  const url = new URL(await createStudioR2Store(config).presignUpload({ key: "k", contentType: "audio/ogg", byteSize: 10 }));
  assert.ok(![...url.searchParams.keys()].some(name => /checksum/i.test(name)), url.search);
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders")?.includes("if-none-match"), true);
});
