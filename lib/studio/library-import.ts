import 'server-only';
import { enqueueLibrarySummary } from './library-summary';
import { readProfileYoutubeConnection } from '../google/profile-youtube-credentials';
import { studioDb } from './studio-db';
import { readLibraryYoutubeMetadata } from './library-import-youtube';
import { auth } from '@clerk/nextjs/server';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import db from '../db';
import { getStudioAccess } from './access';
import { assertStudioMergeReady } from './merge-gate';
import { fetchLibraryImportMetadata, libraryImportTarget, LibraryImportError, validatedYoutubeCreator } from './library-import-metadata';

/** Import returns an existing source without replacing its human edits or imported evidence. */
export async function importStudioLibrary(locationId: string, command: { input: string; platform?: string; idempotencyKey: string; sourceId?: string; sourceVersion?: number }) {
  const access = await getStudioAccess(locationId);
  if (!access || (await auth()).actor) throw new LibraryImportError('Studio access denied.', 403);
  const target = libraryImportTarget(command.input, command.platform);
  if (command.sourceId) {
    const sources = await db.$queryRaw<Array<{payload: Record<string, unknown>}>>`select payload from studio.studio_records where location_id=${access.locationId} and id=${command.sourceId}::uuid and kind='reference'`;
    if (validatedYoutubeCreator(sources[0]?.payload.channelUrl)?.channelUrl !== target.url) throw new LibraryImportError('Creator metadata is unavailable. Reload the source.',409);
  }
  const requestKey = `${access.app}:${access.userId}:${command.idempotencyKey}`;
  const sameSource = (url: string) => { try { return libraryImportTarget(url).url === target.url; } catch { return false; } };
  const finish = async (recordId: string) => {
    try {
      const result = await enqueueLibrarySummary(locationId, recordId) as {summaryStatus?: string} | null;
      return {recordId, summaryStatus: result?.summaryStatus || 'pending'};
    } catch { return {recordId, summaryStatus:'pending', summaryError:'Summary request is pending; retry this import to schedule it.'}; }
  };
  const link = async (tx: Prisma.TransactionClient, channelId: string) => {
    if (!command.sourceId) return;
    const rows = await tx.$queryRaw<Array<{payload: Record<string, unknown>}>>`select payload from studio.studio_records where location_id=${access.locationId} and id=${command.sourceId}::uuid for no key update`;
    if (validatedYoutubeCreator(rows[0]?.payload.channelUrl)?.channelUrl !== target.url) throw new LibraryImportError('Creator metadata changed. Reload.',409);
    const linked = await tx.$queryRaw<Array<{target_id:string}>>`select target_id from studio.studio_record_links where location_id=${access.locationId} and source_id=${command.sourceId}::uuid and target_id=${channelId}::uuid`;
    if (!linked.length) await tx.$queryRaw`select studio.studio_change_record_link(${access.locationId},${command.sourceId}::uuid,${channelId}::uuid,'add',${command.sourceVersion}::bigint,${access.app},${access.userId})`;
  };
  const fence = async (tx: Prisma.TransactionClient) => {
    const members = await tx.$queryRaw<Array<{id:string}>>`select m.id from public."UserLocationRole" m join public."User" u on u.id=m."userId" join public."Location" l on l.id=m."locationId"
      where m."locationId"=${access.locationId} and u."clerkId"=${access.userId} and u."authRealm"::text=${access.app} and l."authRealm"::text=${access.app} for share of m,u,l`;
    if (!members.length) throw new LibraryImportError('Location membership changed. Reload Studio.',403);
    await tx.$queryRaw`select studio.platform_require_active_profile(${access.app},${access.userId})::text`;
  };
  assertStudioMergeReady();
  // Preflight avoids external requests on ordinary retries. The locked check below is authoritative.
  const existing = await db.$queryRaw<Array<{ id: string; url: string; payload?: Record<string, unknown> }>>`select id, payload, payload->>'url' as url from studio.studio_records where location_id=${access.locationId} and kind in ('reference','channel') and payload->'importRequestKeys' ? ${requestKey} limit 1`;
  if (existing[0]) {
    if (!sameSource(String((existing[0].payload?.importRequestSources as Record<string,string> | undefined)?.[requestKey] || existing[0].url))) throw new LibraryImportError('This import key was already used for another source.', 409);
    await db.$transaction(async tx => { await fence(tx); await link(tx, existing[0].id); });
    return finish(existing[0].id);
  }
  const native = await readLibraryYoutubeMetadata(access, target).catch(() => null);
  const metadata = await fetchLibraryImportMetadata(target, undefined, native);
  if (native && (await readProfileYoutubeConnection(studioDb, {brand:access.app,userId:access.userId}))?.version !== native.connectionVersion) throw new LibraryImportError('YouTube connection changed. Retry the import.',409);
  const result = await db.$transaction(async tx => {
    await fence(tx);
    if (native) {
      const connection = await tx.$queryRaw<Array<{version:string}>>`select version from studio.platform_google_youtube_connections where app=${access.app} and clerk_user_id=${access.userId} for share`;
      if (connection[0]?.version !== native.connectionVersion) throw new LibraryImportError('YouTube connection changed. Retry the import.',409);
    }
    // Serialize only short database work, across processes. Network requests never hold a lock.
    await tx.$queryRaw`select pg_advisory_xact_lock(hashtextextended(${`library-import:${access.locationId}`},0))::text`;
    const rows = await tx.$queryRaw<Array<{ id: string; version: number; kind: string; title: string; payload: Record<string, unknown> }>>`
      select id,version,kind,title,payload from studio.studio_records where location_id=${access.locationId} and kind in ('reference','channel')
      and (payload->'importRequestKeys' ? ${requestKey} or (${target.kind === 'channel' ? metadata.payload.channelId ?? null : null}::text is not null and kind='channel' and payload->>'channelId'=${metadata.payload.channelId ?? null}) or source_url=${target.url} or payload->>'url'=${target.url} or (${target.videoId}::text is not null and coalesce(source_url,payload->>'url',payload->>'sourceUrl','') ~ ${target.videoId ? `^https?://(?:(?:www|m)[.])?(?:youtu[.]be/${target.videoId}(?:[?/#]|$)|youtube[.]com/(?:watch[?](?:[^#]*&)?v=${target.videoId}(?:[&#]|$)|(?:shorts|live|embed)/${target.videoId}(?:[?/#]|$)))` : '^$'})) order by (payload->'importRequestKeys' ? ${requestKey}) desc,created_at,id limit 2`;
    const keyed = rows.find(r => Array.isArray(r.payload.importRequestKeys) && r.payload.importRequestKeys.includes(requestKey));
    if (keyed && !sameSource(String((keyed.payload.importRequestSources as Record<string,string> | undefined)?.[requestKey] || keyed.payload.url || ''))) throw new LibraryImportError('This import key was already used for another source.',409);
    const row = keyed ?? rows[0];
    if (keyed) { await link(tx, keyed.id); return { recordId: keyed.id }; }
    const keys = Array.isArray(row?.payload.importRequestKeys) ? row.payload.importRequestKeys.filter(k => typeof k === 'string') : [];
    if (keys.length >= 1000) throw new LibraryImportError('This source has reached its import retry limit.',409);
    const missing = Object.fromEntries(Object.entries(metadata.payload).filter(([key, value]) => ['channelId','channelUrl','thumbnailUrl','channelName','description','summaryStatus','platform','format'].includes(key) && !row?.payload[key] && Boolean(value)));
    if (missing.summaryStatus) missing.summaryStatus = 'pending';
    const priorEvidence = row?.payload.importEvidence;
    const evidence = { ...(priorEvidence && typeof priorEvidence === 'object' ? priorEvidence : priorEvidence === undefined ? {} : { previousEvidence: priorEvidence }), enrichment: metadata.payload.importEvidence, enrichmentStatus: metadata.payload.description ? 'complete' : 'missing_description' };
    const payload = row ? { ...missing, importEvidence: evidence, importRequestKeys: [...keys, requestKey] } : { ...metadata.payload, summaryStatus: 'pending', importEvidence: { ...metadata.payload.importEvidence, enrichmentStatus: metadata.payload.description ? 'complete' : 'missing_description' }, importRequestKeys: [requestKey] };
    const priorSources = row?.payload.importRequestSources;
    Object.assign(payload, {importRequestSources: {...(priorSources && typeof priorSources === 'object' && !Array.isArray(priorSources) ? priorSources : {}), [requestKey]: target.url}});
    const id = row?.id ?? randomUUID();
    await tx.$queryRaw(Prisma.sql`select studio.studio_save_record(${access.locationId},${id}::uuid,${row?.kind ?? metadata.kind},${row?.title ?? metadata.title},${JSON.stringify(payload)}::jsonb,${row?.version ?? 0}::bigint,${access.userId})`);
    await link(tx, id);
    return { recordId: id };
  });
  return finish(result.recordId);
}
