import { StudioJobError, type StudioJobHandler } from "./handlers";
import type { StudioJob, StudioQueue } from "./queue";

export interface StudioWorkerOptions {
  queue: StudioQueue; handlers: Record<string, StudioJobHandler>; workerId: string; release?: string | null;
  report?: { instanceId: string; handlers: string[] };
  concurrency?: number; leaseSeconds?: number; pollMs?: number; heartbeatMs?: number;
  signal: AbortSignal; log?: (event: Record<string, unknown>) => void; sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const defaultSleep = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  if (signal.aborted) return resolve();
  const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
  const timer = setTimeout(done, ms);
  signal.addEventListener("abort", done, { once: true });
});

/** Run one claimed job: keep its lease alive, then record success or a classified failure. */
export async function runStudioJob(job: StudioJob, options: Pick<StudioWorkerOptions, "queue" | "handlers" | "workerId" | "leaseSeconds" | "log">) {
  const { queue, workerId, log = () => {} } = options;
  const leaseSeconds = options.leaseSeconds ?? 120;
  const controller = new AbortController();
  // Fail closed on transport errors, and abort even if a renewal hangs forever.
  let finished = false;
  let deadline: ReturnType<typeof setTimeout>;
  let renewal: ReturnType<typeof setTimeout>;
  const armDeadline = (ms: number) => {
    clearTimeout(deadline);
    if (!Number.isFinite(ms) || ms <= 0) { controller.abort(); return; }
    deadline = setTimeout(() => controller.abort(), ms);
  };
  armDeadline(Math.min(leaseSeconds * 1000, job.lease_expires_at ? Date.parse(job.lease_expires_at) - Date.now() : Infinity));
  const renew = async () => {
    const requestedAt = Date.now();
    try {
      const held = await queue.extend(job.id, workerId, leaseSeconds, job.lease_token);
      if (finished || controller.signal.aborted) return;
      if (!held) { controller.abort(); return; }
      // Count from request start, never from the delayed response arrival.
      armDeadline(requestedAt + leaseSeconds * 1000 - Date.now());
      renewal = setTimeout(renew, Math.max(1000, leaseSeconds * 1000 / 3));
    } catch { controller.abort(); }
  };
  renewal = setTimeout(renew, Math.max(1000, leaseSeconds * 1000 / 3));
  try {
    if (controller.signal.aborted || !job.lease_token) { log({ event: "job_lease_lost", jobId: job.id, kind: job.kind }); return; }
    const handler = options.handlers[job.kind];
    if (!handler) throw new StudioJobError("unknown_job_kind", "This job type is not supported by the worker.", false);
    const result = await handler(job, { signal: controller.signal, workerId });
    if (controller.signal.aborted) { log({ event: "job_lease_lost", jobId: job.id, kind: job.kind }); return; }
    const recorded = await queue.complete(job.id, workerId, result, job.lease_token);
    log({ event: recorded ? "job_succeeded" : "job_lease_lost", jobId: job.id, kind: job.kind });
  } catch (error) {
    if (controller.signal.aborted) { log({ event: "job_lease_lost", jobId: job.id, kind: job.kind }); return; }
    const failure = error instanceof StudioJobError
      ? { code: error.code, message: error.message, retryable: error.retryable, retryAfterSeconds: error.retryAfterSeconds }
      : { code: "unexpected_error", message: "The worker hit an unexpected error. It will retry.", retryable: true };
    const outcome = await queue.fail(job.id, workerId, failure, job.lease_token).catch(() => "report_failed");
    log({ event: "job_failed", jobId: job.id, kind: job.kind, code: failure.code, outcome });
  } finally { finished = true; clearTimeout(renewal); clearTimeout(deadline!); }
}

/** Poll, claim up to `concurrency` jobs, and drain cleanly when `signal` aborts. */
export async function runStudioWorker(options: StudioWorkerOptions): Promise<void> {
  const { queue, workerId, signal, log = () => {} } = options;
  const concurrency = options.concurrency ?? 2;
  const leaseSeconds = options.leaseSeconds ?? 120;
  const pollMs = options.pollMs ?? 5000;
  const heartbeatMs = options.heartbeatMs ?? 30_000;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = new Date();
  const running = new Set<Promise<void>>();
  let heartbeatConfirmed = false;
  let claimHealthy = false;
  let pulse: Promise<void> | null = null;
  const heartbeat = (draining = false): Promise<void> => {
    if (pulse) return pulse;
    pulse = queue.heartbeat(workerId, options.release ?? null, startedAt,
      options.report ? { ...options.report, healthy: claimHealthy && !draining, draining } : undefined)
      .then(() => { heartbeatConfirmed = true; }, () => { heartbeatConfirmed = false; log({ event: "heartbeat_failed" }); })
      .finally(() => { pulse = null; });
    return pulse;
  };
  await heartbeat();
  // Independent of job-slot saturation: long paid calls must not hide a live worker.
  const heartbeatTimer = setInterval(() => { if (!signal.aborted) void heartbeat(); }, heartbeatMs);
  try {
    while (!signal.aborted) {
      let claimed: StudioJob[] = [];
      if (heartbeatConfirmed && running.size < concurrency) {
        let claimSucceeded = false;
        claimed = await queue.claim(workerId, concurrency - running.size, leaseSeconds).then(jobs => { claimSucceeded = true; return jobs; }, () => {
          log({ event: "claim_failed" }); return [];
        });
        const changed = claimHealthy !== claimSucceeded;
        claimHealthy = claimSucceeded;
        if (changed) await heartbeat();
        // Drain an already-confirmed claim even if shutdown arrived while its response was in flight.
        for (const job of claimed) {
          const task = runStudioJob(job, { ...options, leaseSeconds }).finally(() => running.delete(task));
          running.add(task);
        }
      }
      if (!claimed.length || running.size >= concurrency) await sleep(pollMs, signal);
    }
  } finally {
    clearInterval(heartbeatTimer);
    // Serialize the final report behind any in-flight pulse. SQL makes draining terminal for this process identity.
    if (pulse) await pulse;
    await heartbeat(true);
    log({ event: "worker_draining", running: running.size });
    await Promise.allSettled(running);
  }
}
