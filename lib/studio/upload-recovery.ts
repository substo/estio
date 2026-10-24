import { StudioCommandError } from "./command-error";
import { readStudioUploadRequest, type StudioUploadRequest } from "./upload-policy";

const uuid = (value: unknown) => {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new StudioCommandError("Invalid upload or record ID.");
  return value.toLowerCase();
};
export type UploadCommand = { action: "start"; uploadId: string; input: StudioUploadRequest } |
  { action: "recover"; uploadId: string; recordId: string };
export function readUploadCommand(value: unknown): UploadCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StudioCommandError("Invalid upload command.");
  const v = value as Record<string, unknown>;
  const uploadId = uuid(v.uploadId);
  if (v.action === "recover") return { action: "recover", uploadId, recordId: uuid(v.recordId) };
  if (v.action !== "start" || !v.input || typeof v.input !== "object" || Array.isArray(v.input)) throw new StudioCommandError("Invalid upload command.");
  try { return { action: "start", uploadId, input: readStudioUploadRequest(v.input as Parameters<typeof readStudioUploadRequest>[0]) }; }
  catch (error) { throw new StudioCommandError((error as Error).message); }
}
export interface RecoverableUpload {
  id: string; record_id: string; object_key: string; byte_size: number; bucket_id: string; content_type: string;
  original_filename: string; status: string; created_by_clerk_user_id: string; expires_at: string;
}
export type UploadRecoveryResult = { status: "uploaded"; uploadId: string } |
  { status: "ready"; uploadId: string; url: string; headers: Record<string, string> };

/** HEAD before signing or finishing, including after ambiguous PUT/finish responses. No byte overwrite or paid call. */
export async function recoverUpload(upload: RecoverableUpload | null, scope: { userId: string; recordId: string }, deps: {
  bucket: string; now?: number;
  head(key: string): Promise<{ byteSize: number; contentType: string | null } | null>;
  complete(uploadId: string, observedSize: number): Promise<unknown>;
  sign(input: { key: string; contentType: string; byteSize: number }): Promise<string>;
}): Promise<UploadRecoveryResult> {
  if (!upload || upload.record_id !== scope.recordId || upload.created_by_clerk_user_id !== scope.userId || upload.bucket_id !== deps.bucket) {
    throw new StudioCommandError("Upload not found for your account and this record.", 403);
  }
  if (upload.status === "uploaded") return { status: "uploaded", uploadId: upload.id };
  const deadline = Date.parse(upload.expires_at) + 6 * 3600_000;
  if (!Number.isFinite(deadline) || (deps.now ?? Date.now()) >= deadline) throw new StudioCommandError("This upload expired. Start a new upload.", 409);
  const head = await deps.head(upload.object_key);
  if (head) {
    if (head.byteSize !== Number(upload.byte_size) || head.contentType?.toLowerCase() !== upload.content_type) {
      throw new StudioCommandError("The stored file does not match this upload. It cannot be replaced; start a new upload.", 409);
    }
    await deps.complete(upload.id, head.byteSize);
    return { status: "uploaded", uploadId: upload.id };
  }
  return { status: "ready", uploadId: upload.id,
    url: await deps.sign({ key: upload.object_key, contentType: upload.content_type, byteSize: Number(upload.byte_size) }),
    headers: { "Content-Type": upload.content_type, "If-None-Match": "*" } };
}
