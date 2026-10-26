import { StudioCommandError } from "./command-error";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const deviceOperations = ["heartbeat", "claim", "extend", "complete", "fail"] as const;
export type DeviceOperation = typeof deviceOperations[number];
export interface DeviceManagementCommand {
  action: "create" | "revoke" | "diagnostic"; requestId: string; name?: string; deviceId?: string;
  provider?: "codex" | "claude"; model?: string;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StudioCommandError("Invalid command.");
  return value as Record<string, unknown>;
}
function valid(condition: unknown): asserts condition { if (!condition) throw new StudioCommandError("Invalid command."); }
export function readDeviceManagementCommand(value: unknown): DeviceManagementCommand {
  const v = object(value);
  valid(["create", "revoke", "diagnostic"].includes(String(v.action)) && typeof v.requestId === "string" && uuid.test(v.requestId));
  valid(v.action === "create" ? typeof v.name === "string" && v.name.trim().length >= 1 && v.name.trim().length <= 100 : typeof v.deviceId === "string" && uuid.test(v.deviceId));
  valid(v.provider === undefined || v.action === "diagnostic" && ["codex", "claude"].includes(String(v.provider)));
  valid(v.model === undefined || v.provider !== undefined && typeof v.model === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(v.model));
  return { action: v.action as DeviceManagementCommand["action"], requestId: v.requestId, name: typeof v.name === "string" ? v.name.trim() : undefined,
    deviceId: v.deviceId as string | undefined, provider: v.provider as DeviceManagementCommand["provider"], model: v.model as string | undefined };
}
/** Whitelist capability fields. Provider tokens, environment and arbitrary report keys never persist. */
export function safeDeviceCapabilities(value: unknown): Record<string, unknown> {
  const v = object(value); const result: Record<string, unknown> = {};
  for (const key of ["instanceId", "platform", "arch", "version"])
    if (typeof v[key] === "string" && /^[A-Za-z0-9._:/ -]{1,100}$/.test(v[key])) result[key] = v[key];
  for (const key of ["healthy", "draining"]) if (typeof v[key] === "boolean") result[key] = v[key];
  if (Array.isArray(v.handlers)) result.handlers = v.handlers.filter(x => x === "studio.diagnostic");
  for (const provider of ["codex", "claude"]) {
    const raw = v[provider]; if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const p = raw as Record<string, unknown>; const out: Record<string, unknown> = {};
    for (const key of ["installed", "authenticated", "ready"]) if (typeof p[key] === "boolean") out[key] = p[key];
    if (typeof p.version === "string" && /^[A-Za-z0-9._ -]{1,100}$/.test(p.version)) out.version = p.version;
    if (Array.isArray(p.models)) out.models = p.models.filter(x => typeof x === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(x)).slice(0, 50);
    result[provider] = out;
  }
  return result;
}
export function readDeviceDiagnosticResult(value: unknown): Record<string, unknown> {
  const result = object(value);
  valid(Object.keys(result).every(key => ["ok", "workerId", "checkedAt", "provider", "model", "output", "summary", "durationMs"].includes(key)));
  valid(Object.entries(result).every(([key, v]) => key === "ok" ? typeof v === "boolean" : key === "durationMs" ? typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 3600000 : typeof v === "string" && v.length <= (["output", "summary"].includes(key) ? 3000 : 100)));
  valid(JSON.stringify(result).length <= 4096);
  return result;
}
export function readDeviceCommand(operation: DeviceOperation, value: unknown): Record<string, unknown> {
  const v = object(value);
  valid(typeof v.workerId === "string" && /^[A-Za-z0-9:._-]{1,100}$/.test(v.workerId));
  const out: Record<string, unknown> = { workerId: v.workerId };
  if (operation === "heartbeat") {
    valid(v.release === null || typeof v.release === "string" && v.release.length <= 100);
    valid(typeof v.startedAt === "string" && Number.isFinite(Date.parse(v.startedAt)) && Date.parse(v.startedAt) <= Date.now() + 300000);
    return { ...out, release: v.release, startedAt: v.startedAt, report: safeDeviceCapabilities(v.report ?? {}) };
  }
  if (operation === "claim" || operation === "extend") {
    valid(Number.isInteger(v.leaseSeconds) && Number(v.leaseSeconds) >= 10 && Number(v.leaseSeconds) <= 3600);
    out.leaseSeconds = v.leaseSeconds;
  }
  if (operation === "claim") { valid(Number.isInteger(v.limit) && Number(v.limit) >= 1 && Number(v.limit) <= 50); return { ...out, limit: v.limit }; }
  valid(typeof v.jobId === "string" && uuid.test(v.jobId) && typeof v.leaseToken === "string" && uuid.test(v.leaseToken));
  Object.assign(out, { jobId: v.jobId, leaseToken: v.leaseToken });
  if (operation === "complete") { out.result = readDeviceDiagnosticResult(v.result); }
  if (operation === "fail") {
    const f = object(v.failure); valid(typeof f.code === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(f.code));
    valid(typeof f.message === "string" && f.message.length <= 500 && typeof f.retryable === "boolean");
    valid(f.retryAfterSeconds === undefined || Number.isInteger(f.retryAfterSeconds) && Number(f.retryAfterSeconds) >= 1 && Number(f.retryAfterSeconds) <= 2678400);
    out.failure = { code: f.code, message: f.message, retryable: f.retryable, retryAfterSeconds: f.retryAfterSeconds };
  }
  return out;
}

/** Desired setup sent from Settings to a paired computer. Shared by the server and the companion. */
export interface StudioDeviceConfig {
  features: { transcription: boolean; text: boolean };
  languages: string[]; translationTargets: string[];
  preference: "quality" | "balanced" | "speed";
  textProvider: "codex" | "claude" | null; textModel: string | null;
  resources: {
    modelBudgetGb: number; minFreeDiskGb: number; allowOnBattery: boolean; maxConcurrentJobs: 1; launchAtLogin: boolean;
    workingHours: null | { start: string; end: string; timeZone: string };
  };
}
export const defaultDeviceConfig: StudioDeviceConfig = Object.freeze({
  features: Object.freeze({ transcription: false, text: false }), languages: Object.freeze(["en"]) as unknown as string[], translationTargets: Object.freeze([]) as unknown as string[],
  preference: "balanced", textProvider: null, textModel: null,
  resources: Object.freeze({ modelBudgetGb: 20, minFreeDiskGb: 20, allowOnBattery: false, maxConcurrentJobs: 1, launchAtLogin: false, workingHours: null }),
}) as StudioDeviceConfig;
const modelName = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const time = /^([01]\d|2[0-3]):[0-5]\d$/;
function exactKeys(v: Record<string, unknown>, keys: string[]) { valid(Object.keys(v).every(key => keys.includes(key)) && keys.every(key => key in v)); }
export function isIanaTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(value)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
}
function languageList(value: unknown, min: number): string[] {
  valid(Array.isArray(value) && value.length >= min && value.length <= 20);
  const out: string[] = [];
  for (const item of value as unknown[]) {
    valid(typeof item === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(item));
    let canonical: string;
    try { canonical = Intl.getCanonicalLocales(item)[0]; } catch { throw new StudioCommandError("Invalid command."); }
    if (!out.includes(canonical)) out.push(canonical);
  }
  return out;
}
function numberIn(value: unknown, min: number, max: number): number {
  valid(typeof value === "number" && Number.isFinite(value) && value >= min && value <= max);
  return value as number;
}
/** Throws StudioCommandError on any unknown key or out-of-range value; returns a normalized copy. */
export function readDeviceConfig(value: unknown): StudioDeviceConfig {
  const v = object(value);
  exactKeys(v, ["features", "languages", "translationTargets", "preference", "textProvider", "textModel", "resources"]);
  const features = object(v.features); exactKeys(features, ["transcription", "text"]);
  valid(typeof features.transcription === "boolean" && typeof features.text === "boolean");
  valid(["quality", "balanced", "speed"].includes(String(v.preference)));
  valid(v.textProvider === null || v.textProvider === "codex" || v.textProvider === "claude");
  valid(v.textModel === null || v.textProvider !== null && typeof v.textModel === "string" && modelName.test(v.textModel));
  const r = object(v.resources);
  exactKeys(r, ["modelBudgetGb", "minFreeDiskGb", "allowOnBattery", "maxConcurrentJobs", "launchAtLogin", "workingHours"]);
  valid(typeof r.allowOnBattery === "boolean" && typeof r.launchAtLogin === "boolean" && r.maxConcurrentJobs === 1);
  let workingHours: StudioDeviceConfig["resources"]["workingHours"] = null;
  if (r.workingHours !== null) {
    const w = object(r.workingHours); exactKeys(w, ["start", "end", "timeZone"]);
    valid(typeof w.start === "string" && time.test(w.start) && typeof w.end === "string" && time.test(w.end) && w.start !== w.end && isIanaTimeZone(w.timeZone));
    workingHours = { start: w.start as string, end: w.end as string, timeZone: w.timeZone as string };
  }
  return {
    features: { transcription: features.transcription as boolean, text: features.text as boolean },
    languages: languageList(v.languages, 1), translationTargets: languageList(v.translationTargets, 0),
    preference: v.preference as StudioDeviceConfig["preference"],
    textProvider: v.textProvider as StudioDeviceConfig["textProvider"], textModel: v.textModel as string | null,
    resources: { modelBudgetGb: numberIn(r.modelBudgetGb, 1, 500), minFreeDiskGb: numberIn(r.minFreeDiskGb, 5, 500),
      allowOnBattery: r.allowOnBattery as boolean, maxConcurrentJobs: 1, launchAtLogin: r.launchAtLogin as boolean, workingHours },
  };
}
