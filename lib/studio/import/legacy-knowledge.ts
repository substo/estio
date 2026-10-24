import { createHash } from "node:crypto";

export type KnowledgeJson = null | boolean | number | string | KnowledgeJson[] | { [key: string]: KnowledgeJson };
export type KnowledgeObject = { [key: string]: KnowledgeJson };
export interface KnowledgeIssue { code: string; path: string; severity: "error" | "warning"; }
export interface LegacyKnowledgeManifest {
  schema: "studio.legacy-knowledge.v1";
  sourceDigest: string;
  /** Canonical complete export snapshot, including raw sidecar envelopes. */
  sourceCanonicalJson: string;
  valid: boolean;
  topics: KnowledgeObject[];
  sources: KnowledgeObject[];
  insights: KnowledgeObject[];
  evidence: KnowledgeObject[];
  reviews: KnowledgeObject[];
  sourceUnitSidecars: KnowledgeObject[];
  sourceUnits: KnowledgeObject[];
  counts: { topics: number; sources: number; insights: number; evidence: number; reviews: number; sourceUnitSidecars: number; sourceUnits: number; pending: number; approved: number; rejected: number; uncoveredUnits: number };
  issues: KnowledgeIssue[];
}
export interface LegacyKnowledgeOptions { recordIds?: readonly string[]; }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kinds = new Set(["claim", "method", "example", "question", "objection", "content_pattern"]);
const statuses = new Set(["pending", "approved", "rejected"]);

function object(value: unknown): value is KnowledgeObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}
function validJson(value: unknown): value is KnowledgeJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(validJson);
  return object(value) && Object.values(value).every(validJson);
}
export function canonicalKnowledgeJson(value: KnowledgeJson): string {
  if (Array.isArray(value)) return `[${value.map(canonicalKnowledgeJson).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalKnowledgeJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function derivedId(identity: string): string {
  const hex = createHash("sha256").update(identity).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const raw = hex.join("");
  return `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
}
function validTimestamp(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}
function rows(value: KnowledgeJson, key: string, issues: KnowledgeIssue[]): KnowledgeObject[] {
  if (!Array.isArray(value)) { issues.push({ code: "unsupported_shape", path: key, severity: "error" }); return []; }
  return value.map((row, index) => {
    if (!object(row)) {
      issues.push({ code: "unsupported_row", path: `${key}[${index}]`, severity: "error" });
      return { _unparsed_legacy_value: row };
    }
    return structuredClone(row);
  });
}

/**
 * Normalize exported SQLite rows only. This function never reads local SQLite,
 * sidecar files or media; complete row objects are retained verbatim as JSON.
 */
export function normalizeLegacyKnowledge(input: unknown, options: LegacyKnowledgeOptions = {}): LegacyKnowledgeManifest {
  const issues: KnowledgeIssue[] = [];
  if (!validJson(input) || !object(input) || input.version !== 1) {
    return { schema: "studio.legacy-knowledge.v1", sourceDigest: "", sourceCanonicalJson: "", valid: false, topics: [], sources: [], insights: [], evidence: [], reviews: [], sourceUnitSidecars: [], sourceUnits: [], counts: { topics: 0, sources: 0, insights: 0, evidence: 0, reviews: 0, sourceUnitSidecars: 0, sourceUnits: 0, pending: 0, approved: 0, rejected: 0, uncoveredUnits: 0 }, issues: [{ code: "invalid_store_v1", path: "$", severity: "error" }] };
  }
  const topicRows = rows(input.topics, "topics", issues);
  const sourceRows = rows(input.sources, "sources", issues);
  const insightRows = rows(input.insights, "insights", issues);
  const evidenceRows = rows(input.evidence, "evidence", issues);
  const reviewRows = rows(input.reviews, "reviews", issues);
  const sidecars = input.sourceUnits === undefined ? [] : rows(input.sourceUnits, "sourceUnits", issues);

  const indexed = (values: KnowledgeObject[], name: string) => {
    const ids = new Map<string, KnowledgeObject>();
    values.forEach((row, index) => {
      if (typeof row.id !== "string" || !uuid.test(row.id)) { issues.push({ code: "invalid_id", path: `${name}[${index}].id`, severity: "error" }); return; }
      const id = row.id.toLowerCase();
      if (ids.has(id)) issues.push({ code: "duplicate_id", path: `${name}[${index}].id`, severity: "error" });
      else ids.set(id, row);
    });
    return ids;
  };
  const topics = indexed(topicRows, "topics"), sources = indexed(sourceRows, "sources"), insights = indexed(insightRows, "insights");
  indexed(evidenceRows, "evidence"); indexed(reviewRows, "reviews");
  const id = (row: KnowledgeObject, key: string) => typeof row[key] === "string" ? String(row[key]).toLowerCase() : "";
  const recordIdSet = new Set((options.recordIds ?? []).filter((value) => typeof value === "string" && uuid.test(value)).map((value) => value.toLowerCase()));
  if (sourceRows.length && options.recordIds === undefined) issues.push({ code: "missing_record_id_context", path: "options.recordIds", severity: "error" });
  for (const [index, row] of sourceRows.entries()) {
    if (options.recordIds !== undefined && !recordIdSet.has(id(row, "id"))) issues.push({ code: "missing_library_record", path: `sources[${index}].id`, severity: "error" });
    for (const field of ["title", "url", "platform", "transcription_id"]) if (typeof row[field] !== "string") issues.push({ code: "invalid_source_field", path: `sources[${index}].${field}`, severity: "error" });
    if (!validTimestamp(row.observed_at)) issues.push({ code: "invalid_timestamp", path: `sources[${index}].observed_at`, severity: "error" });
  }
  const topicKeys = new Set<string>();
  for (const [index, row] of topicRows.entries()) {
    for (const field of ["name", "name_key", "summary", "created_at", "updated_at"]) if (typeof row[field] !== "string") issues.push({ code: "invalid_topic_field", path: `topics[${index}].${field}`, severity: "error" });
    if (typeof row.name === "string" && !row.name.trim() || typeof row.name_key === "string" && !row.name_key.trim()) issues.push({ code: "invalid_topic_field", path: `topics[${index}]`, severity: "error" });
    for (const field of ["created_at", "updated_at"]) if (!validTimestamp(row[field])) issues.push({ code: "invalid_timestamp", path: `topics[${index}].${field}`, severity: "error" });
    if (typeof row.name_key === "string") {
      if (topicKeys.has(row.name_key)) issues.push({ code: "duplicate_topic_name_key", path: `topics[${index}].name_key`, severity: "error" });
      topicKeys.add(row.name_key);
    }
  }
  for (const [index, row] of insightRows.entries()) {
    if (!sources.has(id(row, "source_id"))) issues.push({ code: "missing_source", path: `insights[${index}].source_id`, severity: "error" });
    if (row.topic_id !== null && row.topic_id !== undefined && !topics.has(id(row, "topic_id"))) issues.push({ code: "missing_topic", path: `insights[${index}].topic_id`, severity: "error" });
    if (typeof row.statement !== "string") issues.push({ code: "unsupported_statement", path: `insights[${index}].statement`, severity: "error" });
    if (typeof row.kind !== "string" || !kinds.has(row.kind)) issues.push({ code: "unsupported_kind", path: `insights[${index}].kind`, severity: "error" });
    if (typeof row.status !== "string" || !statuses.has(row.status)) issues.push({ code: "unsupported_status", path: `insights[${index}].status`, severity: "error" });
    if (typeof row.suggested_topic !== "string") issues.push({ code: "invalid_insight_field", path: `insights[${index}].suggested_topic`, severity: "error" });
    for (const field of ["created_at", "updated_at"]) if (!validTimestamp(row[field])) issues.push({ code: "invalid_timestamp", path: `insights[${index}].${field}`, severity: "error" });
  }
  for (const [index, row] of evidenceRows.entries()) {
    const insight = insights.get(id(row, "insight_id"));
    if (!insight) issues.push({ code: "missing_insight", path: `evidence[${index}].insight_id`, severity: "error" });
    if (!sources.has(id(row, "source_id"))) issues.push({ code: "missing_source", path: `evidence[${index}].source_id`, severity: "error" });
    else if (insight && id(insight, "source_id") !== id(row, "source_id")) issues.push({ code: "evidence_source_mismatch", path: `evidence[${index}].source_id`, severity: "error" });
    for (const field of ["quote", "frame_file", "source_url"]) if (typeof row[field] !== "string") issues.push({ code: "invalid_evidence_field", path: `evidence[${index}].${field}`, severity: "error" });
    if (!validTimestamp(row.observed_at)) issues.push({ code: "invalid_timestamp", path: `evidence[${index}].observed_at`, severity: "error" });
    for (const field of ["start_sec", "end_sec"]) if (row[field] !== null && row[field] !== undefined && (typeof row[field] !== "number" || !Number.isFinite(row[field]) || row[field] < 0)) issues.push({ code: "invalid_evidence_time", path: `evidence[${index}].${field}`, severity: "error" });
    if (typeof row.start_sec === "number" && typeof row.end_sec === "number" && row.end_sec < row.start_sec) issues.push({ code: "invalid_evidence_range", path: `evidence[${index}]`, severity: "error" });
  }
  for (const [index, row] of reviewRows.entries()) {
    if (!insights.has(id(row, "insight_id"))) issues.push({ code: "missing_insight", path: `reviews[${index}].insight_id`, severity: "error" });
    if (!(["approve", "reject", "reopen"].includes(String(row.action)) && statuses.has(String(row.previous_status)) && statuses.has(String(row.new_status)))) issues.push({ code: "invalid_review_state", path: `reviews[${index}]`, severity: "error" });
    else {
      const expected = row.action === "approve" ? "approved" : row.action === "reject" ? "rejected" : "pending";
      if (row.new_status !== expected) issues.push({ code: "invalid_review_transition", path: `reviews[${index}].new_status`, severity: "error" });
    }
    if (!validTimestamp(row.at)) issues.push({ code: "invalid_timestamp", path: `reviews[${index}].at`, severity: "error" });
  }
  for (const [index, row] of sourceRows.entries()) {
    for (const field of ["total_units", "covered_units"]) if (!Number.isSafeInteger(row[field]) || Number(row[field]) < 0) issues.push({ code: "invalid_coverage", path: `sources[${index}].${field}`, severity: "error" });
    if (Number.isSafeInteger(row.total_units) && Number.isSafeInteger(row.covered_units) && Number(row.covered_units) > Number(row.total_units)) issues.push({ code: "coverage_exceeds_total", path: `sources[${index}].covered_units`, severity: "error" });
  }
  const unitRows: KnowledgeObject[] = [];
  const sidecarRows: KnowledgeObject[] = [];
  const sidecarIdentity = new Set<string>();
  const unitIds = new Set<string>();
  const sidecarBySource = new Map<string, { transcriptionId: string; unitCount: number }>();
  for (const [sidecarIndex, sidecar] of sidecars.entries()) {
    const path = `sourceUnits[${sidecarIndex}]`;
    const recordId = typeof sidecar.recordId === "string" ? sidecar.recordId.toLowerCase() : "";
    const payload = sidecar.payload;
    if (!uuid.test(recordId) || !sources.has(recordId)) issues.push({ code: "missing_source", path: `${path}.recordId`, severity: "error" });
    if (!object(payload) || typeof payload.transcriptionId !== "string" || !Array.isArray(payload.units)) {
      issues.push({ code: "unsupported_sidecar_shape", path: `${path}.payload`, severity: "error" });
      const recordId = typeof sidecar.recordId === "string" ? sidecar.recordId.toLowerCase() : "";
      const transcriptionId = object(payload) && typeof payload.transcriptionId === "string" ? payload.transcriptionId : "";
      sidecarRows.push({ id: derivedId(`invalid-sidecar\0${sidecarIndex}\0${canonicalKnowledgeJson(sidecar)}`), source_id: recordId, transcription_id: transcriptionId, payload: structuredClone(sidecar), invalid: true });
      continue;
    }
    const identity = `${recordId}\0${payload.transcriptionId}`;
    if (sidecarIdentity.has(identity)) issues.push({ code: "duplicate_sidecar", path, severity: "error" });
    sidecarIdentity.add(identity);
    if (sidecarBySource.has(recordId)) issues.push({ code: "multiple_source_sidecars", path, severity: "error" });
    sidecarBySource.set(recordId, { transcriptionId: payload.transcriptionId, unitCount: payload.units.length });
    const sidecarId = derivedId(`sidecar\0${identity}`);
    sidecarRows.push({ id: sidecarId, source_id: recordId, transcription_id: payload.transcriptionId, payload: structuredClone(sidecar) });
    for (const [unitIndex, unit] of payload.units.entries()) {
      if (!object(unit) || typeof unit.text !== "string" || (unit.start !== undefined && (typeof unit.start !== "number" || !Number.isFinite(unit.start))) || (unit.end !== undefined && (typeof unit.end !== "number" || !Number.isFinite(unit.end))) || (unit.frameFile !== undefined && typeof unit.frameFile !== "string")) {
        issues.push({ code: "unsupported_unit_shape", path: `${path}.payload.units[${unitIndex}]`, severity: "error" });
      } else {
        if (typeof unit.start === "number" && unit.start < 0 || typeof unit.end === "number" && unit.end < 0) issues.push({ code: "invalid_unit_time", path: `${path}.payload.units[${unitIndex}]`, severity: "error" });
        if (typeof unit.start === "number" && typeof unit.end === "number" && unit.end < unit.start) issues.push({ code: "invalid_unit_range", path: `${path}.payload.units[${unitIndex}]`, severity: "error" });
      }
      const unitId = derivedId(`unit\0${identity}\0${unitIndex}`);
      if (unitIds.has(unitId)) issues.push({ code: "duplicate_unit_id", path: `${path}.payload.units[${unitIndex}]`, severity: "error" });
      unitIds.add(unitId);
      unitRows.push({ id: unitId, sidecar_id: sidecarId, source_id: recordId, transcription_id: payload.transcriptionId, unit_index: unitIndex, payload: { unit: structuredClone(unit) } });
    }
  }
  for (const [index, row] of sourceRows.entries()) {
    const sourceId = id(row, "id");
    const sidecar = sidecarBySource.get(sourceId);
    const total = Number.isSafeInteger(row.total_units) ? Number(row.total_units) : null;
    if (total !== null && total > 0 && !sidecar) issues.push({ code: "missing_source_unit_sidecar", path: `sources[${index}].id`, severity: "error" });
    if (sidecar && total !== null && sidecar.unitCount !== total) issues.push({ code: "source_unit_count_mismatch", path: `sources[${index}].total_units`, severity: "error" });
    if (sidecar && typeof row.transcription_id === "string" && sidecar.transcriptionId !== row.transcription_id) issues.push({ code: "source_unit_transcription_mismatch", path: `sources[${index}].transcription_id`, severity: "error" });
  }
  const counts = {
    topics: topicRows.length, sources: sourceRows.length, insights: insightRows.length, evidence: evidenceRows.length, reviews: reviewRows.length, sourceUnitSidecars: sidecarRows.length, sourceUnits: unitRows.length,
    pending: insightRows.filter((row) => row.status === "pending").length,
    approved: insightRows.filter((row) => row.status === "approved").length,
    rejected: insightRows.filter((row) => row.status === "rejected").length,
    uncoveredUnits: sourceRows.reduce((sum, row) => sum + (Number.isSafeInteger(row.total_units) && Number.isSafeInteger(row.covered_units) ? Math.max(0, Number(row.total_units) - Number(row.covered_units)) : 0), 0),
  };
  const sourceCanonicalJson = canonicalKnowledgeJson(input);
  if (Buffer.byteLength(sourceCanonicalJson, "utf8") > 100 * 1024 * 1024) {
    issues.push({ code: "source_snapshot_too_large", path: "$", severity: "error" });
  }
  const digest = createHash("sha256").update(sourceCanonicalJson, "utf8").digest("hex");
  issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
  return { schema: "studio.legacy-knowledge.v1", sourceDigest: digest, sourceCanonicalJson, valid: !issues.some((entry) => entry.severity === "error"), topics: topicRows, sources: sourceRows, insights: insightRows, evidence: evidenceRows, reviews: reviewRows, sourceUnitSidecars: sidecarRows, sourceUnits: unitRows, counts, issues };
}
