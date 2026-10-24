import { createHash } from "node:crypto";
import { canonicalJson, type ImportIssue, type JsonObject, type JsonValue } from "./legacy-library";
import { readScheduleDraft, type ScheduleDraft } from "../schedule-policy";

export class ScheduleImportError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "ScheduleImportError"; }
}
export interface LegacyScheduleRow {
  sourceIndex: number;
  id: string | null;
  draft: ScheduleDraft | null;
  payload: JsonValue;
}
export interface LegacyScheduleRun {
  sourceIndex: number;
  id: string | null;
  scheduleId: string | null;
  payload: JsonValue;
}
export interface LegacySchedulesManifest {
  schema: "studio.legacy-schedules.v1";
  sourceCanonicalJson: string;
  sourceDigest: string;
  valid: boolean;
  executionEnabled: false;
  applySupported: false;
  schedules: LegacyScheduleRow[];
  runs: LegacyScheduleRun[];
  counts: { schedules: number; runs: number; legacyEnabled: number; discovery: number; inFlightRuns: number };
  issues: ImportIssue[];
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const presets = new Set(["youtube-discovery", "idea-review", "script-brief"]);
const runStates = new Set(["running", "queued", "completed", "failed", "timeout", "interrupted"]);
const object = (value: unknown): value is JsonObject => Boolean(value && typeof value === "object" && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
const id = (value: JsonValue | undefined): string | null => typeof value === "string" && uuid.test(value) ? value.toLowerCase() : null;
// Local scheduler writes UTC ISO instants; reject ambiguous or normalized dates.
const timestamp = (value: JsonValue | undefined): value is string => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z");
function channelIdentity(value: JsonValue | undefined): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)
      && !url.username && !url.password && !url.port
      && /^\/(?:@[^/?#]+|channel\/[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)\/?$/.test(url.pathname)
      ? url.pathname.replace(/\/$/, "") : null;
  } catch { return null; }
}
function json(value: unknown, depth = 0): value is JsonValue {
  if (depth > 100) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
  if (Array.isArray(value)) return value.every(entry => json(entry, depth + 1));
  return object(value) && Object.values(value).every(entry => json(entry, depth + 1));
}

/** Metadata preview only: retain every source row, including invalid diagnostic rows. */
export function normalizeLegacySchedules(input: unknown): LegacySchedulesManifest {
  if (!json(input) || !object(input) || input.version !== 1 || !Array.isArray(input.schedules) || !Array.isArray(input.runs)) throw new ScheduleImportError("invalid_schedules_v1");
  if (input.schedules.length > 10_000 || input.runs.length > 50_000) throw new ScheduleImportError("schedule_row_limit_exceeded");
  const issues: ImportIssue[] = [];
  const issue = (code: string, path: string, severity: ImportIssue["severity"] = "error") => issues.push({ code, path, severity });
  const scheduleIds = new Set<string>();
  const runIds = new Set<string>();
  const schedules = input.schedules.map((payload, sourceIndex): LegacyScheduleRow => {
    const path = `schedules[${sourceIndex}]`;
    const rowId = object(payload) ? id(payload.id) : null;
    if (!rowId) issue("invalid_schedule_id", `${path}.id`);
    else if (scheduleIds.has(rowId)) issue("duplicate_schedule_id", `${path}.id`);
    else scheduleIds.add(rowId);
    let draft: ScheduleDraft | null = null;
    if (!object(payload)) issue("invalid_schedule_row", path);
    else {
      if (typeof payload.presetId !== "string" || !presets.has(payload.presetId)) issue("unsupported_workflow", `${path}.presetId`);
      if (typeof payload.query !== "string") issue("invalid_focus", `${path}.query`);
      if (payload.intervalHours !== 24 && payload.intervalHours !== 168) issue("unsupported_cadence", `${path}.intervalHours`);
      if (payload.timeZone !== "Asia/Nicosia") issue("unsupported_time_zone", `${path}.timeZone`);
      if (typeof payload.enabled !== "boolean") issue("invalid_enabled_state", `${path}.enabled`);
      if (payload.autoKnowledgeScan !== undefined && typeof payload.autoKnowledgeScan !== "boolean") issue("invalid_auto_knowledge_scan", `${path}.autoKnowledgeScan`);
      for (const field of ["createdAt", "updatedAt", "nextRunAt"]) if (!timestamp(payload[field])) issue("invalid_timestamp", `${path}.${field}`);
      if (payload.lastRunAt !== undefined && !timestamp(payload.lastRunAt)) issue("invalid_timestamp", `${path}.lastRunAt`);
      if (timestamp(payload.createdAt) && timestamp(payload.updatedAt) && Date.parse(payload.updatedAt) < Date.parse(payload.createdAt)) issue("invalid_schedule_time_order", path);
      // Use the hosted draft contract without coercing malformed/missing source values.
      if (typeof payload.presetId === "string" && typeof payload.query === "string" && typeof payload.intervalHours === "number" && typeof payload.dailyTime === "string") {
        const form = new FormData();
        for (const [key, value] of Object.entries({ presetId: payload.presetId, query: payload.query, intervalHours: String(payload.intervalHours), dailyTime: payload.dailyTime })) form.set(key, value);
        try { draft = readScheduleDraft(form); } catch { issue("unsupported_hosted_draft", path); }
      } else issue("unsupported_hosted_draft", path);
      for (const field of ["channelUrl", "transcriptionId", "inputKey", "recordId", "inputHash"]) if (payload[field] !== undefined && typeof payload[field] !== "string") issue("invalid_workflow_field", `${path}.${field}`);
      if (typeof payload.channelUrl === "string" && payload.channelUrl !== "" && !channelIdentity(payload.channelUrl)) issue("invalid_channel_url", `${path}.channelUrl`);
      if (payload.channelTargets !== undefined) {
        if (!Array.isArray(payload.channelTargets) || payload.channelTargets.length > 8) issue("invalid_channel_targets", `${path}.channelTargets`);
        else {
          const channels = new Set<string>();
          for (const [index, target] of payload.channelTargets.entries()) {
            const identity = object(target) ? channelIdentity(target.url) : null;
            if (!object(target) || !identity || !["owner", "reference"].includes(String(target.role)) || typeof target.title !== "string") issue("invalid_channel_target", `${path}.channelTargets[${index}]`);
            if (identity && channels.has(identity)) issue("duplicate_channel_target", `${path}.channelTargets[${index}]`);
            if (identity) channels.add(identity);
          }
        }
      }
      if (payload.presetId === "youtube-discovery") issue("discovery_authorization_requires_review", path, "warning");
      if (payload.autoKnowledgeScan === true) issue("automatic_knowledge_scan_not_ported", `${path}.autoKnowledgeScan`, "warning");
      if (payload.enabled === true) issue("legacy_enabled_not_activated", `${path}.enabled`, "warning");
    }
    return { sourceIndex, id: rowId, draft, payload: structuredClone(payload) };
  });
  const runs = input.runs.map((payload, sourceIndex): LegacyScheduleRun => {
    const path = `runs[${sourceIndex}]`;
    const rowId = object(payload) ? id(payload.id) : null;
    const scheduleId = object(payload) ? id(payload.scheduleId) : null;
    if (!rowId) issue("invalid_run_id", `${path}.id`);
    else if (runIds.has(rowId)) issue("duplicate_run_id", `${path}.id`);
    else runIds.add(rowId);
    if (!scheduleId || !scheduleIds.has(scheduleId)) issue("missing_run_schedule", `${path}.scheduleId`);
    if (!object(payload)) issue("invalid_run_row", path);
    else {
      if (typeof payload.presetId !== "string" || !presets.has(payload.presetId)) issue("unsupported_workflow", `${path}.presetId`);
      if (typeof payload.status !== "string" || !runStates.has(payload.status)) issue("unsupported_run_status", `${path}.status`);
      if (!timestamp(payload.startedAt)) issue("invalid_timestamp", `${path}.startedAt`);
      if (payload.completedAt !== null && !timestamp(payload.completedAt)) issue("invalid_timestamp", `${path}.completedAt`);
      if (["completed", "failed", "timeout", "interrupted"].includes(String(payload.status)) && payload.completedAt === null) issue("missing_completion_time", `${path}.completedAt`);
      if (timestamp(payload.startedAt) && timestamp(payload.completedAt) && Date.parse(payload.completedAt) < Date.parse(payload.startedAt)) issue("invalid_run_time_order", path);
      for (const field of ["output", "error"]) if (typeof payload[field] !== "string") issue("invalid_run_text", `${path}.${field}`);
      if (payload.jobId !== undefined && typeof payload.jobId !== "string") issue("invalid_job_reference", `${path}.jobId`);
      if (payload.status === "running" || payload.status === "queued") issue("historical_run_not_resumable", path, "warning");
    }
    return { sourceIndex, id: rowId, scheduleId, payload: structuredClone(payload) };
  });
  const sourceCanonicalJson = canonicalJson(input);
  const counts = {
    schedules: schedules.length, runs: runs.length,
    legacyEnabled: input.schedules.filter(row => object(row) && row.enabled === true).length,
    discovery: input.schedules.filter(row => object(row) && row.presetId === "youtube-discovery").length,
    inFlightRuns: input.runs.filter(row => object(row) && (row.status === "running" || row.status === "queued")).length,
  };
  issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
  return { schema: "studio.legacy-schedules.v1", sourceCanonicalJson,
    sourceDigest: createHash("sha256").update(sourceCanonicalJson, "utf8").digest("hex"),
    valid: !issues.some(entry => entry.severity === "error"), executionEnabled: false, applySupported: false,
    schedules, runs, counts, issues };
}
