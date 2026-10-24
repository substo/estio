import { requestStudioRest, type StudioRestConfig } from "../rest-client";

export interface StudioJob {
  id: string; workspace_id: string; kind: string; payload: Record<string, unknown>;
  lease_token: string; lease_expires_at?: string;
  attempts: number; max_attempts: number;
}
export interface StudioWorkerReport { instanceId: string; handlers: string[]; healthy: boolean; draining: boolean }
export interface StudioQueue {
  claim(workerId: string, limit: number, leaseSeconds: number): Promise<StudioJob[]>;
  extend(jobId: string, workerId: string, leaseSeconds: number, leaseToken: string): Promise<boolean>;
  complete(jobId: string, workerId: string, result: Record<string, unknown>, leaseToken: string): Promise<boolean>;
  fail(jobId: string, workerId: string, failure: { code: string; message: string; retryable: boolean; retryAfterSeconds?: number }, leaseToken: string): Promise<string>;
  heartbeat(workerId: string, release: string | null, startedAt: Date, report?: StudioWorkerReport): Promise<void>;
}

/** Service-role queue client. Workspace authority was checked when the job was enqueued. */
export function createRestStudioQueue(config: StudioRestConfig, fetcher: typeof fetch = fetch): StudioQueue {
  const rpc = <T>(name: string, body: Record<string, unknown>) => requestStudioRest<T>(config, `rpc/${name}`, {
    method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) }, fetcher);
  return {
    claim: (workerId, limit, leaseSeconds) => rpc<StudioJob[]>("studio_claim_jobs", { p_worker_id: workerId, p_limit: limit, p_lease_seconds: leaseSeconds }),
    extend: (jobId, workerId, leaseSeconds, leaseToken) => rpc<boolean>("studio_extend_job_lease", { p_job_id: jobId, p_worker_id: workerId, p_lease_seconds: leaseSeconds, p_lease_token: leaseToken }),
    complete: (jobId, workerId, result, leaseToken) => rpc<boolean>("studio_complete_job", { p_job_id: jobId, p_worker_id: workerId, p_result: result, p_lease_token: leaseToken }),
    fail: (jobId, workerId, failure, leaseToken) => rpc<string>("studio_fail_job", { p_job_id: jobId, p_worker_id: workerId, p_error_code: failure.code,
      p_error_message: failure.message, p_retryable: failure.retryable, p_retry_after_seconds: failure.retryAfterSeconds ?? null, p_lease_token: leaseToken }),
    heartbeat: async (workerId, release, startedAt, report) => {
      if (report) await rpc("studio_report_worker", { p_worker_id: workerId, p_release: release, p_started_at: startedAt.toISOString(),
        p_instance_id: report.instanceId, p_handlers: report.handlers, p_healthy: report.healthy, p_draining: report.draining });
      else await rpc("studio_worker_heartbeat", { p_worker_id: workerId, p_release: release, p_started_at: startedAt.toISOString() });
    },
  };
}
