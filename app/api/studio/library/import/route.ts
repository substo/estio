import { z } from 'zod';
import { studioRouteParams, withStudioRoute } from '@/lib/studio/route-context';
import { importStudioLibrary } from '@/lib/studio/library-import';
import { LibraryImportError } from '@/lib/studio/library-import-metadata';
import { toStudioDbError } from '@/lib/studio/db';
const schema = z.object({ input: z.string().min(1).max(2048), platform: z.string().max(40).optional(), idempotencyKey: z.string().uuid() }).strict();
export const dynamic = 'force-dynamic';
export const POST = withStudioRoute(async (request, { params }) => {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return Response.json({error:'Use Studio to import sources.'},{status:403});
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
