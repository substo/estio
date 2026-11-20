import { z } from "zod";
import { remainingByBucket, usageFloor, type Usage } from "../../build/contract";
import { StudioJobError, StudioProviderRejectedError } from "../worker/handlers";
import type { StudioJob } from "../worker/queue";
import { CompanionProcessError } from "./process";
import { modelPattern, type LocalProvider, type LocalTextAdapter } from "./providers";

/**
 * Per-job Codex↔Claude switching on the requester's own Mac (textRouteVersion 1). The server supplies the Location order with
 * the job (`job.route`, or `payload.route`): the step it admitted (`actual`) and the remaining `candidates`. The Mac walks the
 * leading device steps that are this Mac, and switches only BEFORE generation starts: no fresh capacity, not signed in with the
 * subscription, or an explicit pre-output rate-limit rejection. Any other failure is a started/uncertain run and is never
 * replayed. When the next step is server-side (hosted, paid, another Mac), the handler returns its retryable capacity wait so
 * the server moves the job on.
 */
export const TEXT_ROUTE_VERSION = 1;
export type LocalStep = { provider: LocalProvider; model: string | undefined };
export type LocalRoute = { steps: LocalStep[]; serverNext: boolean };
const step = z.object({ kind: z.string().max(40), model: z.string().max(120).nullish(), deviceId: z.string().max(64).optional() }).passthrough();
const route = z.object({ actual: step.nullish(), candidates: z.array(step).max(5).default([]) }).passthrough();
export function summaryProviders(usage: Usage, now = Date.now()): LocalProvider[] {
  // Reject future timestamps as well as stale readings before applying the shared quota rules.
  const actual = Object.fromEntries(Object.entries(usage).filter(([, r]) => Number.isFinite(Date.parse(r.at)) && Date.parse(r.at) <= now));
  const remaining = remainingByBucket(actual, now);
  return (["codex", "claude"] as const).filter(p => (remaining[p === "claude" ? "claudeAgent" : p] ?? 0) > usageFloor).sort((a, b) => Math.floor((remaining[b === "claude" ? "claudeAgent" : b] ?? 0) / 10) - Math.floor((remaining[a === "claude" ? "claudeAgent" : a] ?? 0) / 10));
}

/** The leading steps this Mac can run, in the server's order, or null when the job carries no route. */
export function localRoute(job: Pick<StudioJob, "payload"> & { route?: unknown }, options: { deviceId?: string; defaultModel?: (p: LocalProvider) => string | undefined } = {}): LocalRoute | null {
  const supplied = job.route ?? job.payload.route;
  if (supplied == null) return null;
  const parsed = route.safeParse(supplied);
  if (!parsed.success) throw new StudioJobError("invalid_job_payload", "Invalid Location AI route.", false);
  const steps: LocalStep[] = [];
  for (const s of [...(parsed.data.actual ? [parsed.data.actual] : []), ...parsed.data.candidates]) {
    const provider = s.kind === "device_codex" ? "codex" : s.kind === "device_claude" ? "claude" : null;
    if (!provider || (s.deviceId !== undefined && s.deviceId !== options.deviceId)) return { steps, serverNext: true };
    if (steps.some(x => x.provider === provider)) continue;
    const model = s.model ?? options.defaultModel?.(provider);
    if (model !== undefined && !modelPattern.test(model)) continue; // Not runnable here; the next step may be.
    steps.push({ provider, model });
  }
  return { steps, serverNext: false };
}

const subscriptionLogin: Record<LocalProvider, string> = { codex: "chatgpt", claude: "claudeai" };
export type LocalRouteDeps = { adapter: (p: LocalProvider) => LocalTextAdapter; usage: () => Promise<Usage> };
type LocalRouteReport = LocalStep & { firstLocalStep: LocalStep; switchReason?: string };
export type ReportLocalRoute = (jobId: string, route: LocalRouteReport) => void;
type LocalAttempt<T> = LocalRouteReport & { value: T };

/**
 * Try each step in order. Returns null when no step could start (caller returns its capacity wait). `onStarted` maps any
 * failure after generation began (other than a completed rate-limit rejection) to the handler's own terminal error.
 */
export async function runLocalRoute<T>(routeSteps: LocalStep[] | ((capacity: LocalProvider[]) => LocalStep[]), deps: LocalRouteDeps, signal: AbortSignal,
  generate: (adapter: LocalTextAdapter, step: LocalStep) => Promise<T>, onStarted: (error: unknown) => never): Promise<LocalAttempt<T> | null> {
  const capacity = summaryProviders(await deps.usage().catch(() => ({})));
  const steps = typeof routeSteps === "function" ? routeSteps(capacity) : routeSteps;
  const skipped: string[] = [];
  for (const s of steps) {
    signal.throwIfAborted();
    const label = s.provider === "codex" ? "Codex" : "Claude";
    if (!capacity.includes(s.provider)) { skipped.push(`${label} limit reached`); continue; }
    const adapter = deps.adapter(s.provider);
    const ready = await adapter.readiness(signal).catch(() => null);
    if (!ready?.ready || !ready.authenticated || ready.loginMethod !== subscriptionLogin[s.provider]) { skipped.push(`${label} isn't signed in with its subscription`); continue; }
    signal.throwIfAborted();
    try {
      const value = await generate(adapter, s);
      return { value, ...s, firstLocalStep: steps[0], ...(skipped.length ? { switchReason: `${skipped.join("; ")} → ${label}` } : {}) };
    } catch (error) {
      // Spawn failure or an explicit rejection before output leaves no generation to replay.
      if ((error instanceof CompanionProcessError && error.code === "cli_unavailable") ||
          (error instanceof Error && error.message === "provider_not_ready")) { skipped.push(`${label} is unavailable`); continue; }
      if (error instanceof StudioProviderRejectedError && error.code === "rate_limited") { skipped.push(`${label} limit reached`); continue; }
      onStarted(error);
    }
  }
  return null;
}
