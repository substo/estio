import "server-only";
import { auth } from "@clerk/nextjs/server";
import { getStudioWorkspaceAccess } from "./access";
import { createStudioR2Store, readStudioR2Config } from "./media-r2";
import { queryPath, studioRest } from "./rest";
import type { StudioUploadRequest } from "./upload-policy";
import { recoverUpload, type RecoverableUpload, type UploadCommand } from "./upload-recovery";
import { StudioCommandError } from "./command-error";

export class StudioUploadError extends StudioCommandError {}

async function requireUploader(workspaceId: string) {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || (await auth()).actor) throw new StudioUploadError("Uploads require your own authorized account.", 403);
  const r2 = readStudioR2Config();
  if (!r2) throw new StudioUploadError("Media storage is not configured on this server yet.", 503);
  return { access, store: createStudioR2Store(r2) };
}

/** Stable client ID makes a lost registration response replayable. SQL checks the exact binding. */
export async function executeStudioUploadCommand(workspaceId: string, command: UploadCommand) {
  const { access, store } = await requireUploader(workspaceId);
  const recordId = command.action === "start" ? command.input.recordId : command.recordId;
  let upload: RecoverableUpload | null;
  if (command.action === "start") {
    const request = command.input;
    upload = await studioRest<RecoverableUpload>("rpc/studio_create_upload", { method: "POST", body: JSON.stringify({
      p_workspace_id: access.workspace.id, p_actor_brand: access.brand, p_clerk_user_id: access.userId, p_upload_id: command.uploadId,
      p_record_id: request.recordId, p_original_filename: request.filename, p_content_type: request.contentType,
      p_byte_size: request.byteSize, p_bucket_id: store.bucket }) });
  } else {
    [upload] = await studioRest<RecoverableUpload[]>(queryPath("studio_uploads", {
      select: "id,record_id,object_key,byte_size,bucket_id,content_type,original_filename,status,created_by_clerk_user_id,expires_at",
      workspace_id: `eq.${access.workspace.id}`, record_id: `eq.${recordId}`, created_by_clerk_user_id: `eq.${access.userId}`,
      id: `eq.${command.uploadId}`, limit: "1" }));
  }
  return recoverUpload(upload ?? null, { userId: access.userId, recordId }, {
    bucket: store.bucket, head: key => store.headObject(key), sign: input => store.presignUpload(input),
    complete: (uploadId, observedSize) => studioRest("rpc/studio_complete_upload", { method: "POST", body: JSON.stringify({
      p_workspace_id: access.workspace.id, p_actor_brand: access.brand, p_clerk_user_id: access.userId,
      p_upload_id: uploadId, p_observed_size: observedSize }) }),
  });
}

/** Old tabs retain compatibility; new uploads use the stable HTTP command route. */
export async function startStudioUpload(workspaceId: string, request: StudioUploadRequest) {
  const { randomUUID } = await import("node:crypto");
  const result = await executeStudioUploadCommand(workspaceId, { action: "start", uploadId: randomUUID(), input: request });
  if (result.status !== "ready") throw new StudioUploadError("Upload already completed.");
  return result;
}
export async function finishStudioUpload(workspaceId: string, uploadId: string) {
  const { access } = await requireUploader(workspaceId);
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) throw new StudioUploadError("Invalid upload.");
  const [upload] = await studioRest<Array<{ record_id: string }>>(queryPath("studio_uploads", {
    select: "record_id", workspace_id: `eq.${access.workspace.id}`, id: `eq.${uploadId}`, limit: "1" }));
  if (!upload) throw new StudioUploadError("Upload not found.");
  const result = await executeStudioUploadCommand(workspaceId, { action: "recover", uploadId, recordId: upload.record_id });
  if (result.status !== "uploaded") throw new StudioUploadError("The file did not reach storage. Recover it from the record page.");
}

export interface PendingStudioUpload { id: string; original_filename: string; content_type: string; byte_size: number; expires_at: string }
/** Durable recovery is scoped to the current uploader, not browser storage or equal email addresses. */
export async function listPendingStudioUploads(workspaceId: string, recordId: string): Promise<PendingStudioUpload[]> {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || (await auth()).actor) return [];
  return studioRest<PendingStudioUpload[]>(queryPath("studio_uploads", {
    select: "id,original_filename,content_type,byte_size,expires_at", workspace_id: `eq.${access.workspace.id}`,
    record_id: `eq.${recordId}`, created_by_clerk_user_id: `eq.${access.userId}`, status: "eq.awaiting_upload",
    // expires_at is the initial hour; completion permits another six hours.
    expires_at: `gt.${new Date(Date.now() - 6 * 3600_000).toISOString()}`, order: "created_at.asc", limit: "100" }));
}

export interface StudioRecordUpload {
  id: string; original_filename: string; content_type: string; byte_size: number; status: string; created_at: string;
  transcription_job_id: string | null; job?: { status: string; attempts: number; max_attempts: number; last_error_message: string | null } | null;
  transcript?: { text: string; duration_seconds: number; model: string } | null;
}

/** Call only after resolving the record inside this authorized workspace. */
export async function listStudioRecordUploads(workspaceId: string, recordId: string): Promise<StudioRecordUpload[]> {
  const uploads = await studioRest<StudioRecordUpload[]>(queryPath("studio_uploads", {
    select: "id,original_filename,content_type,byte_size,status,created_at,transcription_job_id",
    workspace_id: `eq.${workspaceId}`, record_id: `eq.${recordId}`, status: "eq.uploaded", order: "created_at.desc", limit: "20" }));
  if (!uploads.length) return [];
  const ids = uploads.map(u => u.id).join(",");
  const jobIds = uploads.map(u => u.transcription_job_id).filter(Boolean).join(",");
  const [transcripts, jobs] = await Promise.all([
    studioRest<Array<{ upload_id: string; text: string; duration_seconds: number; model: string }>>(queryPath("studio_transcripts", {
      select: "upload_id,text,duration_seconds,model", workspace_id: `eq.${workspaceId}`, upload_id: `in.(${ids})` })),
    jobIds ? studioRest<Array<{ id: string; status: string; attempts: number; max_attempts: number; last_error_message: string | null }>>(queryPath("studio_jobs", {
      select: "id,status,attempts,max_attempts,last_error_message", workspace_id: `eq.${workspaceId}`, id: `in.(${jobIds})` })) : [],
  ]);
  return uploads.map(u => ({ ...u, transcript: transcripts.find(t => t.upload_id === u.id) ?? null, job: jobs.find(j => j.id === u.transcription_job_id) ?? null }));
}
