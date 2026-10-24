import { realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspectLegacySchedules } from "../lib/studio/import/inspect-schedules";
import { ScheduleImportError } from "../lib/studio/import/legacy-schedules";
import { SourceSnapshotError } from "../lib/studio/import/source-snapshot";

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Dry-run only: npx tsx scripts/studio-schedule-preview.ts --data-dir /absolute/Substo/data --output /absolute/private/schedule-manifest.json");
    return;
  }
  if (args.length !== 4 || args[0] !== "--data-dir" || args[2] !== "--output" || !path.isAbsolute(args[1]) || !path.isAbsolute(args[3])) throw new ScheduleImportError("invalid_arguments");
  const dataDir = await realpath(args[1]);
  const parent = await realpath(path.dirname(args[3]));
  const output = path.join(parent, path.basename(args[3]));
  const relative = path.relative(dataDir, output);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new ScheduleImportError("output_must_be_outside_source");
  const manifest = await inspectLegacySchedules(dataDir);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > 100 * 1024 * 1024) throw new ScheduleImportError("schedule_manifest_byte_limit_exceeded");
  await writeFile(output, serialized, { encoding: "utf8", mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ mode: manifest.mode, valid: manifest.valid, counts: manifest.counts, issues: manifest.issues.length,
    executionEnabled: manifest.executionEnabled, applySupported: manifest.applySupported, output }));
  if (!manifest.valid) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ error: error instanceof ScheduleImportError || error instanceof SourceSnapshotError ? error.code : "schedule_preview_failed" }));
    process.exitCode = 1;
  });
}
