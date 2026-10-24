import { enableStudioYoutubeSchedule } from "./youtube-schedules";
import "server-only";
import { getStudioWorkspaceAccess } from "./access";
import { requireOwnStudioCommandWorkspace } from "./paid-workspace";
import { queryPath, studioRest } from "./rest";
import type { readScheduleRunCommand, readScheduleCommand } from "./schedule-execution-policy";

export async function runStudioScheduleNow(workspaceId: string, command: ReturnType<typeof readScheduleRunCommand>) {
  const access = await requireOwnStudioCommandWorkspace(workspaceId);
  return studioRest<{ executionId: string; reviewId: string; jobId: string; workflow: "idea_review" | "script_brief" }>("rpc/studio_run_schedule_now", {
    method: "POST", body: JSON.stringify({ p_workspace_id: access.workspace.id, p_actor_brand: access.brand,
      p_clerk_user_id: access.userId, p_schedule_id: command.scheduleId, p_expected_version: command.version,
      p_request_id: command.requestId, p_selection: command.ideas, p_confirm_paid: command.confirmPaid }),
  });
}

export async function executeStudioScheduleCommand(workspaceId: string, command: ReturnType<typeof readScheduleCommand>) {
  if (command.action === "enable_youtube") return enableStudioYoutubeSchedule(workspaceId, command);
  if (command.action === "run_now") return runStudioScheduleNow(workspaceId, command);
  const access = await requireOwnStudioCommandWorkspace(workspaceId);
  return studioRest<{ enabled: boolean; stateVersion: number; nextRunAt: string | null }>("rpc/studio_set_schedule_recurring", {
    method: "POST", body: JSON.stringify({ p_workspace_id: access.workspace.id, p_actor_brand: access.brand,
      p_clerk_user_id: access.userId, p_schedule_id: command.scheduleId, p_expected_version: command.version,
      p_state_version: command.stateVersion, p_request_id: command.requestId, p_action: command.action,
      p_selection: command.ideas, p_confirm_paid: command.confirmRecurringPaid }),
  });
}
export interface StudioScheduleRecurring {
  version: number; enabled: boolean; authorized_by: string; next_run_at: string | null; last_outcome: string | null;
  snapshot: unknown;
}

export interface HostedScheduleExecution {
  id: string; workflow: "idea_review" | "script_brief" | "youtube_discovery"; review_id: string | null; youtube_run_id: string | null; job_id: string;
  activation_token: string | null; due_at: string | null;
  created_at: string; created_by_clerk_user_id: string;
  definition: { version: number; presetId: string; focus: string; intervalHours: number; dailyTime: string; timeZone: string };
}
export async function getStudioScheduleExecutionData(workspaceId: string, scheduleId: string, page: number) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || !/^[0-9a-f-]{36}$/i.test(scheduleId) || !Number.isSafeInteger(page) || page < 0 || page > 99999) return null;
  const [executions, ideas, recurring, ticks] = await Promise.all([
    studioRest<HostedScheduleExecution[]>(queryPath("studio_schedule_executions", { select: "id,workflow,review_id,job_id,created_at,created_by_clerk_user_id,definition,activation_token,due_at,youtube_run_id",
      workspace_id: `eq.${access.workspace.id}`, schedule_id: `eq.${scheduleId}`, order: "created_at.desc,id.asc", limit: "21", offset: String(page * 20) })),
    studioRest<Array<{ id: string; title: string; version: number }>>(queryPath("studio_records", { select: "id,title,version", workspace_id: `eq.${access.workspace.id}`,
      kind: "eq.content", archived: "eq.false", "payload->>stage": "eq.idea", order: "updated_at.desc,id.asc", limit: "100" })),
    studioRest<StudioScheduleRecurring[]>(queryPath("studio_schedule_recurring", { select: "version,enabled,authorized_by,next_run_at,last_outcome,snapshot",
      workspace_id: `eq.${access.workspace.id}`, schedule_id: `eq.${scheduleId}`, limit: "1" })),
    studioRest<Array<{ due_at: string; outcome: string; created_at: string }>>(queryPath("studio_schedule_ticks", { select: "due_at,outcome,created_at",
      workspace_id: `eq.${access.workspace.id}`, schedule_id: `eq.${scheduleId}`, order: "created_at.desc", limit: "20" })),
  ]);
  const visible = executions.slice(0, 20);
  const jobs = visible.length ? await studioRest<Array<{ id: string; status: string; last_error_message: string | null }>>(queryPath("studio_jobs", {
    select: "id,status,last_error_message", workspace_id: `eq.${access.workspace.id}`, id: `in.(${visible.map(e => e.job_id).join(",")})`, limit: "20" })) : [];
  return { recurring: recurring[0] ?? null, ticks, executions: visible.map(e => ({ ...e, job: jobs.find(j => j.id === e.job_id) })), ideas, hasMore: executions.length > 20 };
}
