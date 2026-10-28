import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { requireStandaloneImportOwner } from "../lib/studio/import/apply-target";
import { KnowledgePreviewError } from "../lib/studio/import/inspect-knowledge";
import { inspectLegacyKnowledgeMedia, type KnowledgeMediaManifest } from "../lib/studio/import/inspect-knowledge-media";
import { canonicalKnowledgeJson, type KnowledgeJson } from "../lib/studio/import/legacy-knowledge";
import { MediaTransferError, parseMediaUploadArgs, readPinnedManifest, transferPinnedObject } from "../lib/studio/import/media-transfer";
import { SourceSnapshotError } from "../lib/studio/import/source-snapshot";
import { hasStudioSupabaseConfig } from "../lib/studio/recovery/config";
import { createStudioR2Store, readStudioR2Config, type StudioObjectStore } from "../lib/studio/media-r2";
import { requestStudioRest, StudioRestError } from "../lib/studio/rest-client";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_FRAME_BYTES = 50 * 1024 * 1024;
type Reservation = { refKind: string; refId: string; bucketId: string; objectKey: string; status: "pending" | "verified" };

/** The reviewed frame manifest must equal a fresh rebuild from the source data. */
export async function loadPinnedKnowledgeMediaManifest(manifestPath: string, expectedSha256: string, dataDir: string): Promise<KnowledgeMediaManifest> {
  const pinned = await readPinnedManifest(manifestPath, expectedSha256) as KnowledgeMediaManifest;
  if (!pinned || pinned.schema !== "studio.legacy-knowledge-media.v1" || pinned.valid !== true) throw new MediaTransferError("manifest_not_ready");
  const rebuilt = await inspectLegacyKnowledgeMedia(await realpath(dataDir));
  if (canonicalKnowledgeJson(rebuilt as unknown as KnowledgeJson) !== canonicalKnowledgeJson(pinned as unknown as KnowledgeJson)) throw new MediaTransferError("manifest_does_not_match_source");
  return rebuilt;
}

export async function main(args = process.argv.slice(2), objectStore?: StudioObjectStore) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("npx tsx scripts/studio-knowledge-media-upload.ts --manifest /absolute/private/knowledge-media-manifest.json --expected-sha256 SHA256 --data-dir /absolute/quiescent-data --workspace UUID --owner-user-id CLERK_ID --apply  (env: STUDIO_SUPABASE_*, STUDIO_R2_*)");
    return;
  }
  const options = parseMediaUploadArgs(args);
  const dataDir = await realpath(options.dataDir);
  const manifest = await loadPinnedKnowledgeMediaManifest(options.manifestPath, options.expectedSha256, dataDir);
  // Frames already absent locally cannot be uploaded; they are reported, not retried.
  const uploadable = manifest.references.filter(ref => ref.status === "hashed");

  if (!hasStudioSupabaseConfig()) throw new MediaTransferError("studio_credentials_missing_or_invalid");
  const config = { projectUrl: process.env.STUDIO_SUPABASE_URL!.trim(), serviceRoleKey: process.env.STUDIO_SUPABASE_SERVICE_ROLE_KEY!.trim() };
  const r2 = readStudioR2Config();
  if (!objectStore && !r2) throw new MediaTransferError("studio_r2_credentials_missing_or_invalid");
  const store = objectStore ?? createStudioR2Store(r2!);
  await requireStandaloneImportOwner(config, options.workspaceId, options.ownerUserId, code => new MediaTransferError(code));
  const reserved = await requestStudioRest<{ workspaceId: string; mediaSourceDigest: string; references: Reservation[] }>(config, "rpc/studio_reserve_knowledge_media", {
    method: "POST", signal: AbortSignal.timeout(120_000), body: JSON.stringify({
      p_workspace_id: options.workspaceId, p_owner_clerk_user_id: options.ownerUserId, p_knowledge_source_digest: manifest.knowledgeSourceDigest,
      p_media_source_digest: manifest.sourceDigest, p_bucket_id: store.bucket,
      p_refs: uploadable.map(ref => ({ refKind: ref.refKind, refId: ref.refId, frameFile: ref.frameFile, sha256: ref.sha256, byteSize: ref.byteSize, contentType: ref.contentType })),
    }),
  });
  if (!reserved || reserved.workspaceId !== options.workspaceId || reserved.mediaSourceDigest !== manifest.sourceDigest ||
    !Array.isArray(reserved.references) || reserved.references.length !== uploadable.length) throw new MediaTransferError("reservation_did_not_reconcile");

  const outcomes: Array<{ ref: string; result: "already_verified" | "verified" | "pending"; code?: string }> = [];
  for (const [index, ref] of uploadable.entries()) {
    const reservation = reserved.references[index];
    const objectKey = `${options.workspaceId}/legacy-knowledge/${ref.refKind}/${ref.refId}/${ref.sha256}`;
    if (reservation?.refKind !== ref.refKind || reservation.refId !== ref.refId || reservation.bucketId !== store.bucket || reservation.objectKey !== objectKey) throw new MediaTransferError("reservation_did_not_reconcile");
    const label = `${ref.refKind}:${ref.refId}`;
    if (reservation.status === "verified") { outcomes.push({ ref: label, result: "already_verified" }); continue; }
    const outcome = await transferPinnedObject(store, { id: label, absolutePath: path.join(dataDir, ref.relativePath!), relativePath: ref.relativePath!,
      sha256: ref.sha256!, byteSize: ref.byteSize!, contentType: ref.contentType!, objectKey }, async () => {
      const bound = await requestStudioRest<{ refKind: string; refId: string; mediaObjectId: string; bucketId: string; objectKey: string }>(config, "rpc/studio_bind_knowledge_media", {
        method: "POST", signal: AbortSignal.timeout(60_000), body: JSON.stringify({ p_workspace_id: options.workspaceId, p_owner_clerk_user_id: options.ownerUserId,
          p_ref_kind: ref.refKind, p_ref_id: ref.refId, p_sha256: ref.sha256, p_byte_size: ref.byteSize }),
      });
      if (bound?.refId !== ref.refId || bound.refKind !== ref.refKind || bound.objectKey !== objectKey || bound.bucketId !== store.bucket || !uuid.test(bound.mediaObjectId ?? "")) throw new MediaTransferError("binding_did_not_reconcile");
    }, MAX_FRAME_BYTES);
    outcomes.push({ ref: label, result: outcome.result, code: outcome.code });
  }
  const pending = outcomes.filter(o => o.result === "pending");
  console.log(JSON.stringify({ mode: "knowledge-media-reconciliation", workspaceId: options.workspaceId, mediaSourceDigest: manifest.sourceDigest,
    counts: { references: manifest.references.length, unavailableInSource: manifest.references.length - uploadable.length,
      verified: outcomes.filter(o => o.result === "verified").length, alreadyVerified: outcomes.filter(o => o.result === "already_verified").length, pending: pending.length },
    hostedReconciled: pending.length === 0, pending: pending.map(({ ref, code }) => ({ ref, code })) }));
  if (pending.length) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    if (error instanceof StudioRestError) console.error(JSON.stringify({ error: "studio_request_failed", status: error.status, code: error.code }));
    else console.error(JSON.stringify({ error: error instanceof MediaTransferError || error instanceof KnowledgePreviewError || error instanceof SourceSnapshotError ? error.code : "knowledge_media_upload_failed" }));
    process.exitCode = 1;
  });
}
