import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { requireStandaloneImportOwner } from "../lib/studio/import/apply-target";
import { inspectLegacyMedia, MediaPreviewError, type MediaPreviewManifest } from "../lib/studio/import/inspect-media";
import { canonicalJson, type JsonValue } from "../lib/studio/import/legacy-library";
import { SourceSnapshotError } from "../lib/studio/import/source-snapshot";
import { MediaTransferError, parseMediaUploadArgs, readPinnedManifest, transferPinnedObject } from "../lib/studio/import/media-transfer";
import { hasStudioSupabaseConfig } from "../lib/studio/recovery/config";
import { requestStudioRest, StudioRestError } from "../lib/studio/rest-client";
import { createStudioR2Store, readStudioR2Config, type StudioObjectStore } from "../lib/studio/media-r2";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_FILE_BYTES = 64 * 1024 ** 3;

export class MediaUploadError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "MediaUploadError"; }
}
type Reservation = { fileId: string; bucketId: string; objectKey: string; status: "pending" | "verified"; mediaObjectId: string | null };
type FileOutcome = { fileId: string; result: "already_verified" | "verified" | "pending"; code?: string };

/** The reviewed manifest must equal a fresh rebuild of metadata and byte hashes. */
export async function loadPinnedMediaManifest(manifestPath: string, expectedSha256: string, dataDir: string): Promise<MediaPreviewManifest> {
  const pinned = await readPinnedManifest(manifestPath, expectedSha256);
  const manifest = pinned as MediaPreviewManifest;
  if (!manifest || manifest.schema !== "studio.legacy-media.v1" || manifest.valid !== true || manifest.sourceBytesVerified !== true) throw new MediaUploadError("manifest_not_ready");
  const rebuilt = await inspectLegacyMedia(await realpath(dataDir));
  if (canonicalJson(rebuilt as unknown as JsonValue) !== canonicalJson(pinned as JsonValue)) throw new MediaUploadError("manifest_does_not_match_source");
  return rebuilt;
}

export async function main(args = process.argv.slice(2), objectStore?: StudioObjectStore) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("npx tsx scripts/studio-media-upload.ts --manifest /absolute/private/media-manifest.json --expected-sha256 SHA256 --data-dir /absolute/quiescent-data --workspace UUID --owner-user-id CLERK_ID --apply  (env: STUDIO_SUPABASE_URL, STUDIO_SUPABASE_SERVICE_ROLE_KEY, STUDIO_R2_ACCOUNT_ID, STUDIO_R2_ACCESS_KEY_ID, STUDIO_R2_SECRET_ACCESS_KEY, STUDIO_R2_BUCKET_NAME)");
    return;
  }
  const options = parseMediaUploadArgs(args);
  const dataDir = await realpath(options.dataDir);
  const manifest = await loadPinnedMediaManifest(options.manifestPath, options.expectedSha256, dataDir);

  // Runtime values are explicit. This CLI intentionally never sources dotenv files.
  if (!hasStudioSupabaseConfig()) throw new MediaUploadError("studio_credentials_missing_or_invalid");
  const config = { projectUrl: process.env.STUDIO_SUPABASE_URL!.trim(), serviceRoleKey: process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY!.trim() };
  // Bytes go to the private Studio R2 bucket; Supabase receives metadata only.
  const r2 = readStudioR2Config();
  if (!objectStore && !r2) throw new MediaUploadError("studio_r2_credentials_missing_or_invalid");
  const store = objectStore ?? createStudioR2Store(r2!);
  await requireStandaloneImportOwner(config, options.workspaceId, options.ownerUserId, code => new MediaUploadError(code));
  const reserved = await requestStudioRest<{ workspaceId: string; mediaSourceDigest: string; files: Reservation[] }>(config, "rpc/studio_reserve_legacy_media", {
    method: "POST", signal: AbortSignal.timeout(120_000), body: JSON.stringify({
      p_workspace_id: options.workspaceId, p_owner_clerk_user_id: options.ownerUserId, p_library_source_digest: manifest.librarySource.sourceDigest,
      p_media_source_digest: manifest.sourceDigest, p_bucket_id: store.bucket, p_files: manifest.files.map(file => ({ id: file.id, recordId: file.recordId, sha256: file.sha256,
        byteSize: file.expectedBytes, originalFilename: file.originalFilename, contentType: file.contentType })),
    }),
  });
  if (!reserved || reserved.workspaceId !== options.workspaceId || reserved.mediaSourceDigest !== manifest.sourceDigest ||
    !Array.isArray(reserved.files) || reserved.files.length !== manifest.files.length) throw new MediaUploadError("reservation_did_not_reconcile");

  const outcomes: FileOutcome[] = [];
  for (const [index, file] of manifest.files.entries()) {
    const reservation = reserved.files[index];
    const expectedKey = `${options.workspaceId}/legacy-library/${file.id}/${file.sha256}`;
    if (reservation?.fileId !== file.id || reservation.bucketId !== store.bucket || reservation.objectKey !== expectedKey) throw new MediaUploadError("reservation_did_not_reconcile");
    if (reservation.status === "verified") { outcomes.push({ fileId: file.id, result: "already_verified" }); continue; }
    const outcome = await transferPinnedObject(store, { id: file.id, absolutePath: path.join(dataDir, file.relativePath), relativePath: file.relativePath,
      sha256: file.sha256!, byteSize: file.expectedBytes, contentType: file.contentType, objectKey: expectedKey }, async () => {
      const bound = await requestStudioRest<{ fileId: string; mediaObjectId: string; bucketId: string; objectKey: string }>(config, "rpc/studio_bind_legacy_media", {
        method: "POST", signal: AbortSignal.timeout(60_000), body: JSON.stringify({ p_workspace_id: options.workspaceId,
          p_owner_clerk_user_id: options.ownerUserId, p_file_id: file.id, p_sha256: file.sha256, p_byte_size: file.expectedBytes }),
      });
      if (bound?.fileId !== file.id || bound.objectKey !== expectedKey || bound.bucketId !== store.bucket || !uuid.test(bound.mediaObjectId ?? "")) throw new MediaTransferError("binding_did_not_reconcile");
    }, MAX_FILE_BYTES);
    outcomes.push({ fileId: file.id, result: outcome.result, code: outcome.code });
  }
  const pending = outcomes.filter(outcome => outcome.result === "pending");
  console.log(JSON.stringify({ mode: "media-reconciliation", workspaceId: options.workspaceId, mediaSourceDigest: manifest.sourceDigest,
    counts: { files: outcomes.length, verified: outcomes.filter(o => o.result === "verified").length,
      alreadyVerified: outcomes.filter(o => o.result === "already_verified").length, pending: pending.length },
    hostedReconciled: pending.length === 0, pending: pending.map(({ fileId, code }) => ({ fileId, code })) }));
  if (pending.length) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    if (error instanceof StudioRestError) console.error(JSON.stringify({ error: "studio_request_failed", status: error.status, code: error.code }));
    else console.error(JSON.stringify({ error: error instanceof MediaUploadError || error instanceof MediaTransferError || error instanceof MediaPreviewError || error instanceof SourceSnapshotError ? error.code : "media_upload_failed" }));
    process.exitCode = 1;
  });
}
