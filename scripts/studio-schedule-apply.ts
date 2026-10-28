import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalJson, type JsonValue } from "../lib/studio/import/legacy-library";
import { normalizeLegacySchedules, ScheduleImportError } from "../lib/studio/import/legacy-schedules";
import type { SchedulePreviewManifest } from "../lib/studio/import/inspect-schedules";
import { readSourceSnapshot, SourceSnapshotError } from "../lib/studio/import/source-snapshot";
import { requireStandaloneImportOwner } from "../lib/studio/import/apply-target";
import { hasStudioSupabaseConfig } from "../lib/studio/recovery/config";
import { requestStudioRest, StudioRestError } from "../lib/studio/rest-client";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = /^[0-9a-f]{64}$/;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

function hasUnsupportedDatabaseText(value: JsonValue): boolean {
  if (typeof value === "string") return value.includes("\u0000") || !value.isWellFormed();
  if (Array.isArray(value)) return value.some(hasUnsupportedDatabaseText);
  return Boolean(value && typeof value === "object" && Object.entries(value).some(([key, entry]) => hasUnsupportedDatabaseText(key) || hasUnsupportedDatabaseText(entry)));
}

/** Pinning protects the reviewed artifact; rebuilding protects every normalized projection. */
export function validateScheduleManifest(value: unknown): SchedulePreviewManifest {
  if (!object(value) || value.schema !== "studio.legacy-schedules.v1" || value.valid !== true || value.mode !== "dry-run"
    || value.snapshotCheckedUnchanged !== true || value.executionEnabled !== false || value.applySupported !== false
    || typeof value.sourceCanonicalJson !== "string" || Buffer.byteLength(value.sourceCanonicalJson, "utf8") > 20 * 1024 * 1024
    || typeof value.sourceDigest !== "string" || !hash.test(value.sourceDigest)) throw new ScheduleImportError("manifest_not_ready");
  let normalized;
  let source: JsonValue;
  try { source = JSON.parse(value.sourceCanonicalJson); normalized = normalizeLegacySchedules(source); }
  catch { throw new ScheduleImportError("manifest_source_invalid"); }
  if (!normalized.valid) throw new ScheduleImportError("manifest_source_invalid");
  if (hasUnsupportedDatabaseText(source)) throw new ScheduleImportError("manifest_database_text_unsupported");
  if (normalized.sourceCanonicalJson !== value.sourceCanonicalJson) throw new ScheduleImportError("manifest_source_not_canonical");
  if (normalized.sourceDigest !== value.sourceDigest) throw new ScheduleImportError("manifest_source_digest_mismatch");
  for (const field of ["schedules", "runs", "counts", "issues"] as const) {
    if (value[field] === undefined || canonicalJson(value[field] as JsonValue) !== canonicalJson(normalized[field] as unknown as JsonValue)) throw new ScheduleImportError(`manifest_${field}_mismatch`);
  }
  const files = value.sourceFiles;
  if (!Array.isArray(files) || files.length !== 1 || !object(files[0]) || files[0].relativePath !== "schedules.json"
    || !Number.isSafeInteger(files[0].bytes) || Number(files[0].bytes) < 1 || Number(files[0].bytes) > 20 * 1024 * 1024
    || typeof files[0].sha256 !== "string" || !hash.test(files[0].sha256)) throw new ScheduleImportError("manifest_source_evidence_invalid");
  return value as unknown as SchedulePreviewManifest;
}
interface ImportResult {
  runId: string; workspaceId: string; sourceDigest: string;
  counts: SchedulePreviewManifest["counts"]; replayed: boolean; executionEnabled: false;
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("npx tsx scripts/studio-schedule-apply.ts --manifest /absolute/private/manifest.json --workspace UUID --owner-user-id CLERK_ID --expected-sha256 SHA256 --apply"); return;
  }
  const values = new Map<string, string>(); let apply = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--apply" && !apply) { apply = true; continue; }
    if (!["--manifest", "--workspace", "--owner-user-id", "--expected-sha256"].includes(key) || values.has(key) || !args[i + 1] || args[i + 1].startsWith("--")) throw new ScheduleImportError("invalid_arguments");
    values.set(key, args[++i]);
  }
  const file = values.get("--manifest") ?? "";
  const workspaceId = (values.get("--workspace") ?? "").toLowerCase();
  const ownerId = values.get("--owner-user-id") ?? "";
  const expectedHash = values.get("--expected-sha256") ?? "";
  if (!apply || values.size !== 4 || !path.isAbsolute(file) || !uuid.test(workspaceId) || !ownerId.trim() || ownerId !== ownerId.trim() || !hash.test(expectedHash)) throw new ScheduleImportError("invalid_arguments");
  const snapshot = await readSourceSnapshot(path.resolve(file), "manifest.json", 100 * 1024 * 1024);
  if (snapshot.sha256 !== expectedHash) throw new ScheduleImportError("manifest_hash_mismatch");
  let input: unknown;
  try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes)); }
  catch { throw new ScheduleImportError("manifest_json_invalid"); }
  const manifest = validateScheduleManifest(input);
  if (!hasStudioSupabaseConfig()) throw new ScheduleImportError("studio_credentials_missing_or_invalid");
  const config = { projectUrl: process.env.STUDIO_SUPABASE_URL!.trim(), serviceRoleKey: process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY!.trim() };
  await requireStandaloneImportOwner(config, workspaceId, ownerId, code => new ScheduleImportError(code));
  const result = await requestStudioRest<ImportResult>(config, "rpc/studio_import_schedules", {
    method: "POST", body: JSON.stringify({ p_workspace_id: workspaceId, p_source_digest: manifest.sourceDigest, p_manifest: manifest, p_owner_clerk_user_id: ownerId }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!result || !uuid.test(result.runId) || result.workspaceId !== workspaceId || result.sourceDigest !== manifest.sourceDigest
    || result.executionEnabled !== false || typeof result.replayed !== "boolean" || !result.counts
    || canonicalJson(result.counts) !== canonicalJson(manifest.counts)) throw new ScheduleImportError("remote_counts_did_not_reconcile");
  // Whitelist output; never echo arbitrary server fields or private manifest content.
  console.log(JSON.stringify({ mode: "applied-inactive-metadata", runId: result.runId, workspaceId, sourceDigest: result.sourceDigest,
    counts: result.counts, replayed: result.replayed, executionEnabled: false }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    if (error instanceof StudioRestError) console.error(JSON.stringify({ error: "studio_request_failed", status: error.status, code: error.code }));
    else console.error(JSON.stringify({ error: error instanceof ScheduleImportError || error instanceof SourceSnapshotError ? error.code : "schedule_apply_failed" }));
    process.exitCode = 1;
  });
}
