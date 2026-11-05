import { safeStudioSourceUrl } from "./library-policy";

export const LIBRARY_PLATFORMS = ["youtube", "instagram", "tiktok", "facebook", "linkedin", "x", "other"] as const;
export type LibraryPlatform = typeof LIBRARY_PLATFORMS[number];
export const platformLabels: Record<LibraryPlatform, string> = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok", facebook: "Facebook", linkedin: "LinkedIn", x: "X", other: "Web" };
const text = (...values: unknown[]) => values.find(value => typeof value === "string" && value.trim()) as string | undefined;
export function libraryPlatform(value: unknown, source?: string | null): LibraryPlatform {
  const name = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (name === "twitter") return "x";
  if (LIBRARY_PLATFORMS.includes(name as LibraryPlatform)) return name as LibraryPlatform;
  try {
    const host = new URL(source || "").hostname.replace(/^www\./, "");
    for (const platform of LIBRARY_PLATFORMS) if (host === `${platform}.com` || host.endsWith(`.${platform}.com`)) return platform;
    if (host === "fb.watch") return "facebook";
    if (host === "youtu.be") return "youtube";
    if (host === "twitter.com") return "x";
  } catch { /* Sources without URLs still have a neutral presentation. */ }
  return "other";
}
export function safeLibraryPresentationImage(value: unknown): string | null {
  const safe = safeStudioSourceUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.port || !host.includes(".") || host.includes(":") || /^\d+(?:\.\d+){3}$/.test(host) || /^(localhost|.*\.(local|internal|localhost))$/.test(host) || host.endsWith(".home.arpa")) return null;
  return safe;
}
export function libraryPresentation(record: { source_url: string | null; summary: string | null; payload?: Record<string, unknown> }) {
  const p = record.payload || {};
  const url = safeStudioSourceUrl(text(record.source_url, p.url, p.sourceUrl, p.source_url));
  const platform = libraryPlatform(p.platform, url);
  const format = text(p.format, p.mediaType, p.media_type)?.toLowerCase() || "";
  const portrait = /short|reel|portrait|vertical|9:16/.test(format) || platform === "tiktok" || /\/(shorts|reel|reels)\//.test(url || "");
  const square = !portrait && (/square|1:1/.test(format) || platform === "instagram");
  let thumbnail = safeLibraryPresentationImage(text(p.thumbnailUrl, p.thumbnail_url, p.thumbnail, p.imageUrl, p.image_url, p.avatarUrl, p.avatar_url));
  if (!thumbnail && platform === "youtube" && url) {
    const parsed = new URL(url);
    const id = parsed.hostname === "youtu.be" ? parsed.pathname.slice(1) : parsed.searchParams.get("v") || parsed.pathname.match(/\/(?:shorts|embed)\/([^/]+)/)?.[1];
    if (id && /^[\w-]{11}$/.test(id)) thumbnail = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  }
  const summaryBasis = text(p.summaryBasis, p.summary_basis);
  const summaryStatus = text(p.summaryStatus, p.summary_status);
  const generated = text(p.aiSummary, p.ai_summary);
  const researchNote = text(p.summary, record.summary);
  const description = text(p.description, p.sourceDescription, p.source_description);
  const summary = generated || researchNote || description;
  const basisLabel = summaryBasis?.toLowerCase().includes("transcript") ? "transcript" : summaryBasis?.toLowerCase().includes("description") ? "description" : undefined;
  const summaryLabel = generated ? basisLabel ? `AI summary · ${basisLabel}` : "AI summary" : researchNote ? "Research note" : "Source description";
  const waiting = ["pending", "queued", "processing", "waiting", "not_generated", "waiting_for_capacity", "waiting_for_companion", "waiting_for_device"].includes(summaryStatus || "");
  const statusMessage = summaryStatus === "waiting_for_device" || summaryStatus === "waiting_for_companion" ? "Summary waiting for a connected computer."
    : summaryStatus === "waiting_for_capacity" ? "Summary waiting for subscription capacity."
    : summaryStatus === "no_evidence" ? "Source description or transcript unavailable."
    : summaryStatus === "uncertain" ? "Summary outcome uncertain. Check details before retrying."
    : summaryStatus === "stale" ? "Summary may be out of date."
    : waiting ? "Summary waiting for a connected computer or subscription capacity." : undefined;
  return { url, platform, portrait, square, thumbnail, summary, statusMessage, summaryLabel, waiting, creator: text(p.channelName, p.channel_name, p.creatorName, p.creator_name, p.author, p.handle), summaryStatus };
}
export function libraryHref(view: string, platform: string, page = 0) {
  const query = new URLSearchParams({ view });
  if (LIBRARY_PLATFORMS.includes(platform as LibraryPlatform)) query.set("platform", platform);
  if (page > 0) query.set("page", String(page));
  return `/studio/library?${query}`;
}
