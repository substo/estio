import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { StudioMediaStoreError, type StudioObjectStore } from "../media-r2";
import { StudioRestError } from "../rest-client";
import { hashSourceFile, SourceSnapshotError } from "./source-snapshot";

export class MediaTransferError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "MediaTransferError"; }
}
export interface PinnedObject { id: string; absolutePath: string; relativePath: string; sha256: string; byteSize: number; contentType: string; objectKey: string }
export type TransferOutcome = { id: string; result: "verified" | "pending"; code?: string };

/**
 * Upload one reviewed object to R2 if absent, read it back, and only then call
 * `bind`. Every failure leaves the item pending for a safe rerun; existing
 * objects are never overwritten.
 */
export async function transferPinnedObject(store: StudioObjectStore, item: PinnedObject, bind: () => Promise<void>, maxSourceBytes: number): Promise<TransferOutcome> {
  try {
    let stored = await store.readDigest(item.objectKey, item.byteSize);
    if (!stored) {
      const source = await hashSourceFile(item.absolutePath, item.relativePath, maxSourceBytes);
      if (source.sha256 !== item.sha256 || source.byteSize !== item.byteSize) throw new MediaTransferError("source_changed_since_review");
      await store.uploadCreateOnly({ key: item.objectKey, filePath: source.absolutePath, byteSize: item.byteSize, contentType: item.contentType });
      stored = await store.readDigest(item.objectKey, item.byteSize);
    }
    // Never trust upload success alone; bind only bytes read back from storage.
    if (!stored || stored.sha256 !== item.sha256 || stored.byteSize !== item.byteSize) throw new MediaTransferError("stored_bytes_mismatch");
    await bind();
    return { id: item.id, result: "verified" };
  } catch (error) {
    const code = error instanceof MediaTransferError || error instanceof StudioMediaStoreError || error instanceof SourceSnapshotError ? error.code
      : error instanceof StudioRestError ? `studio_request_failed_${error.status}` : "media_transfer_failed";
    return { id: item.id, result: "pending", code };
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;

export function parseMediaUploadArgs(args: string[]) {
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--apply" && !apply) { apply = true; continue; }
    if (!["--manifest", "--expected-sha256", "--data-dir", "--workspace", "--owner-user-id"].includes(key) || values.has(key) ||
      !args[index + 1] || args[index + 1].startsWith("--")) throw new MediaTransferError("invalid_arguments");
    values.set(key, args[++index]);
  }
  const options = { manifestPath: values.get("--manifest") ?? "", expectedSha256: values.get("--expected-sha256") ?? "", dataDir: values.get("--data-dir") ?? "",
    workspaceId: (values.get("--workspace") ?? "").toLowerCase(), ownerUserId: values.get("--owner-user-id") ?? "" };
  if (!apply || values.size !== 5 || !path.isAbsolute(options.manifestPath) || !path.isAbsolute(options.dataDir) || !digest.test(options.expectedSha256) ||
    !uuid.test(options.workspaceId) || !options.ownerUserId.trim() || options.ownerUserId !== options.ownerUserId.trim()) throw new MediaTransferError("invalid_arguments");
  return options;
}

/** Pinned manifest bytes: the exact reviewed file, checked before parsing. */
export async function readPinnedManifest(manifestPath: string, expectedSha256: string): Promise<unknown> {
  const info = await lstat(manifestPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 250 * 1024 * 1024) throw new MediaTransferError("unsafe_manifest_file");
  const bytes = await readFile(manifestPath);
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) throw new MediaTransferError("manifest_hash_mismatch");
  try { return JSON.parse(bytes.toString("utf8")); } catch { throw new MediaTransferError("manifest_json_invalid"); }
}
