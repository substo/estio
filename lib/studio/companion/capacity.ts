import { usageFloor, usageSpec, type Usage } from "../../build/contract";
import { usageProviders } from "../../build/usage";
import type { LocalProvider } from "./providers";

/**
 * Why a subscription does or does not have capacity, reported with the heartbeat so a waiting Studio page can say
 * what is actually wrong instead of one sentence for "signed out", "used up" and "could not read".
 *  ok: a fresh reading with allowance left · exhausted: a fresh reading at or below the floor
 *  unreadable: no reading yet (the helper failed) · stale: the last reading is too old, or from the future, to route on
 */
export type CapacityStatus = "ok" | "exhausted" | "unreadable" | "stale";
export interface CapacityReport { status: Partial<Record<LocalProvider, CapacityStatus>>; resetsAt: Partial<Record<LocalProvider, string>> }
/** Same fence the shared routing rules use (remainingByBucket): older readings are not routed on. */
export const CAPACITY_FRESH_MS = 30 * 60_000;
const bucketOf: Record<LocalProvider, string> = usageProviders;

/** One malformed bucket must not discard the other provider's good reading. */
export function validBuckets(usage: unknown): Usage {
  if (!usage || typeof usage !== "object") return {};
  return Object.fromEntries(Object.entries(usage).flatMap(([key, value]) => {
    const parsed = usageSpec.safeParse({ [key]: value });
    return parsed.success ? [[key, parsed.data[key]!] as const] : [];
  }));
}

export function describeCapacity(usage: Usage, now = Date.now()): CapacityReport {
  const report: CapacityReport = { status: {}, resetsAt: {} };
  for (const provider of ["codex", "claude"] as const) {
    const reading = usage[bucketOf[provider]!];
    const at = reading ? Date.parse(reading.at) : NaN;
    if (!reading) { report.status[provider] = "unreadable"; continue; }
    if (!Number.isFinite(at) || at > now || now - at >= CAPACITY_FRESH_MS) { report.status[provider] = "stale"; continue; }
    if (reading.remaining > usageFloor) { report.status[provider] = "ok"; continue; }
    report.status[provider] = "exhausted";
    const resets = reading.windows.filter(w => w.remaining <= usageFloor && w.resetsAt && Number.isFinite(Date.parse(w.resetsAt))).map(w => w.resetsAt!).sort((a, b) => Date.parse(b) - Date.parse(a));
    if (resets[0] && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(resets[0])) report.resetsAt[provider] = resets[0];
  }
  return report;
}

export interface CapacityTracker {
  /** Current merged readings, refreshing first when due. */
  usage(): Promise<Usage>;
  /** Current merged readings without refreshing (for heartbeats). */
  snapshot(): Usage;
  report(now?: number): CapacityReport;
  /** Resolves after a refresh finishes; concurrent callers share one probe. */
  refresh(): Promise<void>;
}

/**
 * Subscription usage with the failure modes made explicit. A refresh that fails or returns nothing for a provider keeps
 * that provider's previous reading until the shared freshness fence drops it (a failed probe is not "no capacity"), is
 * retried every minute instead of every five while any provider is unreadable or stale, and never runs twice at once.
 * Nothing is invented: a reading is only ever one the helper returned.
 */
export function createCapacityTracker(read: () => Promise<Usage>, options: { now?: () => number; steadyMs?: number; retryMs?: number; onChange?: (report: CapacityReport) => void } = {}): CapacityTracker {
  const now = options.now ?? Date.now, steadyMs = options.steadyMs ?? 5 * 60_000, retryMs = options.retryMs ?? 60_000;
  let merged: Usage = {}; let checkedAt = -Infinity; let inflight: Promise<void> | null = null; let last = "";
  const report = (at = now()) => describeCapacity(merged, at);
  const needsRetry = () => Object.values(report().status).some(status => status === "unreadable" || status === "stale");
  const refresh = () => inflight ??= (async () => {
    let fresh: Usage = {};
    try { fresh = validBuckets(await read()); } catch { /* keep what we have */ }
    merged = { ...merged, ...fresh };
    checkedAt = now();
    const current = report(); const key = JSON.stringify(current);
    if (key !== last) { last = key; options.onChange?.(current); }
  })().finally(() => { inflight = null; });
  return {
    refresh,
    snapshot: () => merged,
    report,
    async usage() { if (now() - checkedAt >= (needsRetry() ? retryMs : steadyMs)) await refresh(); else if (inflight) await inflight; return merged; },
  };
}
