import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import path from "node:path";
import { canonicalJson, normalizeLegacyLibrary, type ImportIssue, type JsonValue } from "./legacy-library";
import { assertSourceSnapshotUnchanged, hashSourceFile, readSourceSnapshot, sameIdentity, SourceSnapshotError } from "./source-snapshot";

export class MediaPreviewError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "MediaPreviewError"; }
}
const MAX_FILE_BYTES = 64 * 1024 ** 3;
const MAX_BATCH_BYTES = 512 * 1024 ** 3;
export interface MediaPreviewFile {
  id: string; recordId: string; relativePath: string;
  originalFilename: string; contentType: string; expectedBytes: number;
  actualBytes: number | null; sha256: string | null;
  status: "hashed" | "missing" | "unsafe" | "size_mismatch" | "oversized";
}
export interface MediaPreviewManifest {
  schema: "studio.legacy-media.v1"; mode: "dry-run";
  sourceDigest: string;
  librarySource: { sourceDigest: string; sourceCanonicalJson: string };
  sourceFiles: Array<{ relativePath: string; bytes: number; sha256: string }>;
  snapshotCheckedUnchanged: true; sourceBytesVerified: boolean;
  hostedReconciled: false; uploadSupported: false; valid: boolean;
  files: MediaPreviewFile[];
  counts: { files: number; expectedBytes: number; hashedFiles: number; hashedBytes: number };
  issues: ImportIssue[];
}
const statOrMissing = (file: string) => lstat(file, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return null;
  throw error;
});
const unchanged = (before: BigIntStats | null, after: BigIntStats | null) => before === null ? after === null : after !== null && sameIdentity(before, after);

/** Hash only library-referenced bytes. No workspace, network, upload, or database access. */
export async function inspectLegacyMedia(dataDirectory: string, hashFile = hashSourceFile): Promise<MediaPreviewManifest> {
  const dataDir = await realpath(dataDirectory);
  const rootBefore = await lstat(dataDir, { bigint: true });
  if (!rootBefore.isDirectory()) throw new MediaPreviewError("invalid_source_directory");
  const store = await readSourceSnapshot(path.join(dataDir, "store.json"), "store.json", 100 * 1024 * 1024);
  let input: unknown;
  try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(store.bytes)); }
  catch { throw new MediaPreviewError("invalid_library_json"); }
  if (input && typeof input === "object" && "files" in input && Array.isArray(input.files) && input.files.length > 10_000) throw new MediaPreviewError("media_file_limit_exceeded");
  const library = normalizeLegacyLibrary(input);
  const expectedBytes = library.files.reduce((sum, file) => sum + BigInt(file.payload.size as number), BigInt(0));
  if (expectedBytes > BigInt(MAX_BATCH_BYTES)) throw new MediaPreviewError("media_batch_byte_limit_exceeded");
  const filesDir = path.join(dataDir, "files");
  const folderBefore = await statOrMissing(filesDir);
  const unsafeFolder = folderBefore !== null && (!folderBefore.isDirectory() || folderBefore.isSymbolicLink() || await realpath(filesDir) !== filesDir);
  const captured: Array<{ path: string; info: BigIntStats | null }> = [];
  const files: MediaPreviewFile[] = [];
  for (const file of library.files) {
    const absolutePath = path.join(dataDir, file.relativePath);
    const info = unsafeFolder ? null : await statOrMissing(absolutePath);
    if (!unsafeFolder) captured.push({ path: absolutePath, info });
    let status: MediaPreviewFile["status"];
    let sha256: string | null = null;
    if (unsafeFolder) status = "unsafe";
    else if (!info) status = "missing";
    else if (!info.isFile() || info.isSymbolicLink() || await realpath(absolutePath) !== absolutePath) status = "unsafe";
    else if (info.size !== BigInt(file.payload.size as number)) status = "size_mismatch";
    else if (info.size > BigInt(MAX_FILE_BYTES)) status = "oversized";
    else {
      const fingerprint = await hashFile(absolutePath, file.relativePath, MAX_FILE_BYTES);
      if (!sameIdentity(info, fingerprint.identity) || fingerprint.byteSize !== file.payload.size) throw new SourceSnapshotError("source_changed_during_preview");
      status = "hashed"; sha256 = fingerprint.sha256;
    }
    files.push({ id: file.id, recordId: file.recordId, relativePath: file.relativePath,
      originalFilename: file.payload.name as string, contentType: file.payload.type as string, expectedBytes: file.payload.size as number,
      actualBytes: info?.isFile() && info.size <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(info.size) : null, sha256, status });
  }
  await assertSourceSnapshotUnchanged(store);
  for (const file of captured) if (!unchanged(file.info, await statOrMissing(file.path))) throw new SourceSnapshotError("source_changed_during_preview");
  if (!unchanged(folderBefore, await statOrMissing(filesDir)) || !sameIdentity(rootBefore, await lstat(dataDir, { bigint: true }))) throw new SourceSnapshotError("source_changed_during_preview");
  const issues: ImportIssue[] = [...library.issues, ...files.filter(file => file.status !== "hashed").map(file => ({ code: `media_${file.status}`, path: file.relativePath, severity: "error" as const }))];
  issues.sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
  const sourceBytesVerified = files.every(file => file.status === "hashed");
  return { schema: "studio.legacy-media.v1", mode: "dry-run", sourceDigest: createHash("sha256").update(canonicalJson({ librarySourceDigest: library.sourceDigest, files: files as unknown as JsonValue })).digest("hex"),
    librarySource: { sourceDigest: library.sourceDigest, sourceCanonicalJson: library.sourceCanonicalJson },
    sourceFiles: [{ relativePath: "store.json", bytes: store.bytes.length, sha256: store.sha256 }], snapshotCheckedUnchanged: true,
    sourceBytesVerified, hostedReconciled: false, uploadSupported: false, valid: !issues.some(issue => issue.severity === "error"),
    files, counts: { files: files.length, expectedBytes: Number(expectedBytes), hashedFiles: files.filter(file => file.status === "hashed").length,
      hashedBytes: files.reduce((sum, file) => sum + (file.status === "hashed" ? file.actualBytes! : 0), 0) }, issues };
}
