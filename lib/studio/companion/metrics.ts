import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname } from "node:path";
import type { StudioJob } from "../worker/queue";
import { StudioJobError, type StudioJobHandler } from "../worker/handlers";
import {
  COMPANION_METRIC_FEATURES, COMPANION_METRIC_STAGES, COMPANION_METRIC_UNITS,
  type CompanionMetricFeature, type CompanionMetricStage, type CompanionMetricSummaryItem, type CompanionMetricUnit,
} from "../device-metrics";
export type CompanionMetricStatus = "running" | "succeeded" | "failed";

export interface MemoryPressure {
  swapUsedMb: number;
  freePercent: number;
}
export interface CompanionMetricRun {
  runId: string;
  feature: CompanionMetricFeature;
  status: CompanionMetricStatus;
  outcome: string;
  startedAtMs: number;
  endedAtMs?: number;
  durationMs?: number;
  unit?: CompanionMetricUnit;
  units?: number;
  peakMemoryMb?: number;
  memoryStart?: MemoryPressure;
  memoryEnd?: MemoryPressure;
  stages?: Partial<Record<CompanionMetricStage, number>>;
}
export interface CompanionMetricSummary {
  version: 1;
  memory?: MemoryPressure;
  recent: CompanionMetricSummaryItem[];
}

const MAX_DURATION_MS = 7 * 24 * 60 * 60_000;
const number = (value: number, decimals = 1) => Math.round(value * 10 ** decimals) / 10 ** decimals;
const bounded = (value: unknown, max: number) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : undefined;
const safeOutcome = (value: unknown, fallback: string) => typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : fallback;
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Pure ETA summary: last N successful runs establish median duration and median per-unit speed. */
export function summarizeMetricRuns(runs: readonly CompanionMetricRun[], now = Date.now(), historySize = 8): CompanionMetricSummaryItem[] {
  const features = [...new Set([...runs].sort((a, b) => b.startedAtMs - a.startedAtMs).map(run => run.feature))];
  return features.slice(0, 12).flatMap(feature => {
    const matching = runs.filter(run => run.feature === feature).sort((a, b) => b.startedAtMs - a.startedAtMs);
    const latest = matching[0];
    if (!latest) return [];
    const successful = matching.filter(run => run.status === "succeeded" && bounded(run.durationMs, MAX_DURATION_MS) !== undefined).slice(0, historySize);
    const typicalDurationMs = successful.length ? median(successful.map(run => run.durationMs!)) : undefined;
    const rates = successful.flatMap(run => run.unit && bounded(run.units, 1_000_000_000) !== undefined && run.durationMs! > 0
      ? [run.units! / (run.durationMs! / 1000)] : []);
    const durationMs = latest.status === "running" ? Math.max(0, Math.min(MAX_DURATION_MS, now - latest.startedAtMs)) : latest.durationMs;
    const ratePerSecond = latest.unit && latest.units !== undefined && durationMs && durationMs > 0 ? latest.units / (durationMs / 1000) : undefined;
    return [{
      feature, status: latest.status, outcome: latest.outcome, startedAtMs: latest.startedAtMs,
      ...(durationMs !== undefined ? { durationMs: Math.round(durationMs) } : {}),
      ...(typicalDurationMs !== undefined ? { typicalDurationMs: Math.round(typicalDurationMs) } : {}),
      ...(latest.unit ? { unit: latest.unit } : {}), ...(latest.units !== undefined ? { units: number(latest.units, 2) } : {}),
      ...(ratePerSecond !== undefined ? { ratePerSecond: number(ratePerSecond, 2) } : {}),
      ...(rates.length ? { typicalRatePerSecond: number(median(rates), 2) } : {}),
      ...(latest.peakMemoryMb !== undefined ? { peakMemoryMb: number(latest.peakMemoryMb) } : {}),
      ...(latest.status === "running" && typicalDurationMs !== undefined ? { slow: durationMs! > typicalDurationMs * 3 } : {}),
      ...(latest.stages && Object.keys(latest.stages).length ? { stages: latest.stages } : {}),
    }];
  });
}

function exec(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => execFile(command, args, { timeout: 2000, maxBuffer: 16_384 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
}
function megabytes(value: number, suffix: string) {
  return suffix.toUpperCase() === "G" ? value * 1024 : suffix.toUpperCase() === "K" ? value / 1024 : value;
}
/** macOS pressure snapshot. Failure is non-fatal: a job must never wait on telemetry. */
export async function readMemoryPressure(): Promise<MemoryPressure | undefined> {
  try {
    const output = await exec("/usr/sbin/sysctl", ["-n", "vm.swapusage"]);
    const match = output.match(/used\s*=\s*([0-9.]+)([KMG])/i);
    if (!match) return undefined;
    const total = os.totalmem();
    return { swapUsedMb: number(megabytes(Number(match[1]), match[2])), freePercent: number(total ? os.freemem() / total * 100 : 0) };
  } catch { return undefined; }
}

interface ActiveMetricContext {
  service: CompanionMetrics;
  run: CompanionMetricRun;
}
const activeMetric = new AsyncLocalStorage<ActiveMetricContext>();

export function observeCompanionMetricUnits(unit: CompanionMetricUnit, units: number) {
  const run = activeMetric.getStore()?.run;
  if (!run || !Number.isFinite(units) || units <= 0 || units > 1_000_000_000) return;
  if (run.unit && run.unit !== unit) return;
  run.unit = unit; run.units = number((run.units ?? 0) + units, 2);
}
export function observeCompanionPeakMemoryMb(value: number) {
  const run = activeMetric.getStore()?.run;
  if (!run || !Number.isFinite(value) || value <= 0 || value > 1_000_000) return;
  run.peakMemoryMb = number(Math.max(run.peakMemoryMb ?? 0, value));
}
export async function measureCompanionStage<T>(stage: CompanionMetricStage, work: () => Promise<T>): Promise<T> {
  const run = activeMetric.getStore()?.run;
  const started = Date.now();
  try { return await work(); }
  finally { if (run) run.stages = { ...run.stages, [stage]: Math.max(0, Date.now() - started) }; }
}
export function observeCompanionStageDuration(stage: CompanionMetricStage, durationMs: number) {
  const run = activeMetric.getStore()?.run;
  if (!run || !Number.isFinite(durationMs) || durationMs < 0 || durationMs > MAX_DURATION_MS) return;
  run.stages = { ...run.stages, [stage]: Math.round(durationMs) };
}
export async function measureCompanionFeature<T>(feature: CompanionMetricFeature, work: () => Promise<T>, units?: { unit: CompanionMetricUnit; units: number }): Promise<T> {
  const service = activeMetric.getStore()?.service;
  return service ? service.measure(feature, work, units) : work();
}

function parseRun(value: unknown): CompanionMetricRun | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || typeof v.runId !== "string" || !/^[0-9a-f-]{36}$/i.test(v.runId) || !(COMPANION_METRIC_FEATURES as readonly unknown[]).includes(v.feature)
    || !["running", "succeeded", "failed"].includes(String(v.status)) || !Number.isSafeInteger(v.startedAtMs) || Number(v.startedAtMs) < 1_577_836_800_000) return null;
  const stages = v.stages && typeof v.stages === "object" && !Array.isArray(v.stages) ? Object.fromEntries(Object.entries(v.stages as Record<string, unknown>)
    .filter(([key, value]) => (COMPANION_METRIC_STAGES as readonly string[]).includes(key) && bounded(value, MAX_DURATION_MS) !== undefined)) : undefined;
  const memory = (value: unknown): MemoryPressure | undefined => value && typeof value === "object" && !Array.isArray(value)
    && bounded((value as MemoryPressure).swapUsedMb, 1_000_000) !== undefined && bounded((value as MemoryPressure).freePercent, 100) !== undefined
    ? { swapUsedMb: number((value as MemoryPressure).swapUsedMb), freePercent: number((value as MemoryPressure).freePercent) } : undefined;
  return {
    runId: v.runId, feature: v.feature as CompanionMetricFeature, status: v.status as CompanionMetricStatus,
    outcome: safeOutcome(v.outcome, v.status === "running" ? "running" : "unknown"), startedAtMs: Number(v.startedAtMs),
    ...(bounded(v.endedAtMs, Number.MAX_SAFE_INTEGER) !== undefined ? { endedAtMs: Number(v.endedAtMs) } : {}),
    ...(bounded(v.durationMs, MAX_DURATION_MS) !== undefined ? { durationMs: Number(v.durationMs) } : {}),
    ...((COMPANION_METRIC_UNITS as readonly unknown[]).includes(v.unit) && bounded(v.units, 1_000_000_000) !== undefined ? { unit: v.unit as CompanionMetricUnit, units: Number(v.units) } : {}),
    ...(bounded(v.peakMemoryMb, 1_000_000) !== undefined ? { peakMemoryMb: Number(v.peakMemoryMb) } : {}),
    ...(memory(v.memoryStart) ? { memoryStart: memory(v.memoryStart) } : {}), ...(memory(v.memoryEnd) ? { memoryEnd: memory(v.memoryEnd) } : {}),
    ...(stages && Object.keys(stages).length ? { stages } : {}),
  };
}

export interface CompanionMetricsOptions {
  file: string;
  maxBytes?: number;
  historySize?: number;
  now?: () => number;
  memory?: () => Promise<MemoryPressure | undefined>;
  onChange?: () => void;
}
export class CompanionMetrics {
  private readonly runs = new Map<string, CompanionMetricRun>();
  private memory?: MemoryPressure;
  private writing: Promise<void> = Promise.resolve();
  private readonly maxBytes: number;
  private readonly historySize: number;
  private readonly now: () => number;
  private readonly readMemory: () => Promise<MemoryPressure | undefined>;
  constructor(private readonly options: CompanionMetricsOptions) {
    this.maxBytes = options.maxBytes ?? 1_000_000;
    this.historySize = options.historySize ?? 8;
    this.now = options.now ?? Date.now;
    this.readMemory = options.memory ?? readMemoryPressure;
  }
  async load() {
    for (const file of [`${this.options.file}.1`, this.options.file]) {
      const text = await readFile(file, "utf8").catch(() => "");
      for (const line of text.split("\n")) {
        if (!line) continue;
        try { const run = parseRun(JSON.parse(line)); if (run) this.runs.set(run.runId, run); } catch { /* Ignore partial/corrupt local lines. */ }
      }
    }
    await this.refreshMemory();
    this.trimMemory();
  }
  async refreshMemory() { const pressure = await this.readMemory(); if (pressure) this.memory = pressure; }
  summary(): CompanionMetricSummary {
    return { version: 1, ...(this.memory ? { memory: this.memory } : {}), recent: summarizeMetricRuns([...this.runs.values()], this.now(), this.historySize) };
  }
  wrap(feature: CompanionMetricFeature | ((job: StudioJob) => CompanionMetricFeature), handler: StudioJobHandler): StudioJobHandler {
    return (job, context) => {
      const selected = typeof feature === "function" ? feature(job) : feature;
      return this.measure(selected, async () => {
        const result = await handler(job, context);
        observeStudioResultUnits(selected, result);
        return result;
      });
    };
  }
  async measure<T>(feature: CompanionMetricFeature, work: () => Promise<T>, units?: { unit: CompanionMetricUnit; units: number }): Promise<T> {
    const startedAtMs = this.now();
    const run: CompanionMetricRun = { runId: randomUUID(), feature, status: "running", outcome: "running", startedAtMs };
    if (units && bounded(units.units, 1_000_000_000) !== undefined) { run.unit = units.unit; run.units = number(units.units, 2); }
    run.memoryStart = await this.readMemory(); if (run.memoryStart) this.memory = run.memoryStart;
    this.runs.set(run.runId, run); await this.append(run); this.options.onChange?.();
    try {
      const result = await activeMetric.run({ service: this, run }, work);
      const failedResult = result === false || result === null;
      run.status = failedResult ? "failed" : "succeeded";
      const resultOutcome = result && typeof result === "object" && "outcome" in result ? (result as { outcome?: unknown }).outcome : undefined;
      run.outcome = safeOutcome(resultOutcome, failedResult ? "failed" : "succeeded");
      return result;
    } catch (error) {
      run.status = "failed";
      run.outcome = safeOutcome(error instanceof StudioJobError ? error.code : error instanceof Error ? error.name.toLowerCase().replace(/[^a-z0-9_]+/g, "_") : undefined, "unexpected_error");
      throw error;
    } finally {
      run.endedAtMs = this.now(); run.durationMs = Math.max(0, Math.min(MAX_DURATION_MS, run.endedAtMs - startedAtMs));
      run.memoryEnd = await this.readMemory(); if (run.memoryEnd) this.memory = run.memoryEnd;
      await this.append(run); this.trimMemory(); this.options.onChange?.();
    }
  }
  private trimMemory() {
    const keep = [...this.runs.values()].sort((a, b) => b.startedAtMs - a.startedAtMs).slice(0, 400);
    this.runs.clear(); for (const run of keep) this.runs.set(run.runId, run);
  }
  private append(run: CompanionMetricRun) {
    const persisted = { v: 1, ...run };
    const line = JSON.stringify(persisted) + "\n";
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.options.file), { recursive: true, mode: 0o700 });
      const size = (await stat(this.options.file).catch(() => null))?.size ?? 0;
      if (size + Buffer.byteLength(line) > this.maxBytes) {
        await rm(`${this.options.file}.1`, { force: true }).catch(() => {});
        await rename(this.options.file, `${this.options.file}.1`).catch(() => {});
      }
      await writeFile(this.options.file, line, { flag: "a", mode: 0o600 });
    }).catch(() => { /* Metrics must never fail a Studio job. */ });
    return this.writing;
  }
}

export function featureForStudioJob(job: StudioJob): CompanionMetricFeature {
  if (job.kind === "studio.voice_preview") return typeof job.payload.speaker === "string" && job.payload.speaker.startsWith("clone-") ? "voice_clone" : "voice_preview";
  if (job.kind === "studio.video_transcribe" || job.kind === "studio.character_sheet" && job.payload.sheet === "transcript") return "transcription";
  if (job.kind === "studio.character_sheet") return "storyboard";
  if (job.kind === "studio.video_assemble") return "make_video";
  if (job.kind === "studio.video_edit") return "video_edit";
  if (job.kind === "studio.open_editor") return "open_editor";
  if (job.kind === "studio.diagnostic") return "mac_check";
  return "text_turn";
}

/** Units already present in bounded handler results; no payload text or provider output is inspected. */
export function observeStudioResultUnits(feature: CompanionMetricFeature, result: Record<string, unknown>) {
  if ((feature === "voice_preview" || feature === "voice_clone") && result.preview && typeof result.preview === "object")
    observeCompanionMetricUnits("audio_seconds", Number((result.preview as Record<string, unknown>).seconds));
  if (feature === "transcription" && typeof result.durationSeconds === "number") observeCompanionMetricUnits("media_seconds", result.durationSeconds);
  if (feature === "storyboard" && Array.isArray(result.files)) observeCompanionMetricUnits("pictures", result.files.length);
}
