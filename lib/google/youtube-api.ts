import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { youtubeChannelTarget, YOUTUBE_SCOPE } from "./youtube-policy";
export class YoutubeError extends Error { constructor(public code: string, message: string) { super(message); } }
export type GoogleClient = { clientId: string; clientSecret: string };
export function newYoutubeOAuth(client: GoogleClient, redirectUri: string) {
  const state = randomBytes(32).toString("base64url"); const verifier = randomBytes(32).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: client.clientId, redirect_uri: redirectUri, response_type: "code", scope: YOUTUBE_SCOPE,
    access_type: "offline", prompt: "consent", state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  return { state, verifier, url: url.href };
}
export const stateHash = (state: string) => createHash("sha256").update(state).digest("hex");
export function equalOAuthState(a: string, b: string) { return timingSafeEqual(Buffer.from(stateHash(a), "hex"), Buffer.from(stateHash(b), "hex")); }
async function tokens(client: GoogleClient, fields: Record<string, string>, fetcher: typeof fetch) {
  let response: Response;
  try { response = await fetcher("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, ...fields }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) }); }
  catch { throw new YoutubeError("google_unavailable", "Google could not be reached. Try again shortly."); }
  if (!response.ok) throw new YoutubeError(response.status === 400 || response.status === 401 ? "google_reconnect" : "google_unavailable", response.status < 500 ? "Reconnect YouTube to renew consent." : "Google is temporarily unavailable.");
  const value = await response.json() as Record<string, unknown>;
  if (typeof value.access_token !== "string" || !value.access_token || value.access_token.length > 8192) throw new YoutubeError("google_response_invalid", "Google returned an incomplete token response.");
  return value as Record<string, unknown> & { access_token: string };
}
export async function exchangeYoutubeCode(client: GoogleClient, code: string, verifier: string, redirectUri: string, fetcher: typeof fetch = fetch) {
  const value = await tokens(client, { code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: "authorization_code" }, fetcher);
  if (typeof value.scope !== "string" || !value.scope.split(" ").includes(YOUTUBE_SCOPE) || typeof value.refresh_token !== "string" || !value.refresh_token || value.refresh_token.length > 8192)
    throw new YoutubeError("youtube_consent_missing", "YouTube read access and offline consent are required. Connect again and grant read access.");
  return { refreshToken: value.refresh_token, scopes: value.scope.split(" ").filter(Boolean) };
}
export async function refreshYoutubeAccess(client: GoogleClient, refreshToken: string, fetcher: typeof fetch = fetch) {
  return (await tokens(client, { refresh_token: refreshToken, grant_type: "refresh_token" }, fetcher)).access_token;
}
export async function revokeYoutubeToken(token: string, fetcher: typeof fetch = fetch) {
  try { await fetcher("https://oauth2.googleapis.com/revoke", { method: "POST", body: new URLSearchParams({ token }), redirect: "error", signal: AbortSignal.timeout(10_000) }); } catch { /* Local deletion must still succeed when Google is offline. */ }
}
export interface YoutubeAuth { accessToken?: string; apiKey?: string; }
export interface YoutubeVideo { id: string; title: string; channelId: string; channelTitle: string; publishedAt: string; }
export interface YoutubeChannel { id: string; title: string; }
export function createYoutubeApi(auth: YoutubeAuth, fetcher: typeof fetch = fetch) {
  async function get(resource: string, params: Record<string, string>) {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    url.search = new URLSearchParams({ ...params, ...(auth.accessToken ? {} : { key: auth.apiKey ?? "" }) }).toString();
    let response: Response;
    try { response = await fetcher(url, { headers: auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) }); }
    catch { throw new YoutubeError("youtube_unavailable", "YouTube could not be reached. Try again shortly."); }
    if (!response.ok) throw new YoutubeError(response.status === 401 ? "google_reconnect" : response.status === 403 || response.status === 429 ? "youtube_quota_or_permission" : "youtube_unavailable",
      response.status === 403 || response.status === 429 ? "YouTube refused this request. Check API access and quota, or try later." : "YouTube is unavailable or needs renewed consent.");
    const body = await response.json();
    if (!body || !Array.isArray(body.items) || body.items.length > 50) throw new YoutubeError("youtube_response_invalid", "YouTube returned an invalid result.");
    return body as { items: any[]; nextPageToken?: string };
  }
  async function videos(ids: string[]): Promise<YoutubeVideo[]> {
    if (!ids.length) return [];
    const body = await get("videos", { part: "snippet,status", id: ids.slice(0, 20).join(","), maxResults: "20" });
    return body.items.filter(v => v && ids.includes(v.id) && /^[A-Za-z0-9_-]{11}$/.test(v.id) && v.status?.privacyStatus === "public" && typeof v.snippet?.title === "string" && /^UC[A-Za-z0-9_-]{22}$/.test(v.snippet.channelId))
      .map(v => ({ id: v.id, title: v.snippet.title, channelId: v.snippet.channelId, channelTitle: String(v.snippet.channelTitle ?? ""), publishedAt: String(v.snippet.publishedAt ?? "") }));
  }
  return {
    async subscriptions(pageToken = "", channelId = "") {
      if (!auth.accessToken) throw new YoutubeError("youtube_not_connected", "Connect YouTube to read subscriptions.");
      const body = await get("subscriptions", { part: "snippet", mine: "true", maxResults: "20", ...(channelId ? { forChannelId: channelId } : {}), ...(pageToken ? { pageToken } : {}) });
      return { channels: body.items.filter(i => i && /^UC[A-Za-z0-9_-]{22}$/.test(i.snippet?.resourceId?.channelId) && typeof i.snippet?.title === "string").map(i => ({ id: i.snippet.resourceId.channelId, title: i.snippet.title } as YoutubeChannel)), nextPageToken: body.nextPageToken ?? null };
    },
    async resolveChannel(input: string) {
      const target = youtubeChannelTarget(input);
      const body = await get("channels", { part: "id", ...target, maxResults: "1" });
      const id = body.items[0]?.id;
      if (typeof id !== "string" || !/^UC[A-Za-z0-9_-]{22}$/.test(id)) throw new YoutubeError("youtube_channel_missing", "This public channel was not found.");
      return id;
    },
    async identity() { const body = await get("channels", { part: "snippet", mine: "true", maxResults: "1" }); return body.items[0]?.snippet?.title as string | undefined; },
    async channelVideos(channelId: string, pageToken = "") {
      const channel = await get("channels", { part: "contentDetails", id: channelId, maxResults: "1" });
      const playlistId = channel.items[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (typeof playlistId !== "string") throw new YoutubeError("youtube_channel_missing", "This channel has no available uploads.");
      const body = await get("playlistItems", { part: "contentDetails", playlistId, maxResults: "20", ...(pageToken ? { pageToken } : {}) });
      const rows = await videos(body.items.map(i => i?.contentDetails?.videoId).filter(i => typeof i === "string" && /^[A-Za-z0-9_-]{11}$/.test(i)));
      return { videos: rows.filter(v => v.channelId === channelId), nextPageToken: body.nextPageToken ?? null };
    },
    async search(query: string, pageToken = "") {
      const body = await get("search", { part: "snippet", type: "video", q: query, maxResults: "20", ...(pageToken ? { pageToken } : {}) });
      return { videos: await videos(body.items.map(i => i?.id?.videoId).filter(i => typeof i === "string" && /^[A-Za-z0-9_-]{11}$/.test(i))), nextPageToken: body.nextPageToken ?? null };
    },
    videos,
  };
}
