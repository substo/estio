import { StudioCommandError } from "./command-error";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
export const deviceOperations = ["heartbeat", "claim", "extend", "complete", "fail", "command"] as const;
export type DeviceOperation = typeof deviceOperations[number];
export const devicePairingOperations = ["start", "poll"] as const;
export type DevicePairingOperation = typeof devicePairingOperations[number];
export type DeviceProvider = "codex" | "claude";
export type DeviceManagementCommand =
  | { action: "approve_pairing"; userCode: string; requestId: string }
  | { action: "deny_pairing" | "lookup_pairing"; userCode: string }
  | { action: "revoke"; deviceId: string }
  | { action: "diagnostic"; deviceId: string; requestId: string; provider?: DeviceProvider; model?: string }
  | { action: "set_processing"; deviceId: string; enabled: boolean }
  | { action: "set_paused"; deviceId: string; paused: boolean }
  | { action: "save_config"; deviceId: string; expectedVersion: number; config: StudioDeviceConfig }
  | { action: "provider_login" | "provider_logout"; deviceId: string; provider: DeviceProvider; requestId: string }
  | { action: "cancel_command"; commandId: string };
export const deviceManagementActions = ["approve_pairing", "deny_pairing", "lookup_pairing", "revoke", "diagnostic", "set_processing", "set_paused",
  "save_config", "provider_login", "provider_logout", "cancel_command"] as const;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StudioCommandError("Invalid command.");
  return value as Record<string, unknown>;
}
function valid(condition: unknown): asserts condition { if (!condition) throw new StudioCommandError("Invalid command."); }
const isUuid = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
const isProvider = (value: unknown): value is DeviceProvider => value === "codex" || value === "claude";
/** Pairing codes avoid ambiguous I, L, O, 0 and 1. */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** Accepts "XXXX-XXXX" or 8 characters in any case; returns the stored 8-character form. */
export function normalizePairingCode(value: unknown): string {
  valid(typeof value === "string" && value.length <= 20);
  const code = (value as string).trim().toUpperCase().replace(/[\s-]/g, "");
  valid(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/.test(code));
  return code;
}
export const formatPairingCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
export function readDeviceManagementCommand(value: unknown): DeviceManagementCommand {
  const v = object(value);
  const action = v.action as DeviceManagementCommand["action"];
  valid(deviceManagementActions.includes(action));
  if (action === "approve_pairing") { valid(isUuid(v.requestId)); return { action, userCode: normalizePairingCode(v.userCode), requestId: v.requestId as string }; }
  if (action === "deny_pairing" || action === "lookup_pairing") return { action, userCode: normalizePairingCode(v.userCode) };
  if (action === "cancel_command") { valid(isUuid(v.commandId)); return { action, commandId: v.commandId as string }; }
  valid(isUuid(v.deviceId)); const deviceId = v.deviceId as string;
  if (action === "revoke") return { action, deviceId };
  if (action === "set_processing") { valid(typeof v.enabled === "boolean"); return { action, deviceId, enabled: v.enabled as boolean }; }
  if (action === "set_paused") { valid(typeof v.paused === "boolean"); return { action, deviceId, paused: v.paused as boolean }; }
  if (action === "save_config") {
    valid(Number.isInteger(v.expectedVersion) && Number(v.expectedVersion) >= 0);
    return { action, deviceId, expectedVersion: v.expectedVersion as number, config: readDeviceConfig(v.config) };
  }
  valid(isUuid(v.requestId)); const requestId = v.requestId as string;
  if (action === "provider_login" || action === "provider_logout") { valid(isProvider(v.provider)); return { action, deviceId, requestId, provider: v.provider as DeviceProvider }; }
  valid(v.provider === undefined || isProvider(v.provider));
  valid(v.model === undefined || v.provider !== undefined && typeof v.model === "string" && modelPattern.test(v.model));
  return { action: "diagnostic", deviceId, requestId, provider: v.provider as DeviceProvider | undefined, model: v.model as string | undefined };
}
const safeText = (value: unknown, pattern = /^[A-Za-z0-9._:/() ,+-]{1,100}$/) => typeof value === "string" && pattern.test(value) ? value : undefined;
const safeNumber = (value: unknown, max: number) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? Math.round(value * 10) / 10 : undefined;
function compact(value: Record<string, unknown>) {
  for (const key of Object.keys(value)) if (value[key] === undefined) delete value[key];
  return value;
}
const REPORT_LIMIT = 16384;
/** Whitelist capability fields. Provider tokens, environment and arbitrary report keys never persist. */
export function safeDeviceCapabilities(value: unknown): Record<string, unknown> {
  const v = object(value); const result: Record<string, unknown> = {};
  for (const key of ["instanceId", "platform", "arch", "version"])
    if (typeof v[key] === "string" && /^[A-Za-z0-9._:/ -]{1,100}$/.test(v[key])) result[key] = v[key];
  for (const key of ["healthy", "draining"]) if (typeof v[key] === "boolean") result[key] = v[key];
  if (Array.isArray(v.handlers)) result.handlers = v.handlers.filter(x => x === "studio.diagnostic");
  if (v.hardware && typeof v.hardware === "object" && !Array.isArray(v.hardware)) {
    const h = v.hardware as Record<string, unknown>;
    const power = h.power && typeof h.power === "object" && !Array.isArray(h.power) ? h.power as Record<string, unknown> : null;
    result.hardware = compact({
      chip: safeText(h.chip), arch: safeText(h.arch), osVersion: safeText(h.osVersion),
      memoryGb: safeNumber(h.memoryGb, 4096), gpu: ["apple-metal", "none", "unknown"].includes(String(h.gpu)) ? h.gpu : undefined,
      freeDiskGb: safeNumber(h.freeDiskGb, 1_000_000), totalDiskGb: safeNumber(h.totalDiskGb, 1_000_000),
      power: power ? compact({ source: ["ac", "battery", "unknown"].includes(String(power.source)) ? power.source : "unknown", batteryPercent: safeNumber(power.batteryPercent, 100) }) : undefined,
      timeZone: isIanaTimeZone(h.timeZone) ? h.timeZone : undefined,
    });
  }
  if (v.runtimes && typeof v.runtimes === "object" && !Array.isArray(v.runtimes)) {
    const r = v.runtimes as Record<string, unknown>;
    result.runtimes = compact(Object.fromEntries(["ollama", "lmstudio", "mlx", "whispercpp", "python", "ffmpeg"].map(key => [key, safeText(r[key], /^[A-Za-z0-9._+ -]{1,60}$/)])));
  }
  if (Array.isArray(v.localModels)) result.localModels = v.localModels.filter(x => typeof x === "string" && modelPattern.test(x)).slice(0, 100);
  for (const provider of ["codex", "claude"]) {
    const raw = v[provider]; if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const p = raw as Record<string, unknown>; const out: Record<string, unknown> = {};
    for (const key of ["installed", "authenticated", "ready"]) if (typeof p[key] === "boolean") out[key] = p[key];
    if (typeof p.version === "string" && /^[A-Za-z0-9._ -]{1,100}$/.test(p.version)) out.version = p.version;
    if (Array.isArray(p.models)) out.models = p.models.filter(x => typeof x === "string" && modelPattern.test(x)).slice(0, 50);
    if (["chatgpt", "api_key", "claudeai", "console", "unknown"].includes(String(p.loginMethod))) out.loginMethod = p.loginMethod;
    result[provider] = out;
  }
  // Keep within the stored report bound by trimming the longest optional lists first.
  const lists = [result.localModels, (result.codex as { models?: unknown[] } | undefined)?.models, (result.claude as { models?: unknown[] } | undefined)?.models]
    .filter((list): list is unknown[] => Array.isArray(list));
  while (JSON.stringify(result).length > REPORT_LIMIT) {
    const longest = lists.reduce((a, b) => (b.length > a.length ? b : a), [] as unknown[]);
    if (!longest.length) break; longest.pop();
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
/** Provider sign-in pages the companion may surface. Anything else is rejected. */
export const PROVIDER_LOGIN_HOSTS = ["auth.openai.com", "chatgpt.com", "claude.ai", "console.anthropic.com", "platform.claude.com", "claude.com"] as const;
export function isAllowedProviderLoginUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && (PROVIDER_LOGIN_HOSTS as readonly string[]).includes(url.hostname);
  } catch { return false; }
}
function readConfigAck(value: unknown) {
  const a = object(value);
  valid(Number.isInteger(a.version) && Number(a.version) >= 0 && (a.status === "applied" || a.status === "error"));
  const out: Record<string, unknown> = { version: a.version, status: a.status };
  if (a.unsupported !== undefined) {
    const u = object(a.unsupported); const entries = Object.entries(u);
    valid(entries.length <= 50 && entries.every(([key, reason]) => /^[A-Za-z][A-Za-z0-9.]{0,99}$/.test(key) && typeof reason === "string" && reason.length >= 1 && reason.length <= 200));
    out.unsupported = u;
  }
  if (a.error !== undefined) { valid(typeof a.error === "string" && a.error.length <= 300); out.error = a.error; }
  return out;
}
export function readDeviceCommand(operation: DeviceOperation, value: unknown): Record<string, unknown> {
  const v = object(value);
  valid(typeof v.workerId === "string" && /^[A-Za-z0-9:._-]{1,100}$/.test(v.workerId));
  const out: Record<string, unknown> = { workerId: v.workerId };
  if (operation === "heartbeat") {
    valid(v.release === null || typeof v.release === "string" && v.release.length <= 100);
    valid(typeof v.startedAt === "string" && Number.isFinite(Date.parse(v.startedAt)) && Date.parse(v.startedAt) <= Date.now() + 300000);
    return compact({ ...out, release: v.release, startedAt: v.startedAt, report: safeDeviceCapabilities(v.report ?? {}),
      configAck: v.configAck === undefined || v.configAck === null ? undefined : readConfigAck(v.configAck) });
  }
  if (operation === "command") {
    valid(isUuid(v.commandId) && ["running", "waiting_for_user", "succeeded", "failed"].includes(String(v.status)));
    Object.assign(out, { commandId: v.commandId, status: v.status });
    if (v.display !== undefined && v.display !== null) {
      const d = object(v.display);
      valid(v.status === "waiting_for_user" && Object.keys(d).every(key => key === "verificationUrl" || key === "userCode"));
      valid(isAllowedProviderLoginUrl(d.verificationUrl));
      valid(d.userCode === undefined || typeof d.userCode === "string" && /^[A-Z0-9-]{4,16}$/.test(d.userCode));
      out.display = compact({ verificationUrl: d.verificationUrl, userCode: d.userCode });
    }
    if (v.error !== undefined && v.error !== null) { valid(v.status === "failed" && typeof v.error === "string" && v.error.length <= 300); out.error = v.error; }
    return out;
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
export function readDevicePairStart(value: unknown) {
  const v = object(value);
  valid(typeof v.name === "string" && v.name.trim().length >= 1 && v.name.trim().length <= 100 && !/[\u0000-\u001f\u007f]/.test(v.name));
  valid(typeof v.platform === "string" && /^[A-Za-z0-9._ -]{1,50}$/.test(v.platform));
  return { name: (v.name as string).trim(), platform: v.platform as string };
}
export function readDevicePairPoll(value: unknown) {
  const v = object(value);
  valid(isUuid(v.pairingId) && typeof v.deviceCode === "string" && /^[A-Za-z0-9_-]{20,100}$/.test(v.deviceCode));
  return { pairingId: v.pairingId as string, deviceCode: v.deviceCode as string };
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
