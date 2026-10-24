import { createHash } from "node:crypto";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type LegacyRecordKind = "reference" | "channel" | "content";
export interface ImportIssue { code: string; path: string; severity: "error" | "warning"; }
export interface LegacyLibraryRecord {
  id: string;
  kind: LegacyRecordKind;
  title: string;
  sourceUrl: string | null;
  linkedIds: string[];
  attachments: string[];
  payload: JsonObject;
}
export interface LegacyLibraryFile {
  id: string;
  recordId: string;
  relativePath: string;
  payload: JsonObject;
}
export interface LegacyLibraryManifest {
  schema: "studio.legacy-library.v1";
  sourceDigest: string;
  /** Canonical full source export, including unknown top-level metadata and original array order. */
  sourceCanonicalJson: string;
  valid: boolean;
  records: LegacyLibraryRecord[];
  files: LegacyLibraryFile[];
  counts: { records: number; library: number; channels: number; content: number; files: number; links: number };
  issues: ImportIssue[];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kinds = new Set(["reference", "channel", "content"]);

export class LegacyImportValidationError extends Error {
  constructor(public readonly issues: ImportIssue[]) {
    super("Legacy store failed validation. The source was not changed.");
    this.name = "LegacyImportValidationError";
  }
}

function object(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}

export function safeLegacySourceUrl(value: JsonValue | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Canonical key order makes the digest independent of JSON formatting/key order. */
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function validJson(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(validJson);
  return object(value) && Object.values(value).every(validJson);
}

/** Validate without cleaning/truncating transcript, provenance or review fields. */
export function normalizeLegacyLibrary(input: unknown): LegacyLibraryManifest {
  const issues: ImportIssue[] = [];
  const issue = (code: string, path: string, severity: ImportIssue["severity"] = "error") => issues.push({ code, path, severity });
  if (!validJson(input) || !object(input) || input.version !== 1 || !Array.isArray(input.records) || !Array.isArray(input.files)) {
    throw new LegacyImportValidationError([{ code: "invalid_store_v1", path: "$", severity: "error" }]);
  }

  const recordIds = new Set<string>();
  const records: LegacyLibraryRecord[] = [];
  for (const [index, value] of input.records.entries()) {
    const field = `records[${index}]`;
    if (!object(value) || typeof value.id !== "string" || !uuid.test(value.id) || typeof value.kind !== "string" || !kinds.has(value.kind) || typeof value.title !== "string" || !value.title.trim()) {
      issue("invalid_record", field); continue;
    }
    const id = value.id.toLowerCase();
    if (recordIds.has(id)) { issue("duplicate_record_id", field); continue; }
    recordIds.add(id);
    const linkedIds = value.linkedIds ?? [];
    if (!Array.isArray(linkedIds) || linkedIds.some((id) => typeof id !== "string" || !uuid.test(id))) {
      issue("invalid_linked_ids", `${field}.linkedIds`); continue;
    }
    const normalizedLinkedIds = linkedIds.map((linkedId) => String(linkedId).toLowerCase());
    if (new Set(normalizedLinkedIds).size !== normalizedLinkedIds.length) {
      issue("duplicate_linked_id", `${field}.linkedIds`);
    }
    for (const flag of ["approved", "archived"]) {
      if (value[flag] !== undefined && typeof value[flag] !== "boolean") issue("invalid_review_state", `${field}.${flag}`);
    }
    for (const text of ["url", "summary", "notes", "transcript", "script", "platform", "handle", "channelName"]) {
      if (value[text] !== undefined && typeof value[text] !== "string") issue("invalid_text_field", `${field}.${text}`);
    }
    records.push({ id, kind: value.kind as LegacyRecordKind, title: value.title, sourceUrl: safeLegacySourceUrl(value.url), linkedIds: normalizedLinkedIds, attachments: [], payload: structuredClone(value) });
  }

  const fileIds = new Set<string>();
  const files: LegacyLibraryFile[] = [];
  for (const [index, value] of input.files.entries()) {
    const field = `files[${index}]`;
    if (!object(value) || typeof value.id !== "string" || !uuid.test(value.id) || typeof value.recordId !== "string" || !uuid.test(value.recordId) || typeof value.name !== "string" || !value.name || /[\\/\x00-\x1f]/.test(value.name) || value.name === "." || value.name === ".." || typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 0 || typeof value.type !== "string" || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(value.type)) {
      issue("invalid_file_metadata", field); continue;
    }
    const id = value.id.toLowerCase();
    if (fileIds.has(id)) { issue("duplicate_file_id", field); continue; }
    fileIds.add(id);
    const recordId = value.recordId.toLowerCase();
    if (!recordIds.has(recordId)) issue("missing_file_record", `${field}.recordId`);
    files.push({ id, recordId, relativePath: `files/${value.id}`, payload: structuredClone(value) });
  }
  // Structural failures reject the entire batch; never produce a partial import.
  if (issues.length) throw new LegacyImportValidationError(issues);

  records.sort((a, b) => a.id.localeCompare(b.id));
  files.sort((a, b) => a.id.localeCompare(b.id));
  const recordsById = new Map(records.map((record) => [record.id, record]));
  for (const record of records) {
    if (record.payload.url && !record.sourceUrl) issue("unsafe_source_url", `records.${record.id}.url`, "warning");
    for (const linkedId of record.linkedIds) {
      if (linkedId === record.id) issue("self_link", `records.${record.id}.linkedIds`);
      else if (!recordsById.has(linkedId)) issue("missing_linked_record", `records.${record.id}.linkedIds.${linkedId}`);
    }
  }
  for (const file of files) recordsById.get(file.recordId)?.attachments.push(file.id);
  const sourceCanonicalJson = canonicalJson(input);
  if (Buffer.byteLength(sourceCanonicalJson, "utf8") > 100 * 1024 * 1024) {
    throw new LegacyImportValidationError([{ code: "source_snapshot_too_large", path: "$", severity: "error" }]);
  }
  const sourceDigest = createHash("sha256").update(sourceCanonicalJson, "utf8").digest("hex");
  return {
    schema: "studio.legacy-library.v1", sourceDigest, sourceCanonicalJson, valid: !issues.some((issue) => issue.severity === "error"), records, files,
    counts: { records: records.length, library: records.filter((r) => r.kind === "reference").length, channels: records.filter((r) => r.kind === "channel").length, content: records.filter((r) => r.kind === "content").length, files: files.length, links: records.reduce((n, r) => n + r.linkedIds.length, 0) },
    issues: issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code)),
  };
}
