import { requireStandaloneImportOwner } from "../lib/studio/import/apply-target";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalJson as canonicalLibraryJson, normalizeLegacyLibrary, type JsonValue } from "../lib/studio/import/legacy-library";
import { canonicalKnowledgeJson, normalizeLegacyKnowledge, type KnowledgeJson, type LegacyKnowledgeManifest } from "../lib/studio/import/legacy-knowledge";
import { hasStudioSupabaseConfig } from "../lib/studio/recovery/config";
import { queryPath, requestStudioRest, StudioRestError } from "../lib/studio/rest-client";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/;
const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 400 * 1024 * 1024;

class KnowledgeApplyError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "KnowledgeApplyError"; }
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function sameJson(a: unknown, b: unknown): boolean {
  try { return canonicalKnowledgeJson(a as KnowledgeJson) === canonicalKnowledgeJson(b as KnowledgeJson); }
  catch { return false; }
}

export interface KnowledgeApplyManifest extends LegacyKnowledgeManifest {
  mode: "dry-run";
  snapshotCheckedUnchanged: true;
  mediaReconciled: false;
  librarySource: { sourceDigest: string; sourceCanonicalJson: string };
  sourceFiles: Array<{ relativePath: string; bytes: number; sha256: string }>;
}

/** Verify the pinned raw knowledge export and rebuild every normalized projection. */
export function validateKnowledgeApplyManifest(value: unknown): KnowledgeApplyManifest {
  if (!object(value) || value.schema !== "studio.legacy-knowledge.v1" || value.mode !== "dry-run" ||
    value.valid !== true || value.snapshotCheckedUnchanged !== true || value.mediaReconciled !== false ||
    typeof value.sourceCanonicalJson !== "string" || Buffer.byteLength(value.sourceCanonicalJson, "utf8") > MAX_SOURCE_BYTES ||
    typeof value.sourceDigest !== "string" || !digest.test(value.sourceDigest) ||
    !object(value.librarySource) || typeof value.librarySource.sourceDigest !== "string" || !digest.test(value.librarySource.sourceDigest) ||
    typeof value.librarySource.sourceCanonicalJson !== "string" || Buffer.byteLength(value.librarySource.sourceCanonicalJson, "utf8") > MAX_SOURCE_BYTES ||
    !Array.isArray(value.sourceFiles)) throw new KnowledgeApplyError("manifest_not_ready");

  let rawSnapshot: unknown;
  let rawLibrary: unknown;
  try {
    rawSnapshot = JSON.parse(value.sourceCanonicalJson);
    rawLibrary = JSON.parse(value.librarySource.sourceCanonicalJson);
  } catch { throw new KnowledgeApplyError("manifest_source_json_invalid"); }
  if (!object(rawSnapshot) || !Array.isArray(rawSnapshot.topics) || !Array.isArray(rawSnapshot.sources) || !Array.isArray(rawSnapshot.insights) ||
    !Array.isArray(rawSnapshot.evidence) || !Array.isArray(rawSnapshot.reviews) || !Array.isArray(rawSnapshot.sourceUnits) ||
    [rawSnapshot.topics, rawSnapshot.sources, rawSnapshot.insights, rawSnapshot.evidence, rawSnapshot.reviews].some((table) => table.length > 100_000) ||
    rawSnapshot.sourceUnits.length > 10_000) throw new KnowledgeApplyError("manifest_row_limit");
  let rawUnitCount = 0;
  for (const envelope of rawSnapshot.sourceUnits) {
    if (!object(envelope) || !object(envelope.payload) || !Array.isArray(envelope.payload.units)) continue;
    rawUnitCount += envelope.payload.units.length;
    if (rawUnitCount > 250_000) throw new KnowledgeApplyError("manifest_row_limit");
  }
  if ([rawSnapshot.topics, rawSnapshot.sources, rawSnapshot.insights, rawSnapshot.evidence, rawSnapshot.reviews].reduce((sum, table) => sum + table.length, rawUnitCount) > 250_000) {
    throw new KnowledgeApplyError("manifest_row_limit");
  }
  if (canonicalKnowledgeJson(rawSnapshot as KnowledgeJson) !== value.sourceCanonicalJson) throw new KnowledgeApplyError("manifest_source_not_canonical");
  if (createHash("sha256").update(value.sourceCanonicalJson, "utf8").digest("hex") !== value.sourceDigest) throw new KnowledgeApplyError("manifest_source_digest_mismatch");
  if (canonicalLibraryJson(rawLibrary as JsonValue) !== value.librarySource.sourceCanonicalJson) throw new KnowledgeApplyError("manifest_library_source_not_canonical");
  const library = normalizeLegacyLibrary(rawLibrary);
  if (!library.valid || library.sourceDigest !== value.librarySource.sourceDigest) throw new KnowledgeApplyError("manifest_library_source_invalid");
  const recordIds = library.records.map((record) => record.id);
  const normalized = normalizeLegacyKnowledge(rawSnapshot, { recordIds });
  if (!normalized.valid) throw new KnowledgeApplyError("manifest_knowledge_invalid");
  for (const field of ["sourceDigest", "sourceCanonicalJson", "topics", "sources", "insights", "evidence", "reviews", "sourceUnitSidecars", "sourceUnits", "counts", "issues"] as const) {
    if (!sameJson(value[field], normalized[field])) throw new KnowledgeApplyError(`manifest_${field}_mismatch`);
  }
  if (!Array.isArray(value.issues) || value.issues.some((issue) => !object(issue) || issue.severity === "error")) throw new KnowledgeApplyError("manifest_has_errors");

  const files = value.sourceFiles;
  if (files.length > 10_002) throw new KnowledgeApplyError("manifest_source_file_limit");
  const names = new Set<string>();
  for (const file of files) {
    if (!object(file) || typeof file.relativePath !== "string" || typeof file.bytes !== "number" || !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
      typeof file.sha256 !== "string" || !digest.test(file.sha256) || file.relativePath.startsWith("/") || file.relativePath.includes("..") || file.relativePath.includes("\\") || names.has(file.relativePath)) {
      throw new KnowledgeApplyError("manifest_source_file_invalid");
    }
    names.add(file.relativePath);
  }
  if (!names.has("knowledge.sqlite") || !names.has("store.json")) throw new KnowledgeApplyError("manifest_source_files_incomplete");
  return value as unknown as KnowledgeApplyManifest;
}

type ApplyResult = { runId: string; workspaceId: string; sourceDigest: string; counts: LegacyKnowledgeManifest["counts"]; replayed: boolean };

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("npx tsx scripts/studio-knowledge-apply.ts --manifest /absolute/private/knowledge-manifest.json --workspace UUID --owner-user-id CLERK_ID --expected-sha256 SHA256 --apply");
    return;
  }
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--apply" && !apply) { apply = true; continue; }
    if (!["--manifest", "--workspace", "--owner-user-id", "--expected-sha256"].includes(key) || values.has(key) ||
      !args[index + 1] || args[index + 1].startsWith("--")) throw new KnowledgeApplyError("invalid_arguments");
    values.set(key, args[++index]);
  }
  const manifestPath = values.get("--manifest") ?? "";
  const workspaceId = (values.get("--workspace") ?? "").toLowerCase();
  const ownerId = values.get("--owner-user-id") ?? "";
  const expectedSha = values.get("--expected-sha256") ?? "";
  if (!apply || values.size !== 4 || !path.isAbsolute(manifestPath) || !uuid.test(workspaceId) || !ownerId.trim() || ownerId !== ownerId.trim() || !digest.test(expectedSha)) throw new KnowledgeApplyError("invalid_arguments");

  const info = await lstat(manifestPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_MANIFEST_BYTES) throw new KnowledgeApplyError("unsafe_manifest_file");
  const bytes = await readFile(manifestPath);
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha) throw new KnowledgeApplyError("manifest_hash_mismatch");
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); } catch { throw new KnowledgeApplyError("manifest_json_invalid"); }
  const manifest = validateKnowledgeApplyManifest(parsed);

  if (!hasStudioSupabaseConfig()) throw new KnowledgeApplyError("studio_credentials_missing_or_invalid");
  const config = { projectUrl: process.env.STUDIO_SUPABASE_URL!.trim(), serviceRoleKey: process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY!.trim() };
  await requireStandaloneImportOwner(config, workspaceId, ownerId, code => new KnowledgeApplyError(code));
  const libraryRuns = await requestStudioRest<Array<{ source_digest: string }>>(config, queryPath("studio_library_import_runs", {
    select: "source_digest", workspace_id: `eq.${workspaceId}`, source_digest: `eq.${manifest.librarySource.sourceDigest}`, limit: "1",
  }));
  if (libraryRuns.length !== 1 || libraryRuns[0].source_digest !== manifest.librarySource.sourceDigest) throw new KnowledgeApplyError("target_library_snapshot_missing");

  const result = await requestStudioRest<ApplyResult>(config, "rpc/studio_import_knowledge", {
    method: "POST", body: JSON.stringify({ p_workspace_id: workspaceId, p_source_digest: manifest.sourceDigest, p_manifest: manifest, p_owner_clerk_user_id: ownerId }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!result || !uuid.test(result.runId) || result.workspaceId !== workspaceId || result.sourceDigest !== manifest.sourceDigest ||
    typeof result.replayed !== "boolean" || !sameJson(result.counts, manifest.counts)) throw new KnowledgeApplyError("remote_counts_did_not_reconcile");
  console.log(JSON.stringify({ mode: "applied-knowledge-metadata-only", ...result }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    if (error instanceof StudioRestError) console.error(JSON.stringify({ error: "studio_request_failed", status: error.status, code: error.code }));
    else console.error(JSON.stringify({ error: error instanceof KnowledgeApplyError ? error.code : "knowledge_apply_failed" }));
    process.exitCode = 1;
  });
}
