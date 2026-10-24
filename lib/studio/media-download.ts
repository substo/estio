import "server-only";
import { getStudioWorkspaceAccess } from "./access";
import { createStudioR2Store, readStudioR2Config } from "./media-r2";
import { studioMediaResponseHeaders } from "./media-policy";
import { queryPath, studioRest } from "./rest";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const notFound = () => new Response("Not found", { status: 404, headers: noStore });

/**
 * Authorize the workspace on the server, resolve the attachment's verified media
 * object inside that workspace, then redirect to a short-lived private R2 URL.
 * The bucket is never public and the client never supplies a key.
 */
export async function studioMediaRedirectResponse(workspaceId: string, fileId: string, wantInline: boolean): Promise<Response> {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || !uuid.test(fileId)) return notFound();
  const workspace = access.workspace.id;
  const [file] = await studioRest<Array<{ media_object_id: string | null }>>(queryPath("studio_legacy_files", {
    select: "media_object_id", workspace_id: `eq.${workspace}`, id: `eq.${fileId.toLowerCase()}`, limit: "1",
  }));
  if (!file?.media_object_id) return notFound();
  return mediaObjectRedirect(workspace, file.media_object_id, wantInline);
}

/** Frame image for imported knowledge evidence or a source unit. */
export async function studioKnowledgeMediaRedirectResponse(workspaceId: string, refKind: string, refId: string): Promise<Response> {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || (refKind !== "evidence" && refKind !== "unit") || !uuid.test(refId)) return notFound();
  const workspace = access.workspace.id;
  const [link] = await studioRest<Array<{ media_object_id: string | null; status: string }>>(queryPath("studio_knowledge_media_links", {
    select: "media_object_id,status", workspace_id: `eq.${workspace}`, ref_kind: `eq.${refKind}`, ref_id: `eq.${refId.toLowerCase()}`, limit: "1",
  }));
  if (link?.status !== "verified" || !link.media_object_id) return notFound();
  return mediaObjectRedirect(workspace, link.media_object_id, true);
}

/** A customer upload registered through direct-to-R2 intake. */
export async function studioUploadRedirectResponse(workspaceId: string, uploadId: string, wantInline: boolean): Promise<Response> {
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || !uuid.test(uploadId)) return notFound();
  const workspace = access.workspace.id;
  const [upload] = await studioRest<Array<{ media_object_id: string | null }>>(queryPath("studio_uploads", {
    select: "media_object_id", workspace_id: `eq.${workspace}`, id: `eq.${uploadId.toLowerCase()}`, status: "eq.uploaded", limit: "1",
  }));
  if (!upload?.media_object_id) return notFound();
  return mediaObjectRedirect(workspace, upload.media_object_id, wantInline);
}

/** Call only with a workspace already authorized for this request. */
async function mediaObjectRedirect(workspace: string, mediaObjectId: string, wantInline: boolean): Promise<Response> {
  const [media] = await studioRest<Array<{ workspace_id: string; storage_provider: string; bucket_id: string; object_key: string; original_filename: string; content_type: string | null }>>(
    queryPath("studio_media_objects", {
      select: "workspace_id,storage_provider,bucket_id,object_key,original_filename,content_type",
      workspace_id: `eq.${workspace}`, id: `eq.${mediaObjectId}`, limit: "1",
    }));
  if (!media || media.workspace_id !== workspace || media.storage_provider !== "cloudflare_r2" || !media.object_key.startsWith(`${workspace}/`)) return notFound();
  const config = readStudioR2Config();
  if (!config || config.bucket !== media.bucket_id) return new Response("Media storage unavailable", { status: 503, headers: noStore });
  const headers = studioMediaResponseHeaders(media.content_type, media.original_filename, wantInline);
  const url = await createStudioR2Store(config).presignRead({ key: media.object_key, contentType: headers.contentType, contentDisposition: headers.contentDisposition });
  return new Response(null, { status: 302, headers: { ...noStore, Location: url } });
}
