import { realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectLegacyLibrary } from "../lib/studio/import/inspect-library";
import { LegacyImportValidationError } from "../lib/studio/import/legacy-library";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("Dry-run only: npx tsx scripts/studio-import.ts --data-dir /absolute/Substo/data --output /absolute/private/manifest.json");
    return;
  }
  if (args.length !== 4 || args[0] !== "--data-dir" || args[2] !== "--output" || !path.isAbsolute(args[1]) || !path.isAbsolute(args[3])) {
    throw new Error("Use --data-dir and --output with absolute paths. This command supports dry-run manifests only.");
  }
  const dataDir = await realpath(args[1]);
  const outputParent = await realpath(path.dirname(args[3]));
  const output = path.join(outputParent, path.basename(args[3]));
  const relative = path.relative(dataDir, output);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("The output must be outside the source data directory.");
  }
  const manifest = await inspectLegacyLibrary(dataDir);
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ mode: manifest.mode, valid: manifest.valid, mediaReady: manifest.mediaReady, counts: manifest.counts, issues: manifest.issues.length, output }));
  if (!manifest.valid || !manifest.mediaReady) process.exitCode = 2;
}

main().catch((error: unknown) => {
  if (error instanceof LegacyImportValidationError) console.error(JSON.stringify({ error: error.message, issues: error.issues }));
  else console.error(error instanceof Error ? error.message : "Import inspection failed.");
  process.exitCode = 1;
});
