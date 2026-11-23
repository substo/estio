import { StudioCommandError } from "./command-error";

export const EXPORT_PRESIGN_SECONDS = 3600;
export interface ExportStore { bucket: string; presignUpload(input: { key: string; contentType: string; byteSize: number }): Promise<string>; readDigest(key: string, maximumBytes: number): Promise<{ sha256: string; byteSize: number } | null> }
/** reserve: SQL fences the lease and fixes the key; this adds the signed PUT. verify: SQL names the reserved bytes; THIS server reads them back from private R2 and only matching bytes become a saved upload. */
export async function runExportOperation(operation: "video_export_reserve" | "video_export_verify", call: (observed?: unknown) => Promise<unknown>, store: ExportStore) {
  if (operation === "video_export_reserve") {
    const r = await call({ bucket: store.bucket }) as { uploadId: string; objectKey: string; byteSize: number; state: string };
    if (r.state === "verified") return { uploadId: r.uploadId, state: r.state };
    return { uploadId: r.uploadId, state: r.state, uploadUrl: await store.presignUpload({ key: r.objectKey, contentType: "video/mp4", byteSize: r.byteSize }), expiresInSeconds: EXPORT_PRESIGN_SECONDS };
  }
  const reserved = await call() as { objectKey: string; sha256: string; byteSize: number; state: string };
  if (reserved.state === "verified") return await call({ bucket: store.bucket, sha256: reserved.sha256, byteSize: reserved.byteSize });
  const digest = await store.readDigest(reserved.objectKey, 5_368_709_120 + 1024).catch(() => null);
  if (!digest || digest.sha256 !== reserved.sha256 || digest.byteSize !== reserved.byteSize) throw new StudioCommandError("The uploaded video does not match what the Mac declared.", 409);
  return call({ bucket: store.bucket, sha256: digest.sha256, byteSize: digest.byteSize });
}
