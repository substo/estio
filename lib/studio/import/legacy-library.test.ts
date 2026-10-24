import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { LegacyImportValidationError, normalizeLegacyLibrary } from "./legacy-library";
import { inspectLegacyLibrary } from "./inspect-library";

const sourceId = "11111111-1111-4111-8111-111111111111";
const contentId = "22222222-2222-4222-8222-222222222222";
const fileId = "33333333-3333-4333-8333-333333333333";
const store = () => ({ version: 1, records: [
  { id: sourceId, kind: "reference", title: "Source", url: "https://example.com/video", linkedIds: [], approved: false, archived: true, transcript: "00:00 Actual words\n00:02 unchanged [uncertain]", discovery: { kind: "recommendation", observedAt: "2026-10-20T10:00:00.000Z" }, futureField: { sourceCitation: "00:02" } },
  { id: contentId, kind: "content", title: "Script", linkedIds: [sourceId], approved: true, script: "Original script" },
], files: [{ id: fileId, recordId: sourceId, name: "source.pdf", type: "application/pdf", size: 4, createdAt: "2026-10-20T10:00:00.000Z" }] });

test("normalizer preserves verbatim source, review state, unknown fields and relationships", () => {
  const original = store();
  const manifest = normalizeLegacyLibrary(original);
  assert.equal(manifest.valid, true);
  assert.deepEqual(manifest.records.find((record) => record.id === sourceId)?.payload, original.records[0]);
  assert.deepEqual(manifest.records.find((record) => record.id === sourceId)?.attachments, [fileId]);
  assert.deepEqual(manifest.records.find((record) => record.id === contentId)?.linkedIds, [sourceId]);
  assert.equal(manifest.files[0].relativePath, `files/${fileId}`);
  assert.deepEqual(manifest.counts, { records: 2, library: 1, channels: 0, content: 1, files: 1, links: 1 });
  assert.deepEqual(original, store(), "normalizing must not mutate input");
  assert.deepEqual(manifest, normalizeLegacyLibrary(JSON.parse(JSON.stringify(original))), "repeated snapshots are deterministic");
});

test("malformed records, duplicate IDs, and path traversal reject the entire batch", () => {
  const duplicate = store();
  duplicate.records.push({ ...duplicate.records[0] });
  assert.throws(() => normalizeLegacyLibrary(duplicate), LegacyImportValidationError);
  assert.throws(() => normalizeLegacyLibrary({ version: 2, records: [], files: [] }), LegacyImportValidationError);
  const badId = store();
  badId.files[0].id = "../../private";
  assert.throws(() => normalizeLegacyLibrary(badId), LegacyImportValidationError);
  const badName = store();
  badName.files[0].name = "../outside.pdf";
  assert.throws(() => normalizeLegacyLibrary(badName), LegacyImportValidationError);
});

test("unresolved record references block readiness while unsafe URLs remain verbatim but unclickable", () => {
  const input = store();
  input.records[0].url = "javascript:alert(1)";
  input.records[1].linkedIds = [fileId];
  const manifest = normalizeLegacyLibrary(input);
  assert.equal(manifest.valid, false);
  assert.equal(manifest.records[0].sourceUrl, null);
  assert.equal(manifest.records[0].payload.url, "javascript:alert(1)");
  assert.ok(manifest.issues.some((issue) => issue.code === "unsafe_source_url" && issue.severity === "warning"));
  assert.ok(manifest.issues.some((issue) => issue.code === "missing_linked_record"));
});

test("duplicate linked IDs including UUID case variants reject instead of inflating relationship counts", () => {
  const input = store();
  const mixedId = "abcdefab-1234-4567-8901-abcdefabcdef";
  input.records[0].id = mixedId;
  input.files[0].recordId = mixedId;
  input.records[1].linkedIds = [mixedId, mixedId.toUpperCase()];
  const snapshot = structuredClone(input);
  assert.throws(() => normalizeLegacyLibrary(input), (error: unknown) => {
    assert.ok(error instanceof LegacyImportValidationError);
    assert.ok(error.issues.some((issue) => issue.code === "duplicate_linked_id" && issue.path === "records[1].linkedIds"));
    return true;
  });
  assert.deepEqual(input, snapshot, "rejected data and its original linkedIds remain unchanged");
});

test("malformed known text fields reject rather than becoming blank during later editing", () => {
  for (const field of ["url", "summary", "notes", "transcript", "script", "platform", "handle", "channelName"]) {
    const input = store();
    Object.assign(input.records[0], { [field]: { unexpected: "object" } });
    assert.throws(() => normalizeLegacyLibrary(input), (error: unknown) => {
      assert.ok(error instanceof LegacyImportValidationError);
      assert.ok(error.issues.some((issue) => issue.code === "invalid_text_field" && issue.path === `records[0].${field}`));
      return true;
    });
  }
});

test("media inspection reports missing, size mismatch and symlink without altering source", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studio-import-test-"));
  try {
    await mkdir(path.join(dir, "files"));
    const sourceText = JSON.stringify(store());
    await writeFile(path.join(dir, "store.json"), sourceText);
    assert.equal((await inspectLegacyLibrary(dir)).media[0].status, "missing");
    await writeFile(path.join(dir, "files", fileId), "wrong-size");
    assert.equal((await inspectLegacyLibrary(dir)).media[0].status, "size_mismatch");
    await rm(path.join(dir, "files", fileId));
    await symlink(path.join(dir, "store.json"), path.join(dir, "files", fileId));
    const unsafe = await inspectLegacyLibrary(dir);
    assert.equal(unsafe.media[0].status, "unsafe");
    assert.equal(unsafe.valid, false);
    assert.equal(await readFile(path.join(dir, "store.json"), "utf8"), sourceText);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("CLI creates a private dry-run outside source and refuses overwrites/source output", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "studio-import-cli-test-"));
  try {
    const dataDir = path.join(dir, "data");
    await mkdir(path.join(dataDir, "files"), { recursive: true });
    const sourceText = JSON.stringify(store());
    await writeFile(path.join(dataDir, "store.json"), sourceText);
    await writeFile(path.join(dataDir, "files", fileId), "data");
    const output = path.join(dir, "manifest.json");
    const run = (target: string) => spawnSync(process.execPath, ["--import", "tsx", "scripts/studio-import.ts", "--data-dir", dataDir, "--output", target], { cwd: process.cwd(), encoding: "utf8" });
    const first = run(output);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(await readFile(output, "utf8")).mode, "dry-run");
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.equal(run(output).status, 1, "existing manifests must not be overwritten");
    assert.equal(run(path.join(dataDir, "manifest.json")).status, 1, "source directory must remain read-only");
    assert.equal(await readFile(path.join(dataDir, "store.json"), "utf8"), sourceText);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
