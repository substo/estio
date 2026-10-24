import "server-only";
import { auth } from "@clerk/nextjs/server";
import { getStudioWorkspaceAccess } from "./access";
import { queryPath, studioRest } from "./rest";

export interface StudioJobRow {
  id: string; kind: string; status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempts: number; max_attempts: number; run_after: string; last_error_code: string | null; last_error_message: string | null;
  created_at: string; finished_at: string | null;
}
/** A worker seen within this window is considered online. */
export const WORKER_ONLINE_SECONDS = 90;

export async function listStudioJobs(workspaceId: string, page = 0) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access) return null;
  const [jobs, workers] = await Promise.all([
    studioRest<StudioJobRow[]>(queryPath("studio_jobs", {
      select: "id,kind,status,attempts,max_attempts,run_after,last_error_code,last_error_message,created_at,finished_at",
      workspace_id: `eq.${access.workspace.id}`, order: "created_at.desc,id.asc", limit: "26", offset: String(page * 25) })),
    studioRest<Array<{ seen_at: string }>>(queryPath("studio_worker_heartbeats", { select: "seen_at", order: "seen_at.desc", limit: "1" })),
  ]);
  const lastSeen = workers[0]?.seen_at ?? null;
  return { access, jobs: jobs.slice(0, 25), hasMore: jobs.length > 25, workerLastSeen: lastSeen,
    workerOnline: lastSeen !== null && Date.now() - Date.parse(lastSeen) < WORKER_ONLINE_SECONDS * 1000 };
}

async function requireMember(workspaceId: string) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || (await auth()).actor) throw new Error("Job actions require your own authorized account.");
  return access;
}

export async function studioJobAction(workspaceId: string, jobId: string, action: "retry" | "cancel") {
  const access = await requireMember(workspaceId);
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new Error("Invalid job.");
  return studioRest("rpc/studio_member_job_action", { method: "POST", body: JSON.stringify({
    p_workspace_id: access.workspace.id, p_actor_brand: access.brand, p_clerk_user_id: access.userId, p_job_id: jobId, p_action: action }) });
}

/** Queue a no-cost worker check; repeated clicks within a minute reuse one job. */
export async function enqueueStudioWorkerCheck(workspaceId: string) {
  const access = await requireMember(workspaceId);
  const minute = Math.floor(Date.now() / 60_000);
  return studioRest("rpc/studio_enqueue_job", { method: "POST", body: JSON.stringify({
    p_workspace_id: access.workspace.id, p_kind: "studio.diagnostic", p_payload: {}, p_idempotency_key: `diagnostic:${access.userId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100)}:${minute}`,
    p_created_by: access.userId, p_max_attempts: 3 }) });
}
