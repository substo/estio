import { characterSheetKey, SHEET_FILE } from "./character-profile";

/** Binned items stay restorable this long; the nightly purge removes anything older. */
export const BIN_RETENTION_DAYS = 30;
export const BIN_PURGE_BATCH = 50;

export type BinKind = "content" | "upload";
export interface BinListItem { kind: BinKind; id: string; name: string; deletedAt: string; detail: string | number | null; purgesAt: string }

export const binCutoff = (now: Date) => new Date(now.getTime() - BIN_RETENTION_DAYS * 86_400_000);
export const binPurgesAt = (deletedAt: string) => new Date(new Date(deletedAt).getTime() + BIN_RETENTION_DAYS * 86_400_000).toISOString();
export const readBinKind = (value: unknown): BinKind | null => value === "content" || value === "upload" ? value : null;

export interface PurgePlanItem {
  kind: BinKind; locationId: string; id: string;
  objects: Array<{ bucket: string | null; key: string }>;
  jobs: Array<{ id: string; userId: string | null; files: unknown }>;
}

/** Every stored file an item owns. Picture and transcript keys come from the job id and owner, never from what a Mac reported. */
export function purgeKeys(item: PurgePlanItem, bucket: string): string[] {
  const keys = new Set<string>();
  for (const o of item.objects) if (o && typeof o.key === "string" && o.key.startsWith(`${item.locationId}/`) && (!o.bucket || o.bucket === bucket)) keys.add(o.key);
  for (const job of item.jobs) {
    if (!job.userId || !Array.isArray(job.files)) continue;
    for (const name of job.files) if (typeof name === "string" && (SHEET_FILE.test(name) || name === "transcript.json")) keys.add(characterSheetKey(item.locationId, job.userId, job.id, name));
  }
  return [...keys];
}
