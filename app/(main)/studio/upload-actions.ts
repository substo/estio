"use server";
import { revalidatePath } from "next/cache";
import { readStudioUploadRequest } from "@/lib/studio/upload-policy";
import { finishStudioUpload, startStudioUpload, StudioUploadError } from "@/lib/studio/uploads";

type Started = { ok: true; uploadId: string; url: string; headers: Record<string, string> } | { ok: false; error: string };

export async function startUploadAction(workspaceId: string, input: { recordId: string; filename: string; contentType: string; byteSize: number }): Promise<Started> {
  let request;
  try { request = readStudioUploadRequest(input); } catch (error) { return { ok: false, error: (error as Error).message }; }
  try { return { ok: true, ...await startStudioUpload(workspaceId, request) }; }
  catch (error) { return { ok: false, error: error instanceof StudioUploadError ? error.message : "Could not start the upload. Check your access and try again." }; }
}

export async function finishUploadAction(workspaceId: string, uploadId: string, recordPath: string): Promise<{ ok: boolean; error?: string }> {
  try { await finishStudioUpload(workspaceId, uploadId); }
  catch (error) { return { ok: false, error: error instanceof StudioUploadError ? error.message : "Could not register the upload. Try again." }; }
  if (recordPath.startsWith(`/studio/workspace/${workspaceId}/`)) revalidatePath(recordPath);
  return { ok: true };
}
