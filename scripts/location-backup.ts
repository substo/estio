import path from "node:path";
import { parseArgs } from "node:util";
import { readArchive } from "../lib/location-backup/archive";
import {
  createDatabaseClient,
  exportLocationToFile,
  planLocationRestore,
  restoreLocation,
} from "../lib/location-backup/service";

const HELP = `
Backend-only Location backup and restore

Export:
  npm run location:backup -- export --location SOURCE_ID [--output FILE] [--db-url URL]

Inspect:
  npm run location:backup -- inspect --input FILE

Dry-run restore:
  npm run location:backup -- import --location TARGET_ID --input FILE --dry-run [--db-url URL]

Restore (destructive for the target's included business data):
  npm run location:backup -- import --location TARGET_ID --input FILE \\
    --confirm-target TARGET_ID [--db-url URL]

Default download directory:
  backups/locations/<source-id>-<timestamp>.location-backup.json.gz
`;

function required(value: string | undefined, flag: string): string {
  if (!value?.trim()) throw new Error(`${flag} is required`);
  return value.trim();
}

function defaultOutput(locationId: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve("backups", "locations", `${locationId}-${timestamp}.location-backup.json.gz`);
}

async function main() {
  const command = process.argv[2];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return;
  }
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      location: { type: "string" },
      output: { type: "string" },
      input: { type: "string" },
      "db-url": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "confirm-target": { type: "string" },
    },
    strict: true,
  });

  if (command === "inspect") {
    const input = path.resolve(required(values.input, "--input"));
    const archive = await readArchive(input);
    process.stdout.write(`${JSON.stringify({ input, ...archive, tables: undefined }, null, 2)}\n`);
    return;
  }

  const locationId = required(values.location, "--location");
  const client = createDatabaseClient(values["db-url"]);
  try {
    if (command === "export") {
      const output = path.resolve(values.output || defaultOutput(locationId));
      const archive = await exportLocationToFile({ client, locationId, outputPath: output });
      process.stdout.write(`${JSON.stringify({ ok: true, output, source: archive.source, rowCounts: archive.rowCounts }, null, 2)}\n`);
      return;
    }
    if (command === "import") {
      const input = path.resolve(required(values.input, "--input"));
      const archive = await readArchive(input);
      const plan = await planLocationRestore({ client, archive, targetLocationId: locationId });
      if (values["dry-run"]) {
        process.stdout.write(`${JSON.stringify({ ok: true, dryRun: true, input, plan }, null, 2)}\n`);
        return;
      }
      if (values["confirm-target"] !== locationId) {
        throw new Error(`Refusing restore: pass --confirm-target ${locationId} exactly`);
      }
      const result = await restoreLocation({ client, archive, targetLocationId: locationId });
      process.stdout.write(`${JSON.stringify({ ok: true, dryRun: false, input, plan: result }, null, 2)}\n`);
      return;
    }
    throw new Error(`Unknown command: ${command}\n${HELP}`);
  } finally {
    await client.$disconnect();
  }
}

void main().catch((error) => {
  process.stderr.write(`Location backup failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
