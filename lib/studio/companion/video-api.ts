import { z } from "zod";
import { deviceCall, type DeviceCallOptions } from "./http-queue";
import type { DeviceCredentials } from "./config";
import type { TranscriptSegment } from "../video-transcription-policy";

export interface VideoLease { jobId: string; workerId: string; leaseToken: string }
export interface FrameDeclaration {
  index: number; timeSeconds: number; sceneStart: number; sceneEnd: number; ocr: string; audioContext: string; selection: string; sha256: string; byteSize: number;
}
export interface ReservedFrame { index: number; status: "pending" | "verified"; uploadUrl?: string }
/** The device endpoints that carry transcript chunks and private frame uploads. Every call is fenced by the job lease on the server. */
export interface VideoDeviceApi {
  chunk(lease: VideoLease, chunkIndex: number, segments: TranscriptSegment[]): Promise<void>;
  reserve(lease: VideoLease, frames: FrameDeclaration[]): Promise<ReservedFrame[]>;
  upload(url: string, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  /** Live status for the Source page; optional so older fakes still work. */
  progress?(lease: VideoLease, progress: { phase: string; percent?: number; detail?: string }): Promise<void>;
  verify(lease: VideoLease, indexes: number[]): Promise<{ requested: number; verified: number; missing: number }>;
}
const reserved = z.array(z.object({ index: z.number().int(), status: z.enum(["pending", "verified"]), uploadUrl: z.string().url().max(4000).optional(), expiresInSeconds: z.number().optional() })).max(40);
const verified = z.object({ requested: z.number().int(), verified: z.number().int(), totalVerified: z.number().int(), missing: z.number().int() });
export function createVideoDeviceApi(credentials: DeviceCredentials, options: DeviceCallOptions = {}): VideoDeviceApi {
  const call = <T>(operation: string, lease: VideoLease, body: Record<string, unknown>, schema: z.ZodType<T>) =>
    deviceCall(credentials.origin, credentials.token, operation, { workerId: lease.workerId, jobId: lease.jobId, leaseToken: lease.leaseToken, ...body }, schema, { ...options, timeoutMs: options.timeoutMs ?? 60_000 });
  return {
    chunk: async (lease, chunkIndex, segments) => { await call("video_transcript_chunk", lease, { chunkIndex, segments }, z.boolean()); },
    progress: async (lease, progress) => { await call("video_progress", lease, progress, z.boolean()); },
    reserve: (lease, frames) => call("video_frames_reserve", lease, { frames }, reserved),
    verify: (lease, indexes) => call("video_frames_verify", lease, { indexes }, verified),
    async upload(url, bytes, signal) {
      // The signed URL is minted by our server for exactly this object; only https, no redirects, bounded size and time.
      const target = new URL(url);
      if (target.protocol !== "https:" || bytes.byteLength > 1_572_864) throw new Error("video_upload_refused");
      const response = await (options.fetcher ?? fetch)(target, { method: "PUT", redirect: "error", headers: { "content-type": "image/jpeg", "if-none-match": "*" }, body: bytes as unknown as BodyInit,
        signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
      if (!response.ok) throw new Error("video_upload_failed");
    },
  };
}
