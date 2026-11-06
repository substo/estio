import 'server-only';
import { readProfileYoutubeConnection, readProfileYoutubeAccess } from '../google/profile-youtube-credentials';
import { youtubeChannelTarget } from '../google/youtube-policy';
import { studioDb } from './studio-db';
import type { StudioAccess } from './access';
import type { libraryImportTarget } from './library-import-metadata';

/** Only the signed-in account's existing OAuth connection; no API-key or paid fallback. */
export async function readLibraryYoutubeMetadata(access: StudioAccess, target: ReturnType<typeof libraryImportTarget>) {
  if (target.platform !== 'youtube') return null;
  const principal = { brand: access.app, userId: access.userId };
  if (!await readProfileYoutubeConnection(studioDb, principal)) return null;
  const { token, version } = await readProfileYoutubeAccess(studioDb, principal);
  const url = new URL(`https://www.googleapis.com/youtube/v3/${target.videoId ? 'videos' : 'channels'}`);
  url.search = new URLSearchParams({ part: 'snippet', maxResults: '1', ...(target.videoId ? { id: target.videoId } : youtubeChannelTarget(target.url)) }).toString();
  const slot = await studioDb.call<boolean>('studio_youtube_request_slot', {p_location:access.locationId,p_app:access.app,p_user:access.userId});
  if (!slot) return null;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok || !response.body) return null;
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 256000) return null; parts.push(part.value); } } finally { await reader.cancel(); }
  const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
  const snippet = body?.items?.[0]?.snippet;
  if (typeof snippet?.title !== 'string') return null;
  const channelId = target.videoId ? snippet.channelId : body.items[0].id;
  return { channelUrl: typeof channelId === 'string' && /^UC[\w-]{22}$/.test(channelId) ? `https://www.youtube.com/channel/${channelId}` : undefined, connectionVersion: version, title: snippet.title, channelName: target.videoId ? snippet.channelTitle : snippet.title, description: snippet.description,
    thumbnailUrl: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url };
}
