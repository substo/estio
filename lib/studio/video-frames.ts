import { VIDEO_LIMITS } from "./video-transcription-policy";

export interface FrameStore {
  bucket: string;
  presignUpload(input: { key: string; contentType: string; byteSize: number }): Promise<string>;
  readDigest(key: string, maximumBytes: number): Promise<{ sha256: string; byteSize: number } | null>;
}
export const FRAME_PRESIGN_SECONDS = 900;
/** reserve: the SQL function validates the lease and the declarations, then each pending frame gets a short-lived signed PUT for exactly its key.
 * verify: SQL lists reserved frames; THIS server reads each back from private R2 and only bytes matching the reserved digest/size are bound as media. */
export async function runVideoFrameOperation(operation: "video_frames_reserve" | "video_frames_verify", call: (observed?: unknown) => Promise<unknown>, store: FrameStore) {
  if (operation === "video_frames_reserve") {
    const reserved = await call() as Array<{ index: number; objectKey: string; status: string; byteSize: number }>;
    return Promise.all(reserved.map(async frame => frame.status === "pending"
      ? { index: frame.index, status: frame.status, uploadUrl: await store.presignUpload({ key: frame.objectKey, contentType: "image/jpeg", byteSize: frame.byteSize }), expiresInSeconds: FRAME_PRESIGN_SECONDS }
      : { index: frame.index, status: frame.status }));
  }
  const pending = await call() as Array<{ index: number; objectKey: string; sha256: string; byteSize: number }>;
  const observed: Array<{ index: number; sha256: string; byteSize: number }> = [];
  for (const frame of pending) {
    const digest = await store.readDigest(frame.objectKey, VIDEO_LIMITS.maxFrameBytes).catch(() => null);
    if (digest && digest.sha256 === frame.sha256 && digest.byteSize === frame.byteSize) observed.push({ index: frame.index, sha256: digest.sha256, byteSize: digest.byteSize });
  }
  const totalVerified = observed.length ? await call({ bucket: store.bucket, frames: observed }) : 0;
  return { requested: pending.length, verified: observed.length, totalVerified, missing: pending.length - observed.length };
}
