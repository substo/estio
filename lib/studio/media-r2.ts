import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, GetObjectCommand,
  HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client, UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Studio media bytes live in a dedicated private Cloudflare R2 bucket (S3 API).
 * Supabase holds metadata only. Cloudflare Images is not used for private
 * Studio media because its delivery URLs are not workspace-authorized.
 */
export const R2_BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const SINGLE_PUT_MAX_BYTES = 64 * 1024 * 1024;
export const MULTIPART_PART_BYTES = 16 * 1024 * 1024;
export const PRESIGNED_READ_SECONDS = 300;
export const PRESIGNED_UPLOAD_SECONDS = 900;

export class StudioMediaStoreError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "StudioMediaStoreError"; }
}
export interface StudioR2Config { endpoint: string; accessKeyId: string; secretAccessKey: string; bucket: string }

/** Studio uses its own bucket and keys, never the WhatsApp media bucket. */
export function readStudioR2Config(env: Record<string, string | undefined> = process.env): StudioR2Config | null {
  const accountId = env.STUDIO_R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.STUDIO_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.STUDIO_R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.STUDIO_R2_BUCKET_NAME?.trim();
  const endpoint = env.STUDIO_R2_ENDPOINT?.trim() || (accountId && /^[0-9a-f]{32}$/.test(accountId) ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  if (!accessKeyId || !secretAccessKey || !bucket || !R2_BUCKET_PATTERN.test(bucket) || !endpoint) return null;
  try { if (new URL(endpoint).protocol !== "https:") return null; } catch { return null; }
  return { endpoint, accessKeyId, secretAccessKey, bucket };
}

type Sender = { send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<any> };
export interface StudioObjectStore {
  bucket: string;
  readDigest(key: string, maximumBytes: number): Promise<{ sha256: string; byteSize: number } | null>;
  uploadCreateOnly(input: { key: string; filePath: string; byteSize: number; contentType: string }): Promise<void>;
  presignRead(input: { key: string; contentType: string; contentDisposition: string }): Promise<string>;
}

/** The real R2 store adds browser-upload signing and metadata reads. */
export interface StudioR2Store extends StudioObjectStore {
  checkBucket(signal?: AbortSignal): Promise<void>;
  presignUpload(input: { key: string; contentType: string; byteSize: number }): Promise<string>;
  headObject(key: string): Promise<{ byteSize: number; contentType: string | null } | null>;
  presignWorkerRead(key: string, seconds?: number): Promise<string>;
}

const statusOf = (error: unknown) => (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
const nameOf = (error: unknown) => (error as { name?: string })?.name;

export function createStudioR2Store(config: StudioR2Config, client?: Sender, maxPartRetries = 3): StudioR2Store {
  // Presigning is local computation, so it always uses a real client. Default SDK
  // checksums would sign an empty-body CRC32 into browser PUT URLs, so R2 would reject real bytes.
  const signer = new S3Client({ region: "auto", endpoint: config.endpoint, forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
  const s3: Sender = client ?? signer;
  const Bucket = config.bucket;

  async function readDigest(key: string, maximumBytes: number) {
    let response: { Body?: AsyncIterable<Uint8Array> };
    try { response = await s3.send(new GetObjectCommand({ Bucket, Key: key })); }
    catch (error) {
      if (nameOf(error) === "NoSuchKey" || statusOf(error) === 404) return null;
      throw new StudioMediaStoreError("stored_object_read_failed");
    }
    if (!response.Body) throw new StudioMediaStoreError("stored_object_read_failed");
    const hash = createHash("sha256");
    let byteSize = 0;
    for await (const chunk of response.Body) {
      byteSize += chunk.byteLength;
      if (byteSize > maximumBytes) throw new StudioMediaStoreError("stored_object_larger_than_expected");
      hash.update(chunk);
    }
    return { sha256: hash.digest("hex"), byteSize };
  }

  async function uploadCreateOnly(input: { key: string; filePath: string; byteSize: number; contentType: string }) {
    const ContentType = input.contentType || "application/octet-stream";
    const handle = await open(input.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const readExact = async (offset: number, length: number) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (bytesRead !== length) throw new StudioMediaStoreError("source_changed_during_upload");
      return buffer;
    };
    const created = (error: unknown) => {
      if (statusOf(error) === 412 || nameOf(error) === "PreconditionFailed") throw new StudioMediaStoreError("stored_object_already_exists");
      throw error instanceof StudioMediaStoreError ? error : new StudioMediaStoreError("upload_failed");
    };
    try {
      if (input.byteSize <= SINGLE_PUT_MAX_BYTES) {
        // If-None-Match: * makes R2 reject the write if any object has this key.
        await s3.send(new PutObjectCommand({ Bucket, Key: input.key, Body: await readExact(0, input.byteSize), ContentType,
          ContentLength: input.byteSize, IfNoneMatch: "*" })).catch(created);
        return;
      }
      const { UploadId } = await s3.send(new CreateMultipartUploadCommand({ Bucket, Key: input.key, ContentType })).catch(created);
      if (!UploadId) throw new StudioMediaStoreError("upload_failed");
      try {
        const parts: Array<{ ETag: string; PartNumber: number }> = [];
        for (let offset = 0, PartNumber = 1; offset < input.byteSize; offset += MULTIPART_PART_BYTES, PartNumber++) {
          const body = await readExact(offset, Math.min(MULTIPART_PART_BYTES, input.byteSize - offset));
          for (let attempt = 0; ; attempt++) {
            try {
              const { ETag } = await s3.send(new UploadPartCommand({ Bucket, Key: input.key, UploadId, PartNumber, Body: body, ContentLength: body.length }));
              if (!ETag) throw new StudioMediaStoreError("upload_failed");
              parts.push({ ETag, PartNumber });
              break;
            } catch {
              if (attempt >= maxPartRetries) throw new StudioMediaStoreError("upload_part_failed");
            }
          }
        }
        await s3.send(new CompleteMultipartUploadCommand({ Bucket, Key: input.key, UploadId, MultipartUpload: { Parts: parts }, IfNoneMatch: "*" })).catch(created);
      } catch (error) {
        // Abort only this incomplete upload; it never removes a completed object.
        await s3.send(new AbortMultipartUploadCommand({ Bucket, Key: input.key, UploadId })).catch(() => undefined);
        throw error;
      }
    } finally { await handle.close(); }
  }

  async function presignRead(input: { key: string; contentType: string; contentDisposition: string }) {
    return getSignedUrl(signer, new GetObjectCommand({ Bucket, Key: input.key,
      ResponseContentType: input.contentType, ResponseContentDisposition: input.contentDisposition, ResponseCacheControl: "private, no-store" }),
    { expiresIn: PRESIGNED_READ_SECONDS });
  }

  /** Browser upload URL. Size and type are signed, so the client cannot change them. */
  async function presignUpload(input: { key: string; contentType: string; byteSize: number }) {
    return getSignedUrl(signer, new PutObjectCommand({ Bucket, Key: input.key, ContentType: input.contentType, ContentLength: input.byteSize, IfNoneMatch: "*" }),
      { expiresIn: PRESIGNED_UPLOAD_SECONDS, signableHeaders: new Set(["content-type", "content-length", "if-none-match"]) });
  }

  async function headObject(key: string): Promise<{ byteSize: number; contentType: string | null } | null> {
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
      return { byteSize: Number(head.ContentLength), contentType: head.ContentType ?? null };
    } catch (error) {
      if (nameOf(error) === "NotFound" || nameOf(error) === "NoSuchKey" || statusOf(error) === 404) return null;
      throw new StudioMediaStoreError("stored_object_read_failed");
    }
  }

  /** Long-lived read for the worker's ffmpeg input; never given to a browser. */
  async function presignWorkerRead(key: string, seconds = 6 * 3600) {
    return getSignedUrl(signer, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: seconds });
  }

  async function checkBucket(signal?: AbortSignal) {
    try { await s3.send(new HeadBucketCommand({ Bucket }), { abortSignal: signal ?? AbortSignal.timeout(10_000) }); }
    catch { throw new StudioMediaStoreError("media_bucket_unavailable"); }
  }

  return { checkBucket, bucket: Bucket, readDigest, uploadCreateOnly, presignRead, presignUpload, headObject, presignWorkerRead };
}
