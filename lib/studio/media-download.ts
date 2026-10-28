import "server-only";
import { getStudioAccess } from "./access";
import { createStudioR2Store, readStudioR2Config } from "./media-r2";
import { studioMediaResponseHeaders } from "./media-policy";
import { Prisma } from "@prisma/client";
import { studioDb } from "./studio-db";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const notFound = () => new Response("Not found", { status: 404, headers: noStore });

/**
 * Authorize the location on the server, resolve the attachment's verified media
 * object inside that location, then redirect to a short-lived private R2 URL.
 * The bucket is never public and the client never supplies a key.
 */
export async function studioMediaRedirectResponse(locationId: string, fileId: string, wantInline: boolean): Promise<Response> {
  const access = await getStudioAccess(locationId);
  if (!access || !uuid.test(fileId)) return notFound();
  const location = access.locationId;
  const file = await studioDb.one<{ media_object_id: string | null }>(Prisma.sql`
    select media_object_id from studio.studio_legacy_files where location_id = ${location} and id = ${fileId}::uuid`);
  if (!file?.media_object_id) return notFound();
  return mediaObjectRedirect(location, file.media_object_id, wantInline);
}

/** Frame image for imported knowledge evidence or a source unit. */
export async function studioKnowledgeMediaRedirectResponse(locationId: string, refKind: string, refId: string): Promise<Response> {
  const access = await getStudioAccess(locationId);
  if (!access || (refKind !== "evidence" && refKind !== "unit") || !uuid.test(refId)) return notFound();
  const location = access.locationId;
  const link = await studioDb.one<{ media_object_id: string | null; status: string }>(Prisma.sql`
    select media_object_id, status from studio.studio_knowledge_media_links
    where location_id = ${location} and ref_kind = ${refKind} and ref_id = ${refId}::uuid`);
  if (link?.status !== "verified" || !link.media_object_id) return notFound();
  return mediaObjectRedirect(location, link.media_object_id, true);
}

/** A customer upload registered through direct-to-R2 intake. */
export async function studioUploadRedirectResponse(locationId: string, uploadId: string, wantInline: boolean): Promise<Response> {
  const access = await getStudioAccess(locationId);
  if (!access || !uuid.test(uploadId)) return notFound();
  const location = access.locationId;
  const upload = await studioDb.one<{ media_object_id: string | null }>(Prisma.sql`
    select media_object_id from studio.studio_uploads
    where location_id = ${location} and id = ${uploadId}::uuid and status = 'uploaded'`);
  if (!upload?.media_object_id) return notFound();
  return mediaObjectRedirect(location, upload.media_object_id, wantInline);
}

/** Call only with a location already authorized for this request. */
async function mediaObjectRedirect(location: string, mediaObjectId: string, wantInline: boolean): Promise<Response> {
  const media = await studioDb.one<{ location_id: string; legacy_key_prefix: string | null; storage_provider: string; bucket_id: string; object_key: string; original_filename: string; content_type: string | null }>(Prisma.sql`
    select location_id, legacy_key_prefix, storage_provider, bucket_id, object_key, original_filename, content_type
    from studio.studio_media_objects where location_id = ${location} and id = ${mediaObjectId}::uuid`);
  if (!media || media.location_id !== location || media.storage_provider !== "cloudflare_r2" || !media.object_key.startsWith(`${media.legacy_key_prefix ?? location}/`)) return notFound();
  const config = readStudioR2Config();
  if (!config || config.bucket !== media.bucket_id) return new Response("Media storage unavailable", { status: 503, headers: noStore });
  const headers = studioMediaResponseHeaders(media.content_type, media.original_filename, wantInline);
  const url = await createStudioR2Store(config).presignRead({ key: media.object_key, contentType: headers.contentType, contentDisposition: headers.contentDisposition });
  return new Response(null, { status: 302, headers: { ...noStore, Location: url } });
}
