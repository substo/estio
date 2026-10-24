import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertKnowledgeSourceUnchanged, inspectLegacyKnowledge, readKnowledgeSourceFile } from "../lib/studio/import/inspect-knowledge";

const source = "11111111-1111-4111-8111-111111111111";
const topic = "22222222-2222-4222-8222-222222222222";
const insight = "33333333-3333-4333-8333-333333333333";
const at = "2026-01-01T00:00:00Z";
const schema = `
  PRAGMA journal_mode=DELETE;
  CREATE TABLE topics(id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,summary TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE sources(id TEXT PRIMARY KEY,title TEXT NOT NULL,url TEXT NOT NULL DEFAULT '',platform TEXT NOT NULL DEFAULT '',observed_at TEXT NOT NULL,transcription_id TEXT NOT NULL DEFAULT '',total_units INTEGER NOT NULL DEFAULT 0,covered_units INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE insights(id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES sources(id),topic_id TEXT REFERENCES topics(id),suggested_topic TEXT NOT NULL,kind TEXT NOT NULL,statement TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  CREATE TABLE evidence(id TEXT PRIMARY KEY,insight_id TEXT NOT NULL REFERENCES insights(id),source_id TEXT NOT NULL REFERENCES sources(id),quote TEXT NOT NULL,start_sec REAL,end_sec REAL,frame_file TEXT NOT NULL DEFAULT '',source_url TEXT NOT NULL DEFAULT '',observed_at TEXT NOT NULL);
  CREATE TABLE reviews(id TEXT PRIMARY KEY,insight_id TEXT NOT NULL REFERENCES insights(id),action TEXT NOT NULL,previous_status TEXT NOT NULL,new_status TEXT NOT NULL,at TEXT NOT NULL);
  CREATE VIRTUAL TABLE insight_search USING fts5(insight_id UNINDEXED,statement,quote,topic);
`;

async function fixture(options: { oldSchema?: boolean; wal?: boolean } = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "studio-knowledge-preview-")));
  const dataDir = path.join(root, "data");
  await mkdir(dataDir);
  const dbPath = path.join(dataDir, "knowledge.sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(options.oldSchema ? schema.replace(",total_units INTEGER NOT NULL DEFAULT 0,covered_units INTEGER NOT NULL DEFAULT 0", "") : schema);
    db.prepare("INSERT INTO topics VALUES(?,?,?,?,?,?)").run(topic, "Strategy", "strategy", "", at, at);
    if (options.oldSchema) db.prepare("INSERT INTO sources VALUES(?,?,?,?,?,?)").run(source, "Source", "https://example.test/v", "YouTube", at, "tx-1");
    else db.prepare("INSERT INTO sources VALUES(?,?,?,?,?,?,?,?)").run(source, "Source", "https://example.test/v", "YouTube", at, "tx-1", 1, 1);
    db.prepare("INSERT INTO insights VALUES(?,?,?,?,?,?,?,?,?)").run(insight, source, topic, "Strategy", "claim", " Exact statement.\nKeep whitespace. ", "approved", at, at);
    db.prepare("INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?)").run("44444444-4444-4444-8444-444444444444", insight, source, "  Verbatim quote…\n ", 2.5, 4, "frame-01.jpg", "https://example.test/v", at);
    db.prepare("INSERT INTO reviews VALUES(?,?,?,?,?,?)").run("55555555-5555-4555-8555-555555555555", insight, "approve", "pending", "approved", at);
    if (options.wal) db.exec("PRAGMA journal_mode=WAL;");
  } finally { db.close(); }
  await writeFile(path.join(dataDir, "store.json"), JSON.stringify({ version: 1, records: [{ id: source, kind: "reference", title: "Source", linkedIds: [], approved: false, archived: false }], files: [], opaqueTopMetadata: { original: true } }));
  await mkdir(path.join(dataDir, "knowledge-source-units"));
  await writeFile(path.join(dataDir, "knowledge-source-units", `${source}.json`), JSON.stringify({ transcriptionId: "tx-1", units: [{ text: "  Spoken words…\n", start: 2.5, end: 4, frameFile: "frame-01.jpg", opaqueUnitMetadata: { preserve: true } }], opaqueEnvelopeMetadata: "exact" }));
  return { root, dataDir, dbPath, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function filesSnapshot(dir: string, prefix = ""): Promise<Record<string, string>> {
  const entries: Record<string, string> = {};
  for (const name of (await readdir(dir)).sort()) {
    const file = path.join(dir, name);
    if ((await stat(file)).isDirectory()) Object.assign(entries, await filesSnapshot(file, `${prefix}${name}/`));
    else entries[`${prefix}${name}`] = createHash("sha256").update(await readFile(file)).digest("hex");
  }
  return entries;
}

test("preview exports exact SQLite rows and sidecar envelopes with deterministic paired-store evidence and no source writes", async () => {
  const f = await fixture();
  try {
    const before = await filesSnapshot(f.dataDir);
    const manifest = await inspectLegacyKnowledge(f.dataDir);
    assert.equal(manifest.valid, true);
    assert.equal(manifest.mode, "dry-run"); assert.equal(manifest.snapshotCheckedUnchanged, true); assert.equal(manifest.mediaReconciled, false);
    assert.equal(manifest.insights[0].statement, " Exact statement.\nKeep whitespace. ");
    assert.equal(manifest.evidence[0].quote, "  Verbatim quote…\n ");
    assert.equal(manifest.reviews[0].new_status, "approved");
    const envelope = manifest.sourceUnitSidecars[0].payload as { payload: { opaqueEnvelopeMetadata: string } };
    assert.equal(envelope.payload.opaqueEnvelopeMetadata, "exact");
    assert.equal((manifest.sourceUnits[0].payload as { unit: { text: string } }).unit.text, "  Spoken words…\n");
    assert.equal(manifest.counts.sourceUnits, 1);
    assert.match(manifest.sourceCanonicalJson, /opaqueEnvelopeMetadata/);
    assert.equal(createHash("sha256").update(manifest.sourceCanonicalJson).digest("hex"), manifest.sourceDigest);
    assert.match(manifest.librarySource.sourceCanonicalJson, /opaqueTopMetadata/);
    assert.equal(createHash("sha256").update(manifest.librarySource.sourceCanonicalJson).digest("hex"), manifest.librarySource.sourceDigest);
    assert.deepEqual(await inspectLegacyKnowledge(f.dataDir), manifest);
    assert.deepEqual(await filesSnapshot(f.dataDir), before, "read-only preview cannot create journals or alter source bytes");
  } finally { await f.cleanup(); }
});

test("WAL mode and existing journal companions are rejected before opening SQLite and remain untouched", async () => {
  for (const mode of ["wal", "-wal", "-shm", "-journal"]) {
    const f = await fixture({ wal: mode === "wal" });
    try {
      if (mode !== "wal") await writeFile(`${f.dbPath}${mode}`, "existing companion");
      const before = await filesSnapshot(f.dataDir);
      await assert.rejects(inspectLegacyKnowledge(f.dataDir), /sqlite_(delete_journal_mode_required|journal_files_present)/);
      assert.deepEqual(await filesSnapshot(f.dataDir), before);
    } finally { await f.cleanup(); }
  }
});

test("unknown or older schemas reject rather than invent coverage or omit authoritative data", async () => {
  const older = await fixture({ oldSchema: true });
  try { await assert.rejects(inspectLegacyKnowledge(older.dataDir), /unsupported_knowledge_schema/); }
  finally { await older.cleanup(); }
  const extra = await fixture();
  try {
    const db = new DatabaseSync(extra.dbPath);
    db.exec("CREATE TABLE unexpected_data(id TEXT);"); db.close();
    await assert.rejects(inspectLegacyKnowledge(extra.dataDir), /unsupported_knowledge_schema/);
  } finally { await extra.cleanup(); }
});

test("symlinked SQLite, store, sidecar directories and sidecar files are rejected", async () => {
  for (const relative of ["knowledge.sqlite", "store.json", "knowledge-source-units", `knowledge-source-units/${source}.json`]) {
    const f = await fixture();
    try {
      const target = path.join(f.dataDir, relative);
      const original = `${target}.original`;
      await rename(target, original); await symlink(original, target);
      await assert.rejects(inspectLegacyKnowledge(f.dataDir), /unsafe_|unsupported_source_unit_filename/);
    } finally { await f.cleanup(); }
  }
});

test("source identity and hash checks detect edits and replacement between capture and final verification", async () => {
  const f = await fixture();
  try {
    const file = path.join(f.dataDir, "store.json");
    const captured = await readKnowledgeSourceFile(file, "store.json", 100_000);
    const originalStat = await stat(file);
    await writeFile(file, captured.bytes.toString("utf8").replace("Source", "Edited"));
    await utimes(file, originalStat.atime, originalStat.mtime);
    await assert.rejects(assertKnowledgeSourceUnchanged(captured), /source_changed_during_preview/);
    const current = await readKnowledgeSourceFile(file, "store.json", 100_000);
    await rename(file, `${file}.old`); await writeFile(file, current.bytes);
    await assert.rejects(assertKnowledgeSourceUnchanged(current), /source_changed_during_preview/);
    await assert.rejects(readKnowledgeSourceFile(file, "store.json", 1), /unsafe_or_oversized_source_file/);
  } finally { await f.cleanup(); }
});

test("missing or mismatched unit sidecars produce an invalid diagnostic manifest", async () => {
  const f = await fixture();
  try {
    const file = path.join(f.dataDir, "knowledge-source-units", `${source}.json`);
    await rm(file);
    const absent = await inspectLegacyKnowledge(f.dataDir);
    assert.equal(absent.valid, false); assert.ok(absent.issues.some((issue) => issue.code === "missing_source_unit_sidecar"));
    await writeFile(file, JSON.stringify({ transcriptionId: "different", units: [] }));
    const mismatch = await inspectLegacyKnowledge(f.dataDir);
    assert.equal(mismatch.valid, false);
    assert.ok(mismatch.issues.some((issue) => issue.code === "source_unit_count_mismatch"));
    assert.ok(mismatch.issues.some((issue) => issue.code === "source_unit_transcription_mismatch"));
  } finally { await f.cleanup(); }
});

test("CLI writes only private exclusive output outside the source and reports counts without private text", async () => {
  const f = await fixture();
  const cli = path.join(process.cwd(), "scripts/studio-knowledge-preview.ts");
  const run = (output: string) => spawnSync(process.execPath, ["--import", "tsx", cli, "--data-dir", f.dataDir, "--output", output], { cwd: process.cwd(), encoding: "utf8" });
  try {
    const before = await filesSnapshot(f.dataDir);
    const output = path.join(f.root, "knowledge.json");
    const success = run(output);
    assert.equal(success.status, 0, success.stderr);
    assert.equal((await stat(output)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(success.stdout).counts.insights, 1);
    assert.doesNotMatch(success.stdout, /Exact statement|Verbatim quote|Spoken words/);
    assert.notEqual(run(output).status, 0, "existing private artifact cannot be overwritten");
    const inside = run(path.join(f.dataDir, "output.json"));
    assert.notEqual(inside.status, 0); assert.match(inside.stderr, /output_must_be_outside_source/);
    assert.deepEqual(await filesSnapshot(f.dataDir), before);
  } finally { await f.cleanup(); }
});


test("compact oversized unit arrays are rejected before normalization expands them", async () => {
  const f = await fixture();
  try {
    const file = path.join(f.dataDir, "knowledge-source-units", `${source}.json`);
    await writeFile(file, JSON.stringify({ transcriptionId: "tx-1", units: Array(250_000).fill({ text: "" }) }));
    const before = await filesSnapshot(f.dataDir);
    await assert.rejects(inspectLegacyKnowledge(f.dataDir), /source_unit_row_limit_exceeded/);
    assert.deepEqual(await filesSnapshot(f.dataDir), before);
  } finally { await f.cleanup(); }
});
