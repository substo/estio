import { binCutoff, BIN_PURGE_BATCH, purgeKeys, type PurgePlanItem } from "./bin-policy";
import type { StudioDb } from "./db";

export interface PurgeStore { bucket: string; deleteObject(key: string): Promise<void> }
export interface PurgeResult { purged: number; failed: number; objectsDeleted: number }

/** Files first, rows second. A file that cannot be removed (not merely missing) leaves the item binned so tonight's retry finds it again; rows never outlive-orphan their files. */
export async function runStudioBinPurge(deps: { db: Pick<StudioDb, "call">; store: PurgeStore; now?: Date; log?: (message: string) => void }): Promise<PurgeResult> {
  const cutoff = binCutoff(deps.now ?? new Date()).toISOString();
  const plan = await deps.db.call<PurgePlanItem[]>("studio_bin_purge_plan", { p_cutoff: cutoff, p_limit: BIN_PURGE_BATCH });
  const result: PurgeResult = { purged: 0, failed: 0, objectsDeleted: 0 };
  for (const item of plan) {
    try {
      const keys = purgeKeys(item, deps.store.bucket);
      for (const key of keys) { await deps.store.deleteObject(key); result.objectsDeleted += 1; }
      if (await deps.db.call<boolean>("studio_bin_purge_finish", { p_kind: item.kind, p_location_id: item.locationId, p_id: item.id, p_cutoff: cutoff })) result.purged += 1;
    } catch (error) {
      result.failed += 1;
      deps.log?.(`bin purge failed for ${item.kind} ${item.id}: ${error instanceof Error ? error.message : "unknown"}`);
    }
  }
  return result;
}
