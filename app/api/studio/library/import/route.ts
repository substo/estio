import { isAllowedRequestOrigin } from "@/lib/auth/request-origin-policy";
import { z } from 'zod';
import { studioRouteParams, withStudioRoute } from '@/lib/studio/route-context';
import { importStudioLibrary } from '@/lib/studio/library-import';
import { LibraryImportError } from '@/lib/studio/library-import-metadata';
import { toStudioDbError } from '@/lib/studio/db';
const schema = z.object({ input: z.string().min(1).max(2048), platform: z.string().max(40).optional(), sourceId: z.string().uuid().optional(), sourceVersion: z.number().int().nonnegative().optional(), idempotencyKey: z.string().uuid() }).strict().refine(value => Boolean(value.sourceId) === (value.sourceVersion !== undefined));
export const dynamic = 'force-dynamic';
export const POST = withStudioRoute(async (request, { params }) => {
  const origin = request.headers.get('origin');
  const requestOrigin = new URL(request.url).origin;
  // Browser mutations require a serialized Origin. The shared policy understands
  // Caddy's forwarded public host/protocol without trusting arbitrary origins.
  if (!origin || request.headers.get('sec-fetch-site') === 'cross-site' ||
      !/^https?:\/\//.test(origin) || (() => { try { return new URL(origin).origin !== origin; } catch { return true; } })() ||
      !isAllowedRequestOrigin({ origin, requestOrigin, appUrl: requestOrigin,
        host: request.headers.get('host'), forwardedHost: request.headers.get('x-forwarded-host'),
        forwardedProto: request.headers.get('x-forwarded-proto') })) {
    return Response.json({error:'Source import was blocked because the request origin could not be verified. Reload Studio and try again.'},{status:403,headers:{'Cache-Control':'no-store'}});
  }
  const { locationId } = await studioRouteParams(params, request);
  const respond = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
  // Bound the request before parsing, including chunked requests.
  const reader = request.body?.getReader();
  if (!reader) return respond({ error: 'Enter a source to import.' },400);
  let bytes = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 8192) { await reader.cancel(); return respond({error:'Import request is too large.'},413); } chunks.push(part.value); }
    const parsed = schema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!parsed.success) return respond({error:'Check the source and import request key.'},400);
    return respond(await importStudioLibrary(locationId, parsed.data));
  } catch (error) {
    if (error instanceof SyntaxError) return respond({error:'Invalid import request.'},400);
    if (error instanceof LibraryImportError) return respond({error:error.message},error.status);
    const failure = toStudioDbError(error);
    return respond({error:failure.status === 409 ? 'The record changed. Retry the import.' : 'Import could not complete. Try again later.'}, failure.status === 409 ? 409 : 503);
  }
});
