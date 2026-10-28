import { Prisma } from "@prisma/client";
import type { StudioDb } from "./db";
import { scheduleHistoryId } from "./schedule-history-policy";
import type { StudioSchedule } from "./schedules";

export interface ScheduleLegacyDefinition {
  id: string; import_run_id: string; source_index: number; payload: Record<string, unknown>;
}
export interface ScheduleRunSummary {
  id: string; schedule_id: string; import_run_id: string; source_index: number;
  preset_id: string | null; status: string | null; started_at: string | null; completed_at: string | null;
}
export interface ScheduleLegacyRun {
  id: string; schedule_id: string; import_run_id: string; source_index: number; payload: Record<string, unknown>;
}
export interface ScheduleImportProvenance {
  id: string; source_digest: string; counts: Record<string, number>;
  created_at: string; imported_by_clerk_user_id: string;
  preview_evidence: Record<string, unknown>;
}
export interface ScheduleImportSnapshot extends ScheduleImportProvenance { source_canonical_json: string; }
const importFields = "id,source_digest,counts,created_at,imported_by_clerk_user_id,preview_evidence";

/** Dependencies keep authorization/query boundaries directly verifiable without a Clerk session. */
export function createScheduleHistoryReader<Access extends { locationId: string }>(dependencies: {
  authorize: (locationId: string) => Promise<Access | null>;
  db: StudioDb;
}) {
  const { authorize, db } = dependencies;
  async function provenance(locationId: string, importId: string) {
    const rows = await db.rows<ScheduleImportProvenance>(Prisma.sql`select id,source_digest,counts,created_at,imported_by_clerk_user_id,preview_evidence from studio.studio_schedule_import_runs t where location_id = ${locationId} and id = ${importId}::uuid limit 1`);
    return rows[0] ?? null;
  }
  return {
    async schedule(locationId: string, scheduleId: string, page: number) {
      if (!scheduleHistoryId(scheduleId) || !Number.isSafeInteger(page) || page < 0 || page > 99_999) return null;
      const access = await authorize(locationId);
      if (!access) return null;
      const workspace = access.locationId;
      const rows = await db.rows<StudioSchedule>(Prisma.sql`select id,version,preset_id,focus,interval_hours,daily_time,time_zone,updated_at from studio.studio_schedules t where location_id = ${workspace} and id = ${scheduleId}::uuid limit 1`);
      if (!rows[0]) return null;
      const definitions = await db.rows<ScheduleLegacyDefinition>(Prisma.sql`select id,import_run_id,source_index,payload from studio.studio_schedule_legacy_definitions t where location_id = ${workspace} and id = ${scheduleId}::uuid limit 1`);
      const legacy = definitions[0] ?? null;
      const [history, imported] = legacy ? await Promise.all([
        db.rows<ScheduleRunSummary>(Prisma.sql`select id,schedule_id,import_run_id,source_index,payload->>'presetId' as preset_id,payload->>'status' as status,payload->>'startedAt' as started_at,payload->>'completedAt' as completed_at from studio.studio_schedule_legacy_runs where location_id = ${workspace} and schedule_id = ${scheduleId}::uuid and import_run_id = ${legacy.import_run_id}::uuid order by source_index asc,id asc limit 21 offset ${page * 20}`),
        provenance(workspace, legacy.import_run_id),
      ]) : [[], null];
      return { access, schedule: rows[0], legacy, imported, history: history.slice(0, 20), hasMore: history.length > 20 };
    },
    async run(locationId: string, scheduleId: string, runId: string) {
      if (!scheduleHistoryId(scheduleId) || !scheduleHistoryId(runId)) return null;
      const access = await authorize(locationId);
      if (!access) return null;
      const workspace = access.locationId;
      const rows = await db.rows<ScheduleLegacyRun>(Prisma.sql`select id,schedule_id,import_run_id,source_index,payload from studio.studio_schedule_legacy_runs t where location_id = ${workspace} and schedule_id = ${scheduleId}::uuid and id = ${runId}::uuid limit 1`);
      if (!rows[0]) return null;
      const imported = await provenance(workspace, rows[0].import_run_id);
      return { access, run: rows[0], imported };
    },
    async snapshot(locationId: string, importId: string) {
      if (!scheduleHistoryId(importId)) return null;
      const access = await authorize(locationId);
      if (!access) return null;
      const rows = await db.rows<ScheduleImportSnapshot>(Prisma.sql`select id,source_digest,counts,created_at,imported_by_clerk_user_id,preview_evidence,source_canonical_json from studio.studio_schedule_import_runs t where location_id = ${access.locationId} and id = ${importId}::uuid limit 1`);
      return rows[0] ? { access, imported: rows[0] } : null;
    },
  };
}
