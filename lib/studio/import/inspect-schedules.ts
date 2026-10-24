import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { normalizeLegacySchedules, ScheduleImportError, type LegacySchedulesManifest } from "./legacy-schedules";
import { readSourceSnapshot, assertSourceSnapshotUnchanged, sameIdentity } from "./source-snapshot";

export interface SchedulePreviewManifest extends LegacySchedulesManifest {
  mode: "dry-run";
  snapshotCheckedUnchanged: true;
  sourceFiles: Array<{ relativePath: string; bytes: number; sha256: string }>;
}

/** Only schedules.json is opened; no local app, ignored media, credentials or network. */
export async function inspectLegacySchedules(dataDirectory: string): Promise<SchedulePreviewManifest> {
  const dataDir = await realpath(dataDirectory);
  const before = await lstat(dataDir, { bigint: true });
  if (!before.isDirectory()) throw new ScheduleImportError("invalid_source_directory");
  const source = await readSourceSnapshot(path.join(dataDir, "schedules.json"), "schedules.json", 20 * 1024 * 1024);
  let input: unknown;
  try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source.bytes)); }
  catch { throw new ScheduleImportError("invalid_schedules_json"); }
  const manifest = normalizeLegacySchedules(input);
  await assertSourceSnapshotUnchanged(source);
  if (!sameIdentity(before, await lstat(dataDir, { bigint: true }))) throw new ScheduleImportError("source_changed_during_preview");
  return { ...manifest, mode: "dry-run", snapshotCheckedUnchanged: true,
    sourceFiles: [{ relativePath: source.relativePath, bytes: source.bytes.length, sha256: source.sha256 }] };
}
