import { fetchPublicPage } from '../web/fetch-public-page';
import { isIP } from 'node:net';

export class LibraryImportError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function libraryImportTarget(input: string, platform?: string) {
  let value = input.trim();
  if (!value || value.length > 2048) throw new LibraryImportError('Paste a public video, post or channel URL.');
  const hint = platform?.toLowerCase();
  const isHandle = value.startsWith('@');
  if (value.startsWith('@')) {
    if (!hint) throw new LibraryImportError('Choose a platform for this handle.');
    const bases: Record<string, string> = { youtube: 'https://www.youtube.com/', instagram: 'https://www.instagram.com/', tiktok: 'https://www.tiktok.com/@', x: 'https://x.com/', facebook: 'https://www.facebook.com/', linkedin: 'https://www.linkedin.com/in/' };
    if (!bases[hint] || !/^@[\w.-]{1,100}$/.test(value)) throw new LibraryImportError('Use a full public channel URL for this platform.');
    value = bases[hint] + (hint === 'youtube' ? value : value.slice(1));
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new LibraryImportError('Enter a full HTTP or HTTPS URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || isIP(url.hostname.replace(/^\[|\]$/g, '')) || !url.hostname.includes('.')) throw new LibraryImportError('Use a public URL without credentials or a custom port.');
  url.hash = '';
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let detected = ({ 'youtube.com': 'youtube', 'm.youtube.com': 'youtube', 'youtu.be': 'youtube', 'instagram.com': 'instagram', 'tiktok.com': 'tiktok', 'x.com': 'x', 'twitter.com': 'x', 'linkedin.com': 'linkedin', 'facebook.com': 'facebook', 'm.facebook.com': 'facebook', 'fb.watch': 'facebook' } as Record<string,string>)[host] ?? 'other';
  if (hint && hint !== detected) throw new LibraryImportError('The selected platform does not match the URL.');
  const format = /\/(shorts)\//.test(url.pathname) ? 'short' : /\/(reel|reels)\//.test(url.pathname) ? 'reel' : detected === 'youtube' || host === 'fb.watch' || detected === 'vimeo' ? 'video' : 'post';
  let videoId: string | null = null;
  if (detected === 'youtube') {
    videoId = host === 'youtu.be' ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)\/?$/)?.[1] ?? null;
    if (videoId && !/^[\w-]{11}$/.test(videoId)) throw new LibraryImportError('This YouTube video URL is invalid.');
    if (videoId) url = new URL(`https://www.youtube.com/watch?v=${videoId}`);
    else {
      if (!/^\/(?:@[\w.-]+|channel\/UC[\w-]{22}|user\/[\w.-]+)\/?$/.test(url.pathname)) throw new LibraryImportError('Paste a specific YouTube video or channel URL.');
      url = new URL(`https://www.youtube.com${url.pathname.replace(/\/$/, '')}`);
    }
  } else {
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|igsh|si$)/i.test(key)) url.searchParams.delete(key);
  }
  const kind = isHandle || detected === 'linkedin' && /^\/(?:in|company)\/[\w.-]+\/?$/.test(url.pathname) || detected === 'facebook' && /^\/[\w.-]+\/?$/.test(url.pathname) && !['watch','reel','reels','posts','videos','groups'].includes(url.pathname.split('/')[1]) || detected === 'youtube' && !videoId || /^\/@?[\w.-]+\/?$/.test(url.pathname) && ['instagram','tiktok','x'].includes(detected) ? 'channel' : 'reference';
  return { url: url.href, platform: detected, kind: kind as 'channel' | 'reference', videoId, format };
}
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
export function safeLibraryThumbnailUrl(value: unknown) {
  if (typeof value !== 'string') return '';
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && !isIP(u.hostname.replace(/^\[|\]$/g, '')) && !/^(localhost|.*\.(local|internal|localhost))$/i.test(u.hostname) && u.hostname.includes('.') && !u.hostname.endsWith('.home.arpa') ? u.href.slice(0,2048) : ''; } catch { return ''; }
}
export async function fetchLibraryImportMetadata(target: ReturnType<typeof libraryImportTarget>, dependencies = { page: fetchPublicPage, fetcher: fetch }, native?: { title: unknown; channelName: unknown; description: unknown; thumbnailUrl: unknown } | null) {
  let title = '', channelName = '', thumbnailUrl = '', description = '';
  const evidence: Record<string, unknown> = { sourceUrl: target.url, fetchedAt: new Date().toISOString(), method: 'public_page' };
  if (native) { title = text(native.title,180); channelName = text(native.channelName,500); description = text(native.description,20000); thumbnailUrl = safeLibraryThumbnailUrl(native.thumbnailUrl); evidence.method = 'youtube_data_api'; evidence.descriptionSource = description ? target.url : null; }
  if (target.videoId && !title) {
    const response = await dependencies.fetcher(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(target.url)}`, { redirect: 'error', signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!response.ok) throw new LibraryImportError('This public YouTube video could not be imported.', 422);
    const reader = response.body?.getReader();
    if (!reader) throw new LibraryImportError('YouTube returned no metadata.', 422);
    let body = ''; let bytes = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 64000) throw new LibraryImportError('Metadata response was too large.', 422); body += new TextDecoder().decode(part.value, { stream: true }); } } finally { await reader.cancel(); }
    const data = JSON.parse(body);
    title = text(data.title, 180); channelName = text(data.author_name, 500); thumbnailUrl = safeLibraryThumbnailUrl(data.thumbnail_url);
    evidence.method = 'youtube_oembed'; evidence.authorUrl = text(data.author_url, 2048);
  }
  try {
    const page = await dependencies.page(target.url, { timeoutMs: 8000, maxBytes: 1024 * 1024, maxRedirects: 3, maxTextChars: 0 });
    title ||= text(page.ogTitle || page.title, 180); description ||= text(page.ogDescription || page.description, 20000); thumbnailUrl ||= safeLibraryThumbnailUrl(page.ogImage);
    evidence.descriptionSource ||= description ? page.finalUrl : null;
  } catch (error) { if (!title) throw new LibraryImportError('Public metadata is unavailable. Check the URL or try again later.', 422); }
  if (!title) throw new LibraryImportError('The source did not provide a title.', 422);
  if (target.kind === 'channel') channelName ||= title;
  return { kind: target.kind, title, payload: { title, url: target.url, platform: target.platform, format: target.kind === 'channel' ? 'channel' : target.format, thumbnailUrl, channelName, description, summaryStatus: 'not_generated', importEvidence: evidence } };
}
