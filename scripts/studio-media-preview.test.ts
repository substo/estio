import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rename, rm, stat, symlink, truncate, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectLegacyMedia } from "../lib/studio/import/inspect-media";
import { hashSourceFile, sameIdentity } from "../lib/studio/import/source-snapshot";
import { canonicalJson, normalizeLegacyLibrary, type JsonValue } from "../lib/studio/import/legacy-library";
const recordId = "11111111-1111-4111-8111-111111111111";
const fileId = "22222222-2222-4222-8222-222222222222";
const secondId = "33333333-3333-4333-8333-333333333333";
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "studio-media-preview-")));
  const dataDir = path.join(root, "data"); await mkdir(dataDir); await mkdir(path.join(dataDir, "files"));
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 17, 0x61);
  const source = { version: 1, unknownTop: { keep: "PRIVATE_PROVENANCE" }, records: [{ id: recordId, kind: "reference", title: "PRIVATE_TITLE", transcript: " Exact text\n ", unknown: true }],
    files: [{ id: fileId, recordId, name: "PRIVATE_FILENAME.mp4", type: "video/mp4", size: bytes.length, unknownFile: { preserve: true } }] };
  const store = path.join(dataDir, "store.json"); await writeFile(store, JSON.stringify(source, null, 2));
  const file = path.join(dataDir, "files", fileId); await writeFile(file, bytes);
  return { root, dataDir, source, store, file, bytes, cleanup: () => rm(root, { recursive: true, force: true }) };
}
const cli = path.join(process.cwd(), "scripts/studio-media-preview.ts");
const run = (dataDir: string, output: string, extra: string[] = []) => spawnSync(process.execPath, ["--import", "tsx", cli, "--data-dir", dataDir, "--output", output, ...extra], { cwd: process.cwd(), encoding: "utf8", timeout: 20_000 });

test("streamed checksum preview preserves metadata, exact source text, relationships and byte evidence", async () => {
  const f = await fixture();
  try {
    const beforeStore = await readFile(f.store); const beforeFile = await stat(f.file, { bigint: true });
    const result = await inspectLegacyMedia(f.dataDir);
    assert.equal(result.valid, true); assert.equal(result.sourceBytesVerified, true);
    assert.equal(result.hostedReconciled, false); assert.equal(result.uploadSupported, false);
    assert.deepEqual(JSON.parse(result.librarySource.sourceCanonicalJson), f.source);
    assert.equal(result.librarySource.sourceDigest, normalizeLegacyLibrary(f.source).sourceDigest);
    assert.deepEqual(result.files, [{ id: fileId, recordId, relativePath: `files/${fileId}`, originalFilename: "PRIVATE_FILENAME.mp4", contentType: "video/mp4", expectedBytes: f.bytes.length, actualBytes: f.bytes.length, sha256: sha(f.bytes), status: "hashed" }]);
    assert.deepEqual(result.counts, { files: 1, expectedBytes: f.bytes.length, hashedFiles: 1, hashedBytes: f.bytes.length });
    assert.deepEqual(result.sourceFiles, [{ relativePath: "store.json", bytes: beforeStore.length, sha256: sha(beforeStore) }]);
    assert.equal(result.sourceDigest, sha(canonicalJson({ librarySourceDigest: result.librarySource.sourceDigest, files: result.files as unknown as JsonValue })));
    assert.deepEqual(await inspectLegacyMedia(f.dataDir), result);
    assert.ok(sameIdentity(beforeFile, await stat(f.file, { bigint: true })));
    assert.deepEqual(await readFile(f.store), beforeStore);
  } finally { await f.cleanup(); }
});
test("same-size byte changes alter the media digest without altering the library snapshot identity", async () => {
  const f = await fixture();
  try {
    const first = await inspectLegacyMedia(f.dataDir);
    await writeFile(f.file, Buffer.alloc(f.bytes.length, 0x62));
    const second = await inspectLegacyMedia(f.dataDir);
    assert.equal(first.librarySource.sourceDigest, second.librarySource.sourceDigest);
    assert.notEqual(first.sourceDigest, second.sourceDigest); assert.notEqual(first.files[0].sha256, second.files[0].sha256);
  } finally { await f.cleanup(); }
});
test("missing and size-mismatched files retain their relationship rows and block verification", async () => {
  const f = await fixture();
  try {
    await rm(f.file);
    const missing = await inspectLegacyMedia(f.dataDir);
    assert.equal(missing.valid, false); assert.equal(missing.files[0].status, "missing"); assert.equal(missing.files[0].recordId, recordId);
    assert.equal(missing.files[0].sha256, null); assert.equal(missing.sourceBytesVerified, false);
    await writeFile(f.file, "short");
    const mismatch = await inspectLegacyMedia(f.dataDir);
    assert.equal(mismatch.files[0].status, "size_mismatch"); assert.equal(mismatch.files[0].actualBytes, 5); assert.equal(mismatch.files[0].sha256, null);
    assert.ok(mismatch.issues.some(i => i.code === "media_size_mismatch"));
  } finally { await f.cleanup(); }
});
test("symlinked media, ancestor folders and store files cannot be read as trusted source", async () => {
  for (const relative of [`files/${fileId}`, "files", "store.json"]) {
    const f = await fixture();
    try {
      const original = path.join(f.dataDir, relative); await rename(original, `${original}.original`); await symlink(`${original}.original`, original);
      if (relative === "store.json") await assert.rejects(inspectLegacyMedia(f.dataDir), /unsafe_or_oversized_source_file/);
      else {
        let hashes = 0;
        const result = await inspectLegacyMedia(f.dataDir, async (...args) => { hashes++; return hashSourceFile(...args); });
        assert.equal(hashes, 0); assert.equal(result.files[0].status, "unsafe"); assert.equal(result.valid, false);
      }
    } finally { await f.cleanup(); }
  }
});
test("batch final verification catches edits to an earlier file while later files are hashed", async () => {
  const f = await fixture();
  try {
    f.source.files.push({ ...f.source.files[0], id: secondId });
    await writeFile(f.store, JSON.stringify(f.source)); await writeFile(path.join(f.dataDir, "files", secondId), f.bytes);
    const previous = await stat(f.file);
    let hashes = 0;
    await assert.rejects(inspectLegacyMedia(f.dataDir, async (...args) => {
      const result = await hashSourceFile(...args);
      if (++hashes === 2) { await writeFile(f.file, Buffer.alloc(f.bytes.length, 0x62)); await utimes(f.file, previous.atime, previous.mtime); }
      return result;
    }), /source_changed_during_preview/);
  } finally { await f.cleanup(); }
});
test("batch verification also rejects replaced source metadata after hashing", async () => {
  const f = await fixture();
  try {
    await assert.rejects(inspectLegacyMedia(f.dataDir, async (...args) => {
      const result = await hashSourceFile(...args); await rename(f.store, `${f.store}.old`); await writeFile(f.store, JSON.stringify(f.source)); return result;
    }), /source_changed_during_preview/);
  } finally { await f.cleanup(); }
});
test("streaming helper bounds reads, rejects unsafe paths, and hashes empty files correctly", async () => {
  const f = await fixture();
  try {
    await assert.rejects(hashSourceFile(f.file, `files/${fileId}`, 10), /unsafe_or_oversized_source_file/);
    await writeFile(f.file, "");
    const empty = await hashSourceFile(f.file, `files/${fileId}`, 100);
    assert.equal(empty.byteSize, 0); assert.equal(empty.sha256, sha(""));
    const link = `${f.file}.link`; await symlink(f.file, link);
    await assert.rejects(hashSourceFile(link, "link", 100), /unsafe_or_oversized_source_file/);
  } finally { await f.cleanup(); }
});
test("oversized individual files are diagnosed before any byte read", async () => {
  const f = await fixture();
  try {
    const size = 64 * 1024 ** 3 + 1;
    f.source.files[0].size = size; await writeFile(f.store, JSON.stringify(f.source)); await truncate(f.file, size);
    let hashes = 0;
    const result = await inspectLegacyMedia(f.dataDir, async (...args) => { hashes++; return hashSourceFile(...args); });
    assert.equal(hashes, 0); assert.equal(result.files[0].status, "oversized"); assert.equal(result.valid, false);
    assert.equal(result.counts.expectedBytes, size);
  } finally { await f.cleanup(); }
});
test("CLI creates an exclusive private artifact, prints no private metadata, and never writes within source", async () => {
  const f = await fixture();
  try {
    const output = path.join(f.root, "manifest.json"); const result = run(f.dataDir, output);
    assert.equal(result.status, 0, result.stderr); assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_|Exact text/);
    assert.equal(JSON.parse(result.stdout).hostedReconciled, false);
    const saved = await readFile(output, "utf8"); assert.equal(run(f.dataDir, output).status, 1); assert.equal(await readFile(output, "utf8"), saved);
    const inside = run(f.dataDir, path.join(f.dataDir, "output.json")); assert.equal(inside.status, 1); assert.match(inside.stderr, /output_must_be_outside_source/);
    const alias = path.join(f.root, "alias"); await symlink(f.dataDir, alias);
    assert.equal(run(f.dataDir, path.join(alias, "output.json")).status, 1);
    assert.equal(run(f.dataDir, path.join(f.root, "extra.json"), ["--apply"]).status, 1);
  } finally { await f.cleanup(); }
});
test("CLI keeps invalid file rows in a diagnostic artifact and exits 2", async () => {
  const f = await fixture();
  try {
    await rm(f.file); const output = path.join(f.root, "diagnostic.json"); const result = run(f.dataDir, output);
    assert.equal(result.status, 2, result.stderr); const artifact = JSON.parse(await readFile(output, "utf8"));
    assert.equal(artifact.files[0].id, fileId); assert.equal(artifact.files[0].sha256, null); assert.equal(artifact.valid, false);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_/);
  } finally { await f.cleanup(); }
});
test("dangling library relationships block readiness even when all attachment bytes hash", async () => {
  const f = await fixture();
  try {
    await writeFile(f.store, JSON.stringify({ ...f.source, records: [{ ...f.source.records[0], linkedIds: [secondId] }] }));
    const result = await inspectLegacyMedia(f.dataDir); assert.equal(result.sourceBytesVerified, true); assert.equal(result.valid, false);
    assert.ok(result.issues.some(i => i.code === "missing_linked_record"));
  } finally { await f.cleanup(); }
});

test("aggregate/file-count bounds reject before media hashing and empty libraries remain explicit", async () => {
  const f = await fixture();
  try {
    const huge = { ...f.source, files: [{ ...f.source.files[0], size: 512 * 1024 ** 3 + 1 }] };
    await writeFile(f.store, JSON.stringify(huge));
    await assert.rejects(inspectLegacyMedia(f.dataDir), /media_batch_byte_limit_exceeded/);
    await writeFile(f.store, JSON.stringify({ ...f.source, files: Array(10_001).fill(f.source.files[0]) }));
    await assert.rejects(inspectLegacyMedia(f.dataDir), /media_file_limit_exceeded/);
    await writeFile(f.store, JSON.stringify({ version: 1, records: [], files: [] }));
    await rm(path.join(f.dataDir, "files"), { recursive: true });
    const empty = await inspectLegacyMedia(f.dataDir);
    assert.equal(empty.valid, true); assert.deepEqual(empty.counts, { files: 0, expectedBytes: 0, hashedFiles: 0, hashedBytes: 0 });
    assert.equal(empty.hostedReconciled, false);
  } finally { await f.cleanup(); }
});
