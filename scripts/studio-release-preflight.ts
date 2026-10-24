#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { readdir, readFile, statfs } from "node:fs/promises";
import { parseArgs } from "node:util";
import path from "node:path";
import { buildStudioReleasePreflight } from "../lib/studio/recovery/preflight";
async function main() {
 const { values } = parseArgs({ options: { "project-ref": { type: "string" }, bucket: { type: "string" }, "artifact-bytes": { type: "string" }, "backup-spool-bytes": { type: "string" }, "media-temp-bytes": { type: "string" } }, strict: true });
 for (const name of ["project-ref", "bucket", "artifact-bytes", "backup-spool-bytes", "media-temp-bytes"] as const) if (values[name] === undefined) throw new Error("missing_input");
 const directory = path.resolve("studio/supabase/migrations");
 const migrations = [];
 for (const name of (await readdir(directory)).filter(n => n.endsWith(".sql")).sort()) migrations.push({ name, sha256: createHash("sha256").update(await readFile(path.join(directory, name))).digest("hex") });
 const disk = await statfs(process.cwd());
 const result = buildStudioReleasePreflight({ env: process.env, projectRef: values["project-ref"]!, bucket: values.bucket!,
  artifactBytes: Number(values["artifact-bytes"]), backupSpoolBytes: Number(values["backup-spool-bytes"]), mediaTempBytes: Number(values["media-temp-bytes"]), freeBytes: disk.bavail * disk.bsize, migrations });
 console.log(JSON.stringify(result)); process.exitCode = result.configurationReady ? 0 : 1;
}
main().catch(() => { console.error(JSON.stringify({ configurationReady: false, releaseReady: false, error: "preflight_unconfirmed" })); process.exitCode = 1; });
