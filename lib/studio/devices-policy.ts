import { StudioCommandError } from "./command-error";
import { isTimelineSnapshot } from "./workspace/timeline";
import { relatedResultSchema } from "./related-search-policy";
import { readFramesReserve, readFramesVerify, readTranscriptChunk, readVideoResult, VIDEO_TOOL_NAMES } from "./video-transcription-policy";
import { NATIVE_REJECTION_BACKOFF_MS, reportedSubscriptionLimit } from "./subscription-readiness";
import { usageSpec } from "../build/contract";
import { readDesiredModels, readReportedModels } from "./local-models";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
export const deviceOperations = ["heartbeat", "claim", "extend", "complete", "fail", "command", "video_transcript_chunk", "video_frames_reserve", "video_frames_verify", "video_export_reserve", "video_export_verify"] as const;
export type DeviceOperation = typeof deviceOperations[number];
export const devicePairingOperations = ["start", "poll"] as const;
export type DevicePairingOperation = typeof devicePairingOperations[number];
export type DeviceProvider = "codex" | "claude";
/** A device counts as running while its last heartbeat is this recent (same window as hosted workers). */
export const DEVICE_ONLINE_SECONDS = 90;
/** Work a paired computer may run. Mac checks are always allowed; the others are granted while processing is On. */
export const DEVICE_WORK_KINDS = ["studio.diagnostic", "studio.library_summary", "studio.onboarding_research", "studio.text_run", "studio.video_transcribe", "studio.youtube_search", "studio.video_assemble", "studio.video_edit", "studio.open_editor", "studio.voice_preview", "studio.character_sheet"] as const;
export type DeviceWorkKind = typeof DEVICE_WORK_KINDS[number];
export const ONBOARDING_RESEARCH_KIND: DeviceWorkKind = "studio.onboarding_research";
export const deviceWorkLabels: Record<DeviceWorkKind, string> = {
  "studio.text_run": "Knowledge, idea reviews and script briefs", "studio.diagnostic": "Mac checks", "studio.library_summary": "Library summaries", "studio.onboarding_research": "Business research", "studio.video_transcribe": "Video transcription (YouTube audio, captions, slides)", "studio.youtube_search": "Related YouTube search in your Mac's browser", "studio.video_assemble": "Script to edited video",
  "studio.video_edit": "Agent edits to a made video", "studio.open_editor": "Open the edit in Substo Video", "studio.voice_preview": "Voice previews", "studio.character_sheet": "Character sheets",
};
/** Local reasons a running companion is holding processing back (reported in its heartbeat). */
export const DEVICE_BLOCK_REASONS = {
  on_battery_or_unknown_power: "On battery (allow work on battery in Setup, or plug in)",
  outside_working_hours: "Outside the working hours in Setup",
  low_disk_space: "Less free disk than Setup requires",
} as const;
/** Explain the local gate from a heartbeat without trusting device-supplied prose. */
export function deviceProcessingBlock(capabilities: Record<string, unknown>): string | null {
  const reasons = capabilities.processingBlocked;
  if (!Array.isArray(reasons) || reasons.length === 0) return null;
  if (reasons.includes("low_disk_space")) {
    const hardware = capabilities.hardware as { freeDiskGb?: unknown } | undefined;
    const free = hardware?.freeDiskGb;
    return typeof free === "number" && Number.isFinite(free) && free >= 0
      ? `Low disk space (${free.toFixed(1)} GB free). Free disk space on the Mac until it meets the minimum in Devices → Setup.`
      : "Low disk space. Free disk space on the Mac until it meets the minimum in Devices → Setup.";
  }
  const first = reasons[0];
  return typeof first === "string" && Object.hasOwn(DEVICE_BLOCK_REASONS, first)
    ? DEVICE_BLOCK_REASONS[first as keyof typeof DEVICE_BLOCK_REASONS]
    : "Held back by the Mac’s Setup";
}
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
  if (v.videoTemplateVersion === 1) result.videoTemplateVersion = 1;
  if (v.sourceAssistVersion === 1) result.sourceAssistVersion = 1;
  if (v.stagedCreationVersion === 1) result.stagedCreationVersion = 1;
  if (v.studioAgentVersion === 1 || v.studioAgentVersion === 2 || v.studioAgentVersion === 3 || v.studioAgentVersion === 4) result.studioAgentVersion = v.studioAgentVersion;
  if (v.knowledgeCurationVersion === 1) result.knowledgeCurationVersion = 1;
  if (v.knowledgeOutlineVersion === 2) result.knowledgeOutlineVersion = 2;
  // Route-aware companion: runs the provider/model each job carries instead of only Setup's (lib/ai/routing.ts).
  if (v.textRouteVersion === 1) result.textRouteVersion = 1;
  if (v.deviceAiRouteVersion === 1) result.deviceAiRouteVersion = 1;
  if (v.nativeSubscriptionVersion === 1) {
    result.nativeSubscriptionVersion = 1;
    if (v.nativeRetryAt && typeof v.nativeRetryAt === "object") {
      const attempts = v.nativeRetryAt as Record<string, unknown>;
      const now = Date.now();
      result.nativeRetryAt = Object.fromEntries(["codex", "claude"].flatMap(provider => {
        const at = attempts[provider];
        return typeof at === "number" && Number.isSafeInteger(at) && at > now && at <= now + NATIVE_REJECTION_BACKOFF_MS ? [[provider, at]] : [];
      }));
    }
  }
  // Optional native/legacy allowance readings, independent of readiness.
  if (v.usage && typeof v.usage === "object" && !Array.isArray(v.usage)) {
    const usage = usageSpec.safeParse(Object.fromEntries(Object.entries(v.usage as Record<string, unknown>).filter(([k]) => k === "codex" || k === "claudeAgent")));
    if (usage.success && Object.keys(usage.data).length) result.usage = usage.data;
  }
  if (Array.isArray(v.handlers)) result.handlers = v.handlers.filter((x, i, all) => (DEVICE_WORK_KINDS as readonly unknown[]).includes(x) && all.indexOf(x) === i);
  if (v.capacity && typeof v.capacity === "object" && !Array.isArray(v.capacity)) {
    const c = v.capacity as Record<string, unknown>;
    result.capacity = compact({ codex: typeof c.codex === "boolean" ? c.codex : undefined, claude: typeof c.claude === "boolean" ? c.claude : undefined });
  }
  if (Array.isArray(v.processingBlocked)) result.processingBlocked = v.processingBlocked.filter((x, i, all) => typeof x === "string" && x in DEVICE_BLOCK_REASONS && all.indexOf(x) === i);
  if (v.video && typeof v.video === "object" && !Array.isArray(v.video)) {
    const video = v.video as Record<string, unknown>;
    const names = (VIDEO_TOOL_NAMES as readonly string[]);
    const tools = video.tools && typeof video.tools === "object" && !Array.isArray(video.tools)
      ? Object.fromEntries(Object.entries(video.tools as Record<string, unknown>).filter(([k, x]) => names.includes(k) && typeof x === "string" && /^[A-Za-z0-9._+ -]{1,60}$/.test(x))) : {};
    result.video = { ready: video.ready === true, missing: Array.isArray(video.missing) ? video.missing.filter((x, i, all) => typeof x === "string" && names.includes(x) && all.indexOf(x) === i) : [], tools,
      ...(typeof video.work === "string" && /^[a-z_]{1,40}$/.test(video.work) ? { work: video.work } : {}) };
  }
  if (v.youtubeSearch && typeof v.youtubeSearch === "object" && !Array.isArray(v.youtubeSearch)) {
    const search = v.youtubeSearch as Record<string, unknown>;
    result.youtubeSearch = { ready: search.ready === true, rank: search.rank === true, ...(typeof search.signedIn === "boolean" ? { signedIn: search.signedIn } : {}) };
  }
  if (v.videoAssembly && typeof v.videoAssembly === "object" && !Array.isArray(v.videoAssembly)) {
    const assembly = v.videoAssembly as Record<string, unknown>;
    result.videoAssembly = { ready: assembly.ready === true, ...(assembly.sourceClips === 1 ? { sourceClips: 1 } : {}), missing: Array.isArray(assembly.missing) ? assembly.missing.filter((x, i, all) => typeof x === "string" && /^[A-Za-z0-9 ._-]{1,40}$/.test(x) && all.indexOf(x) === i).slice(0, 8) : [] };
  }
  if (v.voicePreview && typeof v.voicePreview === "object" && !Array.isArray(v.voicePreview)) result.voicePreview = { ready: (v.voicePreview as Record<string, unknown>).ready === true };
  // Character sheets: Codex is signed in with ChatGPT on this Mac and processing is allowed. A flag only, nothing else is kept.
  if (v.characterSheet && typeof v.characterSheet === "object" && !Array.isArray(v.characterSheet)) result.characterSheet = { ready: (v.characterSheet as Record<string, unknown>).ready === true };
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
  if (Array.isArray(v.modelStates)) { const states = readReportedModels(v.modelStates); if (states.length) result.modelStates = states; }
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
/** Largest research reply a Mac may return (the device request body is bounded at 32 KiB). */
export const DEVICE_RESEARCH_RESULT_BYTES = 24576;
/** Onboarding research from a Mac: the structured reply, which subscription CLI ran it, and no raw provider output. */
export function readDeviceResearchResult(value: unknown): Record<string, unknown> {
  const result = object(value);
  valid(Object.keys(result).every(key => ["research", "provider", "model"].includes(key)));
  valid(isProvider(result.provider) && typeof result.model === "string" && modelPattern.test(result.model));
  object(result.research);
  valid(new TextEncoder().encode(JSON.stringify(result)).length <= DEVICE_RESEARCH_RESULT_BYTES);
  return { research: result.research, provider: result.provider, model: result.model };
}
/** Envelope validation only; completion also validates against the persisted workflow snapshot in SQL. */
export function readDeviceTextResult(value: unknown): Record<string, unknown> {
  const r = object(value);
  valid(Object.keys(r).every(key => ["output", "provider", "model"].includes(key)));
  valid(r.provider === "codex" || r.provider === "claude");
  valid(typeof r.model === "string" && modelPattern.test(r.model));
  object(r.output);
  valid(new TextEncoder().encode(JSON.stringify(r)).byteLength <= 24576);
  return r;
}
/** A Related-video search result (studio.youtube_search): public video facts, optional model scores and a bounded trace.
 * Without this reader the result fell through to the diagnostic reader and every search was rejected with "Invalid command". */
export function readDeviceYoutubeSearchResult(value: unknown): Record<string, unknown> {
  const parsed = relatedResultSchema.safeParse(object(value));
  valid(parsed.success && JSON.stringify(parsed.data).length <= 30000);
  return parsed.data as Record<string, unknown>;
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
/** A finished Mac video edit: bounded facts only. The export itself travels through video_export_reserve/verify, never this payload. */
export function readAssemblyResult(value: unknown) {
  const v = object(value); valid(Object.keys(v).length === 1);
  const a = object(v.assembly);
  valid(Object.keys(a).every(k => ["exportName", "bytes", "seconds", "beats", "clips", "voiced", "uploadId", "summary", "exportSaved", "projectKept", "projectName", "timeline"].includes(k)));
  valid(a.timeline === undefined || isTimelineSnapshot(a.timeline) && new TextEncoder().encode(JSON.stringify(a.timeline)).length <= 24_000);
  valid(a.exportName === undefined || typeof a.exportName === "string" && a.exportName.length <= 200);
  for (const k of ["bytes", "seconds", "beats", "clips", "voiced"]) valid(a[k] === undefined || typeof a[k] === "number" && Number.isFinite(a[k]) && Number(a[k]) >= 0 && Number(a[k]) <= 1e12);
  valid(a.uploadId === undefined || typeof a.uploadId === "string" && uuid.test(a.uploadId));
  valid(a.exportSaved === undefined || typeof a.exportSaved === "boolean");
  valid(a.projectKept === undefined || typeof a.projectKept === "boolean");
  valid(a.projectName === undefined || typeof a.projectName === "string" && a.projectName.length <= 200 && !a.projectName.includes("/"));
  valid(a.summary === undefined || typeof a.summary === "string" && a.summary.length <= 2000);
  return { assembly: a };
}
/** A short on-device voice sample: base64 audio inside the device body bound (32 KiB), nothing else. */
export function readPreviewResult(value: unknown) {
  const v = object(value); valid(Object.keys(v).length === 1);
  const a = object(v.preview);
  valid(Object.keys(a).every(k => ["audioBase64", "bytes", "seconds", "speaker"].includes(k)));
  valid(typeof a.audioBase64 === "string" && a.audioBase64.length >= 400 && a.audioBase64.length <= 24000 && /^[A-Za-z0-9+/=]+$/.test(a.audioBase64));
  valid(typeof a.speaker === "string" && /^[A-Za-z0-9_-]{2,64}$/.test(a.speaker));
  for (const k of ["bytes", "seconds"]) valid(a[k] === undefined || typeof a[k] === "number" && Number.isFinite(a[k]) && Number(a[k]) >= 0 && Number(a[k]) <= 1e6);
  return { preview: a };
}
/** A character sheet: which sheet, and the names of the pictures the Mac uploaded (never a path or a link). */
export function readSheetResult(value: unknown) {
  const v = object(value); valid(Object.keys(v).length === 2 && ["turnaround", "expressions", "face", "outfits", "storyboard"].includes(String(v.sheet)));
  const storyboard = v.sheet === "storyboard";
  valid(Array.isArray(v.files) && v.files.length >= 1 && v.files.length <= (storyboard ? 6 : 4) && v.files.every(f => typeof f === "string" && (storyboard ? /^frame-[1-6]\.png$/ : /^sheet-[1-4]\.png$/).test(f)));
  return { sheet: v.sheet, files: v.files };
}
/** Opening the kept project in Substo Video: a boolean and the folder's name, never a path. */
export function readEditorResult(value: unknown) {
  const v = object(value); valid(Object.keys(v).length === 1);
  const e = object(v.editor);
  valid(Object.keys(e).every(k => ["opened", "projectName"].includes(k)));
  valid(e.opened === undefined || typeof e.opened === "boolean");
  valid(e.projectName === undefined || typeof e.projectName === "string" && e.projectName.length <= 200 && !e.projectName.includes("/"));
  return { editor: e };
}
export function readExportReserve(v: Record<string, unknown>) {
  valid(typeof v.sha256 === "string" && /^[0-9a-f]{64}$/.test(v.sha256));
  valid(Number.isInteger(v.byteSize) && Number(v.byteSize) >= 1000 && Number(v.byteSize) <= 5_368_709_120);
  return { sha256: v.sha256, byteSize: v.byteSize };
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
  if (operation === "claim") { valid(Number.isInteger(v.limit) && Number(v.limit) >= 1 && Number(v.limit) <= 50); return { ...out, limit: v.limit, textReady: v.textReady === true, summaryReady: v.summaryReady === true, researchReady: v.researchReady === true, videoReady: v.videoReady === true, youtubeReady: v.youtubeReady === true, assembleReady: v.assembleReady === true, previewReady: v.previewReady === true, sheetReady: v.sheetReady === true }; }
  valid(typeof v.jobId === "string" && uuid.test(v.jobId) && typeof v.leaseToken === "string" && uuid.test(v.leaseToken));
  Object.assign(out, { jobId: v.jobId, leaseToken: v.leaseToken });
  if (operation === "video_transcript_chunk") return { ...out, ...readTranscriptChunk(v) };
  if (operation === "video_frames_reserve") return { ...out, ...readFramesReserve(v) };
  if (operation === "video_frames_verify") return { ...out, ...readFramesVerify(v) };
  if (operation === "video_export_reserve") return { ...out, ...readExportReserve(v) };
  if (operation === "video_export_verify") return out;
  if (operation === "complete") { out.result = v.result && typeof v.result === "object" && "preview" in v.result ? readPreviewResult(v.result) : v.result && typeof v.result === "object" && "sheet" in v.result ? readSheetResult(v.result) : v.result && typeof v.result === "object" && "assembly" in v.result ? readAssemblyResult(v.result) : v.result && typeof v.result === "object" && "editor" in v.result ? readEditorResult(v.result) : v.result && typeof v.result === "object" && "videos" in v.result ? readDeviceYoutubeSearchResult(v.result) : v.result && typeof v.result === "object" && "outcome" in v.result ? readVideoResult(v.result) : v.result && typeof v.result === "object" && "output" in v.result && typeof v.result.output === "object" ? readDeviceTextResult(v.result) : v.result && typeof v.result === "object" && "research" in v.result ? readDeviceResearchResult(v.result) : readDeviceDiagnosticResult(v.result); }
  if (operation === "complete" && v.routeActual !== undefined) {
    const actual = object(v.routeActual);
    valid(isProvider(actual.provider) && typeof actual.model === "string" && modelPattern.test(actual.model));
    out.routeActual = { provider: actual.provider, model: actual.model };
  }
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
  /** Catalog ids (lib/studio/local-models.ts) this Mac should have installed. Absent until the owner first chooses. */
  models?: string[];
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
  valid(Object.keys(v).every(key => ["features", "languages", "translationTargets", "preference", "textProvider", "textModel", "resources", "models"].includes(key))
    && ["features", "languages", "translationTargets", "preference", "textProvider", "textModel", "resources"].every(key => key in v));
  const models = v.models === undefined ? undefined : readDesiredModels(v.models);
  valid(v.models === undefined || models !== null);
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
    ...(models ? { models } : {}),
    resources: { modelBudgetGb: numberIn(r.modelBudgetGb, 1, 500), minFreeDiskGb: numberIn(r.minFreeDiskGb, 5, 500),
      allowOnBattery: r.allowOnBattery as boolean, maxConcurrentJobs: 1, launchAtLogin: r.launchAtLogin as boolean, workingHours },
  };
}

export interface DeviceResearchInput {
  revoked: boolean; paused: boolean; processingEnabled: boolean; allowedKinds: readonly string[]; seenAt: string | null;
  /** Already passed through safeDeviceCapabilities. */
  capabilities: Record<string, unknown>;
}
export interface DeviceResearchReadiness { online: boolean; ready: boolean; providers: DeviceProvider[]; reason: string | null }
const subscriptionLogin: Record<DeviceProvider, string> = { codex: "chatgpt", claude: "claudeai" };
/** Whether the companion is running now: a fresh heartbeat that is not its final "draining" report. */
export function deviceOnline(seenAt: string | null, capabilities: Record<string, unknown>, now = Date.now(), onlineSeconds = DEVICE_ONLINE_SECONDS) {
  return capabilities.draining !== true && seenAt !== null && now >= Date.parse(seenAt) && now - Date.parse(seenAt) < onlineSeconds * 1000;
}
/**
 * Can this paired Mac run onboarding research right now? Only while its companion is running, recently seen, processing
 * is On and not paused, the research kind is allowed, the companion has the research handler, and Codex or Claude is
 * signed in with a subscription that has capacity. `reason` is the first thing missing, in plain words.
 */
export function deviceResearchReadiness(input: DeviceResearchInput, now = Date.now(), onlineSeconds = DEVICE_ONLINE_SECONDS): DeviceResearchReadiness {
  const online = !input.revoked && deviceOnline(input.seenAt, input.capabilities, now, onlineSeconds);
  const no = (reason: string): DeviceResearchReadiness => ({ online, ready: false, providers: [], reason });
  if (input.revoked) return no("Revoked");
  if (input.capabilities.draining === true) return no("The Studio companion is draining on this Mac");
  if (!online) return no("No recent heartbeat from the Studio companion");
  if (input.paused) return no("Paused");
  if (!input.processingEnabled) return no("Processing is off");
  if (!input.allowedKinds.includes(ONBOARDING_RESEARCH_KIND)) return no("Business research isn't allowed yet: turn processing off and on again");
  const handlers = Array.isArray(input.capabilities.handlers) ? input.capabilities.handlers : [];
  if (!handlers.includes(ONBOARDING_RESEARCH_KIND)) return no("Update the Studio companion on this Mac");
  const blocked = deviceProcessingBlock(input.capabilities);
  if (blocked) return no(blocked);
  const signedIn = (["codex", "claude"] as const).filter(p => {
    const r = input.capabilities[p] as { authenticated?: unknown; ready?: unknown; loginMethod?: unknown } | undefined;
    return r?.authenticated === true && r.ready === true && r.loginMethod === subscriptionLogin[p];
  });
  if (!signedIn.length) return no("Codex or Claude isn't signed in with a subscription");
  const capacity = input.capabilities.capacity as Partial<Record<DeviceProvider, boolean>> | undefined;
  const providers = signedIn.filter(p => capacity?.[p] === true && !reportedSubscriptionLimit(input.capabilities, p, now));
  if (!providers.length) {
    if (signedIn.every(p => reportedSubscriptionLimit(input.capabilities, p, now))) return no("Subscription limit reached on this Mac");
    return no(input.capabilities.nativeSubscriptionVersion === 1
      ? "The native subscription on this Mac is temporarily unavailable"
      : "No current subscription allowance confirmed. Update the Studio companion to use native subscription readiness.");
  }
  return { online, ready: true, providers, reason: null };
}

/**
 * Connected-computer page refresh: every 3s while a command runs, every 60s otherwise,
 * and none after 10 minutes on the page (the Refresh button still works). Each refresh
 * re-runs the page's database reads, so an open tab must not poll forever.
 */
export const COMPANION_REFRESH_WINDOW_MS = 10 * 60_000;
export function companionRefreshDelay(commandActive: boolean, elapsedMs: number): number | null {
  if (elapsedMs >= COMPANION_REFRESH_WINDOW_MS) return null;
  return commandActive ? 3_000 : 60_000;
}
