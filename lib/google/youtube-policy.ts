export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export type DiscoveryMode = "subscriptions" | "subscription" | "channel" | "search" | "url";
export const channelIdPattern = /^UC[A-Za-z0-9_-]{22}$/;
export const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;
export function youtubeVideoId(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("Enter a YouTube video URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Use an HTTPS YouTube video URL.");
  let id: string | null = null;
  if (url.hostname === "youtu.be") id = url.pathname.slice(1);
  else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
    id = url.pathname === "/watch" ? (url.searchParams.getAll("v").length === 1 ? url.searchParams.get("v") : null)
      : url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null;
  }
  if (!id || !videoIdPattern.test(id)) throw new Error("Choose a single YouTube video URL.");
  return id;
}
export function readDiscoveryRequest(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose a discovery source.");
  const input = value as Record<string, unknown>;
  const mode = input.mode;
  if (!["subscriptions", "subscription", "channel", "search", "url"].includes(String(mode))) throw new Error("Choose a discovery source.");
  const text = typeof input.query === "string" ? input.query.trim() : "";
  const channelId = typeof input.channelId === "string" ? input.channelId : "";
  const pageToken = typeof input.pageToken === "string" ? input.pageToken : "";
  if (text.length > 300 || /[\x00-\x1f\x7f]/.test(text) || !/^[A-Za-z0-9_+/=-]{0,512}$/.test(pageToken)) throw new Error("Check the search or page token.");
  if (mode === "search" && (!text || text.length > 160)) throw new Error("Enter a search up to 160 characters.");
  if ((mode === "channel" || mode === "subscription") && !channelIdPattern.test(channelId)) throw new Error("Choose a YouTube channel.");
  const videoId = mode === "url" ? youtubeVideoId(text) : null;
  return { mode: mode as DiscoveryMode, query: text, channelId, pageToken, videoId };
}
export function youtubeClientConfig(env: Record<string, string | undefined> = process.env) {
  const custom = Boolean(env.PLATFORM_GOOGLE_CLIENT_ID || env.PLATFORM_GOOGLE_CLIENT_SECRET);
  const clientId = (custom ? env.PLATFORM_GOOGLE_CLIENT_ID : env.GOOGLE_CLIENT_ID)?.trim();
  const clientSecret = (custom ? env.PLATFORM_GOOGLE_CLIENT_SECRET : env.GOOGLE_CLIENT_SECRET)?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
export const youtubeProfileContext = (brand: string, userId: string, purpose: "refresh" | "oauth") => `platform:google-youtube:${brand}:${userId}:${purpose}`;

export function youtubeChannelTarget(input: string): { id: string } | { forHandle: string } {
  const value = input.trim();
  if (channelIdPattern.test(value)) return { id: value };
  if (/^@[^\s/?#]{1,100}$/.test(value)) return { forHandle: value };
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) throw new Error();
    const channel = url.pathname.match(/^\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/)?.[1];
    const handle = url.pathname.match(/^\/(@[^/?#]+)\/?$/)?.[1];
    if (channel) return { id: channel };
    if (handle && handle.length <= 300) return { forHandle: decodeURIComponent(handle) };
  } catch { /* Report only the safe input requirement below. */ }
  throw new Error("Enter a YouTube channel URL, @handle, or channel ID.");
}
