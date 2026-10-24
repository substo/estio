import "server-only";
import { auth } from "@clerk/nextjs/server";
import { getStudioWorkspaceAccess } from "./access";
import { isScheduleRequest, type ScheduleDraft } from "./schedule-policy";
import { queryPath, studioRest } from "./rest";

export interface StudioSchedule {
  id: string;
  version: number;
  preset_id: ScheduleDraft["presetId"];
  focus: string;
  interval_hours: 24 | 168;
  daily_time: string;
  time_zone: string;
  updated_at: string;
}

export async function listStudioSchedules(workspaceId: string, page: number) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access) return null;
  const schedules = await studioRest<StudioSchedule[]>(queryPath("studio_schedules", {
    select: "id,version,preset_id,focus,interval_hours,daily_time,time_zone,updated_at",
    workspace_id: `eq.${access.workspace.id}`, order: "created_at.desc,id.asc", limit: "21", offset: String(page * 20),
  }));
  return { access, schedules: schedules.slice(0, 20), hasMore: schedules.length > 20 };
}

export async function saveStudioSchedule(workspaceId: string, id: string, version: number, draft: ScheduleDraft) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || (await auth()).actor) throw new Error("Schedule changes require your own authorized account.");
  if (!isScheduleRequest(id, version)) throw new Error("Invalid schedule request.");
  return studioRest<StudioSchedule>("rpc/studio_save_schedule", {
    method: "POST", body: JSON.stringify({ p_workspace_id: access.workspace.id, p_id: id,
      p_expected_version: version, p_actor_brand: access.brand, p_clerk_user_id: access.userId,
      p_preset_id: draft.presetId, p_focus: draft.query, p_interval_hours: draft.intervalHours, p_daily_time: draft.dailyTime }),
  });
}
