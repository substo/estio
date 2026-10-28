import { queryPath } from "./rest-client";
import { scheduleHistoryId, scheduleHistoryQuery } from "./schedule-history-policy";
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
  read: <T>(path: string) => Promise<T>;
}) {
  const { authorize, read } = dependencies;
  async function provenance(locationId: string, importId: string) {
    const rows = await read<ScheduleImportProvenance[]>(queryPath("studio_schedule_import_runs", {
      select: importFields, location_id: `eq.${locationId}`, id: `eq.${importId}`, limit: "1",
    }));
    return rows[0] ?? null;
  }
  return {
    async schedule(locationId: string, scheduleId: string, page: number) {
      if (!scheduleHistoryId(scheduleId) || !Number.isSafeInteger(page) || page < 0 || page > 99_999) return null;
      const access = await authorize(locationId);
      if (!access) return null;
      const workspace = access.locationId;
      const rows = await read<StudioSchedule[]>(queryPath("studio_schedules", {
        select: "id,version,preset_id,focus,interval_hours,daily_time,time_zone,updated_at",
        location_id: `eq.${workspace}`, id: `eq.${scheduleId}`, limit: "1",
      }));
      if (!rows[0]) return null;
      const definitions = await read<ScheduleLegacyDefinition[]>(queryPath("studio_schedule_legacy_definitions", {
        select: "id,import_run_id,source_index,payload", location_id: `eq.${workspace}`, id: `eq.${scheduleId}`, limit: "1",
      }));
      const legacy = definitions[0] ?? null;
      const [history, imported] = legacy ? await Promise.all([
        read<ScheduleRunSummary[]>(queryPath("studio_schedule_legacy_runs", scheduleHistoryQuery(workspace, scheduleId, legacy.import_run_id, page))),
        provenance(workspace, legacy.import_run_id),
      ]) : [[], null];
      return { access, schedule: rows[0], legacy, imported, history: history.slice(0, 20), hasMore: history.length > 20 };
    },
    async run(locationId: string, scheduleId: string, runId: string) {
      if (!scheduleHistoryId(scheduleId) || !scheduleHistoryId(runId)) return null;
      const access = await authorize(locationId);
      if (!access) return null;
      const workspace = access.locationId;
      const rows = await read<ScheduleLegacyRun[]>(queryPath("studio_schedule_legacy_runs", {
        select: "id,schedule_id,import_run_id,source_index,payload", location_id: `eq.${workspace}`,
        schedule_id: `eq.${scheduleId}`, id: `eq.${runId}`, limit: "1",
      }));
      if (!rows[0]) return null;
      const imported = await provenance(workspace, rows[0].import_run_id);
      return { access, run: rows[0], imported };
    },
    async snapshot(locationId: string, importId: string) {
      if (!scheduleHistoryId(importId)) return null;
      const access = await authorize(locationId);
      if (!access) return null;
      const rows = await read<ScheduleImportSnapshot[]>(queryPath("studio_schedule_import_runs", {
        select: `${importFields},source_canonical_json`, location_id: `eq.${access.locationId}`, id: `eq.${importId}`, limit: "1",
      }));
      return rows[0] ? { access, imported: rows[0] } : null;
    },
  };
}
