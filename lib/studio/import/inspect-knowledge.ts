import { lstat, readdir, realpath } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeLegacyKnowledge, type KnowledgeIssue, type KnowledgeJson, type KnowledgeObject, type LegacyKnowledgeManifest } from "./legacy-knowledge";
import { normalizeLegacyLibrary } from "./legacy-library";

import { readSourceSnapshot, assertSourceSnapshotUnchanged, sameIdentity, type SourceSnapshot } from "./source-snapshot";

const MiB = 1024 * 1024;
const MAX_DATABASE_BYTES = 256 * MiB;
const MAX_STORE_BYTES = 100 * MiB;
const MAX_SIDECAR_BYTES = 20 * MiB;
const MAX_TOTAL_SIDECAR_BYTES = 100 * MiB;
const MAX_SIDECARS = 10_000;
const MAX_ROWS_PER_TABLE = 100_000;
const MAX_TOTAL_ROWS = 250_000;
const uuidJson = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;
const authoritativeTables = ["topics", "sources", "insights", "evidence", "reviews"] as const;
type Table = typeof authoritativeTables[number];
const queries: Record<Table, string> = {
  topics: "SELECT * FROM topics ORDER BY id LIMIT ?",
  sources: "SELECT * FROM sources ORDER BY id LIMIT ?",
  insights: "SELECT * FROM insights ORDER BY id LIMIT ?",
  evidence: "SELECT * FROM evidence ORDER BY id LIMIT ?",
  reviews: "SELECT * FROM reviews ORDER BY id LIMIT ?",
};
const columnQueries: Record<Table, string> = {
  topics: "PRAGMA table_xinfo('topics')", sources: "PRAGMA table_xinfo('sources')",
  insights: "PRAGMA table_xinfo('insights')", evidence: "PRAGMA table_xinfo('evidence')", reviews: "PRAGMA table_xinfo('reviews')",
};
const requiredColumns: Record<Table, Record<string, string>> = {
  topics: { id: "TEXT", name: "TEXT", name_key: "TEXT", summary: "TEXT", created_at: "TEXT", updated_at: "TEXT" },
  sources: { id: "TEXT", title: "TEXT", url: "TEXT", platform: "TEXT", observed_at: "TEXT", transcription_id: "TEXT", total_units: "INTEGER", covered_units: "INTEGER" },
  insights: { id: "TEXT", source_id: "TEXT", topic_id: "TEXT", suggested_topic: "TEXT", kind: "TEXT", statement: "TEXT", status: "TEXT", created_at: "TEXT", updated_at: "TEXT" },
  evidence: { id: "TEXT", insight_id: "TEXT", source_id: "TEXT", quote: "TEXT", start_sec: "REAL", end_sec: "REAL", frame_file: "TEXT", source_url: "TEXT", observed_at: "TEXT" },
  reviews: { id: "TEXT", insight_id: "TEXT", action: "TEXT", previous_status: "TEXT", new_status: "TEXT", at: "TEXT" },
};
const derivedTables = new Set(["insight_search", "insight_search_data", "insight_search_idx", "insight_search_content", "insight_search_docsize", "insight_search_config"]);

export class KnowledgePreviewError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "KnowledgePreviewError"; }
}

export type KnowledgeSourceSnapshot = SourceSnapshot;
export function readKnowledgeSourceFile(absolutePath: string, relativePath: string, maximumBytes: number) {
  return readSourceSnapshot(absolutePath, relativePath, maximumBytes, KnowledgePreviewError);
}
export function assertKnowledgeSourceUnchanged(snapshot: KnowledgeSourceSnapshot) {
  return assertSourceSnapshotUnchanged(snapshot, KnowledgePreviewError);
}

async function rejectJournals(databasePath: string): Promise<void> {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const present = await lstat(`${databasePath}${suffix}`).then(() => true, (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
    if (present) throw new KnowledgePreviewError("sqlite_journal_files_present");
  }
}

function verifySchema(db: DatabaseSync): void {
  const objects = db.prepare("SELECT name,type,sql FROM sqlite_schema WHERE type IN ('table','view') ORDER BY name").all();
  const byName = new Map(objects.map((row) => [String(row.name), row]));
  for (const row of objects) {
    const name = String(row.name);
    if (name.startsWith("sqlite_")) continue;
    if (row.type !== "table") throw new KnowledgePreviewError("unsupported_knowledge_schema");
    if (derivedTables.has(name)) continue;
    if (!authoritativeTables.includes(name as Table)) throw new KnowledgePreviewError("unsupported_knowledge_schema");
  }
  if ([...byName.keys()].some((name) => derivedTables.has(name))) {
    const sql = byName.get("insight_search")?.sql;
    if (typeof sql !== "string" || !/^\s*CREATE\s+VIRTUAL\s+TABLE[\s\S]*\bUSING\s+fts5\s*\(/i.test(sql)) throw new KnowledgePreviewError("unsupported_knowledge_schema");
  }
  for (const table of authoritativeTables) {
    const object = byName.get(table);
    if (!object || object.type !== "table" || typeof object.sql !== "string" || /^\s*CREATE\s+VIRTUAL/i.test(object.sql)) throw new KnowledgePreviewError("unsupported_knowledge_schema");
    const columns = db.prepare(columnQueries[table]).all();
    if (columns.some((column) => column.hidden !== 0)) throw new KnowledgePreviewError("unsupported_knowledge_schema");
    const types = new Map(columns.map((column) => [String(column.name), String(column.type).toUpperCase()]));
    if (Object.entries(requiredColumns[table]).some(([name, type]) => types.get(name) !== type)) throw new KnowledgePreviewError("unsupported_knowledge_schema");
  }
}

function jsonRow(row: Record<string, unknown>): KnowledgeObject {
  const result: KnowledgeObject = Object.create(null);
  for (const [key, value] of Object.entries(row)) {
    if (value === null || typeof value === "string" || typeof value === "number" && Number.isFinite(value)) result[key] = value;
    else throw new KnowledgePreviewError("unsupported_sqlite_value");
  }
  return result;
}

export interface KnowledgePreviewManifest extends LegacyKnowledgeManifest {
  mode: "dry-run";
  snapshotCheckedUnchanged: true;
  mediaReconciled: false;
  librarySource: { sourceDigest: string; sourceCanonicalJson: string };
  sourceFiles: Array<{ relativePath: string; bytes: number; sha256: string }>;
}

/** Reads a quiescent current-schema database without invoking Substo's migrator. */
export async function inspectLegacyKnowledge(dataDirectory: string): Promise<KnowledgePreviewManifest> {
  const dataDir = await realpath(dataDirectory);
  const rootIdentity = await lstat(dataDir, { bigint: true });
  if (!rootIdentity.isDirectory()) throw new KnowledgePreviewError("invalid_source_directory");
  const databasePath = path.join(dataDir, "knowledge.sqlite");
  await rejectJournals(databasePath);
  const databaseFile = await readKnowledgeSourceFile(databasePath, "knowledge.sqlite", MAX_DATABASE_BYTES);
  if (databaseFile.bytes.length < 100 || databaseFile.bytes.subarray(0, 16).toString("binary") !== "SQLite format 3\0" || databaseFile.bytes[18] !== 1 || databaseFile.bytes[19] !== 1) throw new KnowledgePreviewError("sqlite_delete_journal_mode_required");
  const store = await readKnowledgeSourceFile(path.join(dataDir, "store.json"), "store.json", MAX_STORE_BYTES);
  const library = normalizeLegacyLibrary(JSON.parse(store.bytes.toString("utf8")));
  const snapshots = [databaseFile, store];
  const db = new DatabaseSync(databasePath, { readOnly: true });
  let sidecarDirectory: { path: string; info: BigIntStats; names: string[] } | null = null;
  try {
    db.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN;");
    const journalMode = db.prepare("PRAGMA journal_mode").get();
    if (journalMode?.journal_mode !== "delete") throw new KnowledgePreviewError("sqlite_delete_journal_mode_required");
    verifySchema(db);
    const exported: Record<Table, KnowledgeObject[]> = { topics: [], sources: [], insights: [], evidence: [], reviews: [] };
    let rowCount = 0;
    for (const table of authoritativeTables) {
      const rows = db.prepare(queries[table]).all(MAX_ROWS_PER_TABLE + 1);
      rowCount += rows.length;
      if (rows.length > MAX_ROWS_PER_TABLE || rowCount > MAX_TOTAL_ROWS) throw new KnowledgePreviewError("knowledge_row_limit_exceeded");
      exported[table] = rows.map(jsonRow);
    }
    const sidecarPath = path.join(dataDir, "knowledge-source-units");
    const folder = await lstat(sidecarPath, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const sidecars: KnowledgeObject[] = [];
    if (folder) {
      if (!folder.isDirectory() || folder.isSymbolicLink() || await realpath(sidecarPath) !== sidecarPath) throw new KnowledgePreviewError("unsafe_source_unit_directory");
      const names = (await readdir(sidecarPath)).sort();
      if (names.length > MAX_SIDECARS) throw new KnowledgePreviewError("source_unit_file_limit_exceeded");
      if (names.some((name) => !uuidJson.test(name))) throw new KnowledgePreviewError("unsupported_source_unit_filename");
      sidecarDirectory = { path: sidecarPath, info: folder, names };
      let totalSidecarBytes = 0;
      let totalSourceUnits = 0;
      for (const name of names) {
        const file = await readKnowledgeSourceFile(path.join(sidecarPath, name), `knowledge-source-units/${name}`, MAX_SIDECAR_BYTES);
        totalSidecarBytes += file.bytes.length;
        if (totalSidecarBytes > MAX_TOTAL_SIDECAR_BYTES) throw new KnowledgePreviewError("source_unit_byte_limit_exceeded");
        const payload: KnowledgeJson = JSON.parse(file.bytes.toString("utf8"));
        if (payload && typeof payload === "object" && !Array.isArray(payload) && Array.isArray(payload.units)) {
          totalSourceUnits += payload.units.length;
          if (rowCount + totalSourceUnits > MAX_TOTAL_ROWS) throw new KnowledgePreviewError("source_unit_row_limit_exceeded");
        }
        sidecars.push({ recordId: name.slice(0, -5), payload });
        snapshots.push(file);
      }
    }
    const manifest = normalizeLegacyKnowledge({ version: 1, ...exported, sourceUnits: sidecars }, { recordIds: library.records.map((record) => record.id) });
    const issues: KnowledgeIssue[] = [...manifest.issues];
    if (!library.valid) issues.push({ code: "library_relationships_invalid", path: "store.json", severity: "error" });
    await rejectJournals(databasePath);
    for (const snapshot of snapshots) await assertKnowledgeSourceUnchanged(snapshot);
    if (sidecarDirectory && (!sameIdentity(sidecarDirectory.info, await lstat(sidecarDirectory.path, { bigint: true })) || JSON.stringify(sidecarDirectory.names) !== JSON.stringify((await readdir(sidecarDirectory.path)).sort()))) throw new KnowledgePreviewError("source_changed_during_preview");
    if (!sameIdentity(rootIdentity, await lstat(dataDir, { bigint: true }))) throw new KnowledgePreviewError("source_changed_during_preview");
    db.exec("ROLLBACK;");
    db.close();
    await rejectJournals(databasePath);
    for (const snapshot of snapshots) await assertKnowledgeSourceUnchanged(snapshot);
    if (sidecarDirectory && (!sameIdentity(sidecarDirectory.info, await lstat(sidecarDirectory.path, { bigint: true })) || JSON.stringify(sidecarDirectory.names) !== JSON.stringify((await readdir(sidecarDirectory.path)).sort()))) throw new KnowledgePreviewError("source_changed_during_preview");
    if (!sameIdentity(rootIdentity, await lstat(dataDir, { bigint: true }))) throw new KnowledgePreviewError("source_changed_during_preview");
    issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
    return { ...manifest, valid: !issues.some((issue) => issue.severity === "error"), issues, mode: "dry-run", snapshotCheckedUnchanged: true,
      mediaReconciled: false, librarySource: { sourceDigest: library.sourceDigest, sourceCanonicalJson: library.sourceCanonicalJson },
      sourceFiles: snapshots.map((snapshot) => ({ relativePath: snapshot.relativePath, bytes: snapshot.bytes.length, sha256: snapshot.sha256 })).sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    };
  } finally {
    if (db.isOpen) { try { if (db.isTransaction) db.exec("ROLLBACK;"); } finally { db.close(); } }
  }
}
