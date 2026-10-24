import { requireStandaloneImportOwner } from "../lib/studio/import/apply-target";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalJson, normalizeLegacyLibrary, type JsonValue } from "../lib/studio/import/legacy-library";
import type { InspectedLibraryManifest } from "../lib/studio/import/inspect-library";
import { hasStudioSupabaseConfig } from "../lib/studio/config";
import { requestStudioRest, StudioRestError } from "../lib/studio/rest-client";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/;

class ImportApplyError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "ImportApplyError"; }
}

function jsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Rebuild the normalized projections from untouched payload before any network call. */
export function validateImportManifest(value: unknown): InspectedLibraryManifest {
  if (!jsonObject(value) || value.schema !== "studio.legacy-library.v1" || value.mode !== "dry-run" ||
    value.valid !== true || value.mediaReady !== true || typeof value.sourceDigest !== "string" || !digest.test(value.sourceDigest) ||
    typeof value.sourceCanonicalJson !== "string" || Buffer.byteLength(value.sourceCanonicalJson, "utf8") > 100 * 1024 * 1024 ||
    !Array.isArray(value.records) || !Array.isArray(value.files)) throw new ImportApplyError("manifest_not_ready");
  let sourceSnapshot: unknown;
  try { sourceSnapshot = JSON.parse(value.sourceCanonicalJson); }
  catch { throw new ImportApplyError("manifest_source_snapshot_invalid"); }
  if (canonicalJson(sourceSnapshot as JsonValue) !== value.sourceCanonicalJson) throw new ImportApplyError("manifest_source_snapshot_not_canonical");
  if (createHash("sha256").update(value.sourceCanonicalJson, "utf8").digest("hex") !== value.sourceDigest) throw new ImportApplyError("manifest_source_digest_mismatch");
  let normalized;
  try {
    normalized = normalizeLegacyLibrary(sourceSnapshot);
  } catch { throw new ImportApplyError("manifest_payload_invalid"); }
  if (!normalized.valid) throw new ImportApplyError("manifest_relationships_invalid");
  for (const field of ["records", "files", "counts", "issues"] as const) {
    if (canonicalJson(value[field] as JsonValue) !== canonicalJson(normalized[field] as JsonValue)) {
      throw new ImportApplyError(`manifest_${field}_mismatch`);
    }
  }
  const expectedMedia = normalized.files.map((file) => ({ id: file.id, relativePath: file.relativePath, status: "present", actualBytes: file.payload.size }));
  if (!Array.isArray(value.media) || canonicalJson(value.media as JsonValue) !== canonicalJson(expectedMedia as JsonValue)) {
    throw new ImportApplyError("manifest_media_mismatch");
  }
  return value as unknown as InspectedLibraryManifest;
}

type ImportResult = {
  runId: string;
  workspaceId: string;
  sourceDigest: string;
  counts: InspectedLibraryManifest["counts"];
  mediaPending: number;
  replayed: boolean;
};

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("npx tsx scripts/studio-import-apply.ts --manifest /absolute/private/manifest.json --workspace UUID --owner-user-id CLERK_ID --expected-sha256 SHA256 --apply");
    return;
  }
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--apply" && !apply) { apply = true; continue; }
    if (!["--manifest", "--workspace", "--owner-user-id", "--expected-sha256"].includes(key) || values.has(key) ||
      !args[index + 1] || args[index + 1].startsWith("--")) throw new ImportApplyError("invalid_arguments");
    values.set(key, args[++index]);
  }
  const manifestPath = values.get("--manifest") ?? "";
  const workspaceId = (values.get("--workspace") ?? "").toLowerCase();
  const ownerUserId = values.get("--owner-user-id") ?? "";
  const expectedSha256 = values.get("--expected-sha256") ?? "";
  if (!apply || values.size !== 4 || !path.isAbsolute(manifestPath) || !uuid.test(workspaceId) ||
    !ownerUserId.trim() || ownerUserId !== ownerUserId.trim() || !digest.test(expectedSha256)) throw new ImportApplyError("invalid_arguments");

  const info = await lstat(manifestPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 250 * 1024 * 1024) throw new ImportApplyError("unsafe_manifest_file");
  const bytes = await readFile(manifestPath);
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) throw new ImportApplyError("manifest_hash_mismatch");
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); } catch { throw new ImportApplyError("manifest_json_invalid"); }
  const manifest = validateImportManifest(parsed);

  // Runtime values are explicit. This CLI intentionally never sources dotenv files.
  if (!hasStudioSupabaseConfig()) throw new ImportApplyError("studio_credentials_missing_or_invalid");
  const config = { projectUrl: process.env.STUDIO_SUPABASE_URL!.trim(), serviceRoleKey: process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY!.trim() };
  await requireStandaloneImportOwner(config, workspaceId, ownerUserId, code => new ImportApplyError(code));
  const result = await requestStudioRest<ImportResult>(config, "rpc/studio_import_library", {
    method: "POST", body: JSON.stringify({ p_workspace_id: workspaceId, p_source_digest: manifest.sourceDigest, p_manifest: manifest, p_owner_clerk_user_id: ownerUserId }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!result || !uuid.test(result.runId) || result.workspaceId !== workspaceId || result.sourceDigest !== manifest.sourceDigest ||
    result.mediaPending !== manifest.counts.files || typeof result.replayed !== "boolean" ||
    canonicalJson(result.counts) !== canonicalJson(manifest.counts)) throw new ImportApplyError("remote_counts_did_not_reconcile");
  console.log(JSON.stringify({ mode: "applied-metadata-only", ...result }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    if (error instanceof StudioRestError) console.error(JSON.stringify({ error: "studio_request_failed", status: error.status, code: error.code }));
    else console.error(JSON.stringify({ error: error instanceof ImportApplyError ? error.code : "import_apply_failed" }));
    process.exitCode = 1;
  });
}
