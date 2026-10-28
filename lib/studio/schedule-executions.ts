import { Prisma } from "@prisma/client";
import { studioDb } from "@/lib/studio/studio-db";
import { enableStudioYoutubeSchedule, runStudioYoutubeScheduleNow } from "./youtube-schedules";
import "server-only";
import { getStudioAccess } from "./access";
import { requireOwnStudioCommandLocation } from "./paid-workspace";
import type { readScheduleRunCommand, readScheduleCommand } from "./schedule-execution-policy";

export async function runStudioScheduleNow(locationId: string, command: ReturnType<typeof readScheduleRunCommand>) {
  const access = await requireOwnStudioCommandLocation(locationId);
  return studioDb.call<{ executionId: string; reviewId: string; jobId: string; workflow: "idea_review" | "script_brief" }>("studio_run_schedule_now", { p_location_id: access.locationId, p_actor_app: access.app,
      p_clerk_user_id: access.userId, p_schedule_id: command.scheduleId, p_expected_version: command.version,
      p_request_id: command.requestId, p_selection: command.ideas, p_confirm_paid: command.confirmPaid });
}

export async function executeStudioScheduleCommand(locationId: string, command: ReturnType<typeof readScheduleCommand>) {
  if (!("ideas" in command)) {
    return command.action === "enable_youtube" ? enableStudioYoutubeSchedule(locationId, command) : runStudioYoutubeScheduleNow(locationId, command);
  }
  if (command.action === "run_now") return runStudioScheduleNow(locationId, command);
  const access = await requireOwnStudioCommandLocation(locationId);
  return studioDb.call<{ enabled: boolean; stateVersion: number; nextRunAt: string | null }>("studio_set_schedule_recurring", { p_location_id: access.locationId, p_actor_app: access.app,
      p_clerk_user_id: access.userId, p_schedule_id: command.scheduleId, p_expected_version: command.version,
      p_state_version: command.stateVersion, p_request_id: command.requestId, p_action: command.action,
      p_selection: command.ideas, p_confirm_paid: command.confirmRecurringPaid });
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
export async function getStudioScheduleExecutionData(locationId: string, scheduleId: string, page: number) {
  const access = await getStudioAccess(locationId);
  if (!access || !/^[0-9a-f-]{36}$/i.test(scheduleId) || !Number.isSafeInteger(page) || page < 0 || page > 99999) return null;
  const [executions, ideas, recurring, ticks] = await Promise.all([
    studioDb.rows<HostedScheduleExecution>(Prisma.sql`select id,workflow,review_id,job_id,created_at,created_by_clerk_user_id,definition,activation_token,due_at,youtube_run_id from studio.studio_schedule_executions t where location_id = ${access.locationId} and schedule_id = ${scheduleId}::uuid order by created_at desc,id asc limit 21 offset ${page * 20}`),
    studioDb.rows<{ id: string; title: string; version: number }>(Prisma.sql`select id,title,version from studio.studio_records t where location_id = ${access.locationId} and kind = ${'content'} and archived = ${false} order by updated_at desc,id asc limit 100`),
    studioDb.rows<StudioScheduleRecurring>(Prisma.sql`select version,enabled,authorized_by,next_run_at,last_outcome,snapshot from studio.studio_schedule_recurring t where location_id = ${access.locationId} and schedule_id = ${scheduleId}::uuid limit 1`),
    studioDb.rows<{ due_at: string; outcome: string; created_at: string }>(Prisma.sql`select due_at,outcome,created_at from studio.studio_schedule_ticks t where location_id = ${access.locationId} and schedule_id = ${scheduleId}::uuid order by created_at desc limit 20`),
  ]);
  const visible = executions.slice(0, 20);
  const jobs = visible.length ? await studioDb.rows<{ id: string; status: string; last_error_message: string | null }>(Prisma.sql`select id,status,last_error_message from studio.studio_jobs t where location_id = ${access.locationId} and id = any(string_to_array(${visible.map(e => e.job_id).join(",")}, ',')::uuid[]) limit 20`) : [];
  return { recurring: recurring[0] ?? null, ticks, executions: visible.map(e => ({ ...e, job: jobs.find(j => j.id === e.job_id) })), ideas, hasMore: executions.length > 20 };
}
