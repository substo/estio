import "server-only";
import { auth } from "@clerk/nextjs/server";
import { getStudioAccess } from "./access";
import { isScheduleRequest, type ScheduleDraft } from "./schedule-policy";
import { Prisma } from "@prisma/client";
import { studioDb } from "./studio-db";

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

export async function listStudioSchedules(locationId: string, page: number) {
  const access = await getStudioAccess(locationId);
  if (!access) return null;
  const schedules = await studioDb.rows<StudioSchedule>(Prisma.sql`
    select id,version,preset_id,focus,interval_hours,daily_time,time_zone,updated_at
    from studio.studio_schedules where location_id=${access.locationId}
    order by created_at desc,id asc limit 21 offset ${page * 20}`);
  const visible = schedules.slice(0, 20);
  const active = visible.length ? await studioDb.rows<{ schedule_id: string }>(Prisma.sql`
    select schedule_id from studio.studio_schedule_recurring where location_id=${access.locationId}
    and schedule_id in (${Prisma.join(visible.map(s => s.id))}) and enabled=true limit 20`) : [];
  const activeIds = new Set(active.map(row => row.schedule_id));
  return { access, schedules: visible.map(s => ({ ...s, active: activeIds.has(s.id) })), hasMore: schedules.length > 20 };
}

export async function saveStudioSchedule(locationId: string, id: string, version: number, draft: ScheduleDraft) {
  const access = await getStudioAccess(locationId);
  if (!access || (await auth()).actor) throw new Error("Schedule changes require your own authorized account.");
  if (!isScheduleRequest(id, version)) throw new Error("Invalid schedule request.");
  return studioDb.call<StudioSchedule>("studio_save_schedule", { p_location_id: access.locationId, p_id: id,
      p_expected_version: version, p_actor_app: access.app, p_clerk_user_id: access.userId,
      p_preset_id: draft.presetId, p_focus: draft.query, p_interval_hours: draft.intervalHours, p_daily_time: draft.dailyTime });
}
