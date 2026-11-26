import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CompanionMetrics, summarizeMetricRuns, type CompanionMetricRun } from "./metrics";

const run = (patch: Partial<CompanionMetricRun>): CompanionMetricRun => ({
  runId: crypto.randomUUID(), feature: "voice_preview", status: "succeeded", outcome: "succeeded", startedAtMs: 1_800_000_000_000,
  durationMs: 40_000, endedAtMs: 1_800_000_040_000, ...patch,
});

test("ETA uses the median of the last successful runs and flags a running job after three times typical", () => {
  const history = [20_000, 40_000, 60_000].map((durationMs, index) => run({ runId: crypto.randomUUID(), startedAtMs: 1_800_000_000_000 + index, durationMs }));
  const active = run({ runId: crypto.randomUUID(), status: "running", outcome: "running", startedAtMs: 1_800_000_100_000, endedAtMs: undefined, durationMs: undefined });
  const [summary] = summarizeMetricRuns([...history, active], active.startedAtMs + 120_001);
  assert.equal(summary.typicalDurationMs, 40_000);
  assert.equal(summary.durationMs, 120_001);
  assert.equal(summary.slow, true);
});

test("per-unit speed is a median and ignores failed runs", () => {
  const rows = [
    run({ durationMs: 10_000, unit: "media_seconds", units: 20 }),
    run({ durationMs: 20_000, unit: "media_seconds", units: 20, startedAtMs: 1_800_000_000_001 }),
    run({ status: "failed", outcome: "failed", durationMs: 1000, unit: "media_seconds", units: 1000, startedAtMs: 1_800_000_000_002 }),
  ];
  const [summary] = summarizeMetricRuns(rows);
  assert.equal(summary.typicalRatePerSecond, 1.5);
});

test("JSONL is private, rotated by size, reloadable and contains codes/numbers only", async () => {
  const dir = await mkdtemp(join(os.tmpdir(), "studio-metrics-test-"));
  const file = join(dir, "studio-metrics.jsonl");
  let now = 1_800_000_000_000;
  const metrics = new CompanionMetrics({ file, maxBytes: 500, now: () => now, memory: async () => ({ swapUsedMb: 12, freePercent: 42 }) });
  try {
    await metrics.load();
    for (let i = 0; i < 4; i++) {
      await metrics.measure("voice_preview", async () => ({ preview: { seconds: 4 } }));
      now += 1000;
    }
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.ok((await stat(`${file}.1`)).size > 0);
    const stored = `${await readFile(`${file}.1`, "utf8")}\n${await readFile(file, "utf8")}`;
    assert.doesNotMatch(stored, /prompt|https?:|\/Users\//i);
    const loaded = new CompanionMetrics({ file, now: () => now, memory: async () => ({ swapUsedMb: 13, freePercent: 41 }) });
    await loaded.load();
    assert.equal(loaded.summary().recent[0].feature, "voice_preview");
    assert.deepEqual(loaded.summary().memory, { swapUsedMb: 13, freePercent: 41 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
