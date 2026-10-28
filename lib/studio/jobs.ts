import "server-only";
import { auth } from "@clerk/nextjs/server";
import { getStudioAccess, type StudioAccess } from "./access";
import { canManageStudioAi } from "./ai-settings-policy";
import { queryPath, studioRest } from "./rest";

export interface StudioJobRow {
  id: string; kind: string; status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempts: number; max_attempts: number; run_after: string; last_error_code: string | null; last_error_message: string | null;
  created_at: string; finished_at: string | null;
  execution_target: "hosted" | "device"; device_id: string | null; result: unknown;
  device: { revoked_at: string | null } | null;
}
/** Device retries consume the paired manager's subscription authority. */
export function canRetryStudioJob(access: StudioAccess, job: Pick<StudioJobRow, "execution_target" | "device">) {
  return job.execution_target === "hosted" || (canManageStudioAi(access)
    && job.device !== null && job.device.revoked_at === null);
}

/** A worker seen within this window is considered online. */
export const WORKER_ONLINE_SECONDS = 90;

/** Render only the diagnostic protocol, never arbitrary provider output or other job results. */
export function studioDiagnosticDisplayResult(kind: string, value: unknown): string | null {
  if (kind !== "studio.diagnostic" || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  if (typeof raw.ok === "boolean") safe.ok = raw.ok;
  if (typeof raw.workerId === "string" && /^[A-Za-z0-9:._-]{1,100}$/.test(raw.workerId)) safe.workerId = raw.workerId;
  if (typeof raw.checkedAt === "string" && /^\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?$/.test(raw.checkedAt) && raw.checkedAt.length <= 40 && Number.isFinite(Date.parse(raw.checkedAt))) safe.checkedAt = raw.checkedAt;
  if (raw.provider === "codex" || raw.provider === "claude") safe.provider = raw.provider;
  if (typeof raw.model === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(raw.model)) safe.model = raw.model;
  if (raw.summary === "Studio Mac connection works") safe.summary = raw.summary;
  if (typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs) && raw.durationMs >= 0 && raw.durationMs <= 300_000) safe.durationMs = raw.durationMs;
  return Object.keys(safe).length ? JSON.stringify(safe, null, 2) : null;
}

export async function listStudioJobs(locationId: string, page = 0) {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  const [jobs, workers] = await Promise.all([
    studioRest<StudioJobRow[]>(queryPath("studio_jobs", {
      select: "id,kind,status,attempts,max_attempts,run_after,last_error_code,last_error_message,created_at,finished_at,execution_target,device_id,result,device:studio_devices(revoked_at)",
      location_id: `eq.${access.locationId}`, order: "created_at.desc,id.asc", limit: "26", offset: String(page * 25) })),
    studioRest<Array<{ seen_at: string }>>(queryPath("studio_worker_heartbeats", { select: "seen_at", order: "seen_at.desc", limit: "1" })),
  ]);
  const lastSeen = workers[0]?.seen_at ?? null;
  return { access, jobs: jobs.slice(0, 25), hasMore: jobs.length > 25, workerLastSeen: lastSeen,
    workerOnline: lastSeen !== null && Date.now() - Date.parse(lastSeen) < WORKER_ONLINE_SECONDS * 1000 };
}

async function requireMember(locationId: string) {
  const access = await getStudioAccess(locationId);
  if (!access || (await auth()).actor) throw new Error("Job actions require your own authorized account.");
  return access;
}

export async function studioJobAction(locationId: string, jobId: string, action: "retry" | "cancel") {
  const access = await requireMember(locationId);
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new Error("Invalid job.");
  if (action === "retry") {
    const jobs = await studioRest<Array<Pick<StudioJobRow, "execution_target" | "device">>>(queryPath("studio_jobs", {
      select: "execution_target,device:studio_devices(revoked_at)", location_id: `eq.${access.locationId}`, id: `eq.${jobId}`, limit: "1" }));
    if (!jobs[0]) throw new Error("Job not found.");
    if (!canRetryStudioJob(access, jobs[0])) throw new Error("A Business admin and an active paired Mac are required to retry this job.");
  }
  return studioRest("rpc/studio_member_job_action", { method: "POST", body: JSON.stringify({
    p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_job_id: jobId, p_action: action }) });
}

/** Queue a no-cost worker check; repeated clicks within a minute reuse one job. */
export async function enqueueStudioWorkerCheck(locationId: string) {
  const access = await requireMember(locationId);
  const minute = Math.floor(Date.now() / 60_000);
  return studioRest("rpc/studio_enqueue_job", { method: "POST", body: JSON.stringify({
    p_location_id: access.locationId, p_kind: "studio.diagnostic", p_payload: {}, p_idempotency_key: `diagnostic:${access.userId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100)}:${minute}`,
    p_created_by: access.userId, p_max_attempts: 3 }) });
}
