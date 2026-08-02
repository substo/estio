import { gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import {
  LOCATION_BACKUP_FORMAT,
  LOCATION_BACKUP_VERSION,
  type LocationBackupArchive,
} from "./policy";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export async function writeArchive(filePath: string, archive: LocationBackupArchive): Promise<void> {
  const payload = Buffer.from(JSON.stringify(archive), "utf8");
  await writeFile(filePath, await gzipAsync(payload, { level: 9 }));
}

export async function readArchive(filePath: string): Promise<LocationBackupArchive> {
  let parsed: unknown;
  try {
    parsed = JSON.parse((await gunzipAsync(await readFile(filePath))).toString("utf8"));
  } catch (error) {
    throw new Error(`Could not read location backup ${filePath}: ${error instanceof Error ? error.message : error}`);
  }
  validateArchive(parsed);
  return parsed;
}

export function validateArchive(value: unknown): asserts value is LocationBackupArchive {
  if (!value || typeof value !== "object") throw new Error("Backup payload must be an object");
  const archive = value as Partial<LocationBackupArchive>;
  if (archive.format !== LOCATION_BACKUP_FORMAT) throw new Error("Unsupported backup format");
  if (archive.version !== LOCATION_BACKUP_VERSION) throw new Error(`Unsupported backup version: ${archive.version}`);
  if (!archive.source?.locationId) throw new Error("Backup source location is missing");
  if (!archive.schemaFingerprint) throw new Error("Backup schema fingerprint is missing");
  if (!archive.tables || typeof archive.tables !== "object") throw new Error("Backup tables are missing");
  for (const [modelName, rows] of Object.entries(archive.tables)) {
    if (!Array.isArray(rows)) throw new Error(`Backup table ${modelName} is not an array`);
  }
}
