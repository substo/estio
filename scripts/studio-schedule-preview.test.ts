import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rename, rm, stat, symlink, truncate, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectLegacySchedules } from "../lib/studio/import/inspect-schedules";
import { readSourceSnapshot, assertSourceSnapshotUnchanged } from "../lib/studio/import/source-snapshot";

const sid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const fixtureSource = () => ({ version: 1, unknown: "keep", schedules: [{ id: sid, presetId: "idea-review", query: "PRIVATE_FOCUS", intervalHours: 168, dailyTime: "09:00", timeZone: "Asia/Nicosia", enabled: false,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", nextRunAt: "2026-01-08T00:00:00.000Z" }], runs: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", scheduleId: sid, presetId: "idea-review", status: "failed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:01:00.000Z", output: "PRIVATE_OUTPUT\n exact", error: "PRIVATE_ERROR" }] });
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "studio-schedule-preview-")));
  const dataDir = path.join(root, "data"); await mkdir(dataDir);
  const source = path.join(dataDir, "schedules.json");
  const bytes = JSON.stringify(fixtureSource(), null, 2); await writeFile(source, bytes);
  return { root, dataDir, source, bytes, cleanup: () => rm(root, { recursive: true, force: true }) };
}
const cli = path.join(process.cwd(), "scripts/studio-schedule-preview.ts");
const run = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", cli, ...args], { cwd: process.cwd(), encoding: "utf8", timeout: 20_000 });

test("preview reads only schedules and retains exact content with byte/hash evidence", async () => {
  const f = await fixture();
  try {
    // Unrelated local data is not parsed or required by this adapter.
    await writeFile(path.join(f.dataDir, "store.json"), "not JSON");
    const result = await inspectLegacySchedules(f.dataDir);
    assert.equal(result.valid, true);
    assert.deepEqual(JSON.parse(result.sourceCanonicalJson), fixtureSource());
    assert.deepEqual(result.sourceFiles, [{ relativePath: "schedules.json", bytes: Buffer.byteLength(f.bytes), sha256: createHash("sha256").update(f.bytes).digest("hex") }]);
    assert.deepEqual(await inspectLegacySchedules(f.dataDir), result);
    assert.equal(await readFile(f.source, "utf8"), f.bytes);
  } finally { await f.cleanup(); }
});

test("CLI writes private exclusive artifact outside source and prints counts only", async () => {
  const f = await fixture();
  try {
    const output = path.join(f.root, "manifest.json");
    const success = run(["--data-dir", f.dataDir, "--output", output]);
    assert.equal(success.status, 0, success.stderr);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.doesNotMatch(success.stdout + success.stderr, /PRIVATE_FOCUS|PRIVATE_OUTPUT|PRIVATE_ERROR/);
    assert.equal(JSON.parse(success.stdout).counts.runs, 1);
    const saved = await readFile(output, "utf8");
    assert.equal(JSON.parse(saved).applySupported, false);
    assert.equal(run(["--data-dir", f.dataDir, "--output", output]).status, 1);
    assert.equal(await readFile(output, "utf8"), saved);
    const inside = run(["--data-dir", f.dataDir, "--output", path.join(f.dataDir, "out.json")]);
    assert.equal(inside.status, 1); assert.match(inside.stderr, /output_must_be_outside_source/);
    assert.equal(await readFile(f.source, "utf8"), f.bytes);
  } finally { await f.cleanup(); }
});

test("invalid rows produce private diagnostic artifact and exit 2 without disclosure", async () => {
  const f = await fixture();
  try {
    const input = fixtureSource(); input.runs[0].scheduleId = "missing-private-id";
    await writeFile(f.source, JSON.stringify(input));
    const output = path.join(f.root, "diagnostic.json");
    const result = run(["--data-dir", f.dataDir, "--output", output]);
    assert.equal(result.status, 2, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_|missing-private-id/);
    const manifest = JSON.parse(await readFile(output, "utf8"));
    assert.equal(manifest.valid, false); assert.equal(manifest.runs[0].payload.scheduleId, "missing-private-id");
  } finally { await f.cleanup(); }
});

test("symlinked, missing, oversized and malformed sources fail without creating output", async () => {
  const f = await fixture();
  try {
    await rename(f.source, `${f.source}.original`); await symlink(`${f.source}.original`, f.source);
    await assert.rejects(inspectLegacySchedules(f.dataDir), /unsafe_or_oversized_source_file/);
    await rm(f.source); await assert.rejects(inspectLegacySchedules(f.dataDir), /ENOENT/);
    await writeFile(f.source, ""); await truncate(f.source, 20 * 1024 * 1024 + 1);
    await assert.rejects(inspectLegacySchedules(f.dataDir), /unsafe_or_oversized_source_file/);
    await writeFile(f.source, Buffer.from([0xff]));
    await assert.rejects(inspectLegacySchedules(f.dataDir), /invalid_schedules_json/);
    await writeFile(f.source, "PRIVATE_MALFORMED");
    const output = path.join(f.root, "absent.json");
    const result = run(["--data-dir", f.dataDir, "--output", output]);
    assert.equal(result.status, 1); assert.doesNotMatch(result.stderr, /PRIVATE_MALFORMED/);
    await assert.rejects(stat(output), /ENOENT/);
  } finally { await f.cleanup(); }
});

test("shared snapshot verification detects same-size edits and replacement", async () => {
  const f = await fixture();
  try {
    const snapshot = await readSourceSnapshot(f.source, "schedules.json", 100_000);
    const before = await stat(f.source);
    await writeFile(f.source, f.bytes.replace("PRIVATE_FOCUS", "CHANGED_FOCUS"));
    await utimes(f.source, before.atime, before.mtime);
    await assert.rejects(assertSourceSnapshotUnchanged(snapshot), /source_changed_during_preview/);
    const next = await readSourceSnapshot(f.source, "schedules.json", 100_000);
    await rename(f.source, `${f.source}.old`); await writeFile(f.source, next.bytes);
    await assert.rejects(assertSourceSnapshotUnchanged(next), /source_changed_during_preview/);
  } finally { await f.cleanup(); }
});

test("CLI rejects relative paths, extra flags, and output-parent aliases into source", async () => {
  const f = await fixture();
  try {
    assert.equal(run(["--data-dir", "relative", "--output", path.join(f.root, "bad.json")]).status, 1);
    assert.equal(run(["--data-dir", f.dataDir, "--output", path.join(f.root, "bad.json"), "--apply"]).status, 1);
    const alias = path.join(f.root, "alias"); await symlink(f.dataDir, alias);
    const result = run(["--data-dir", f.dataDir, "--output", path.join(alias, "out.json")]);
    assert.equal(result.status, 1); assert.match(result.stderr, /output_must_be_outside_source/);
  } finally { await f.cleanup(); }
});
