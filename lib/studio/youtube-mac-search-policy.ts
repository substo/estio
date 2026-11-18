import { z } from "zod";

/** Public facts about a video as seen in the paired Mac's browser. Titles/channels are untrusted display text. */
export const macVideoSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{11}$/), title: z.string().trim().min(1).max(300),
  channelId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/).optional(), channelTitle: z.string().max(200).optional(),
  publishedText: z.string().max(80).optional(), viewsText: z.string().max(80).optional(), description: z.string().max(400).optional(),
}).strict();
export type MacVideo = z.infer<typeof macVideoSchema>;
export const macSearchResultSchema = z.object({ videos: z.array(macVideoSchema).max(12), signedIn: z.boolean().optional() }).strict();
export type MacSearchResult = z.infer<typeof macSearchResultSchema>;
export const macSearchPayloadSchema = z.object({ query: z.string().trim().min(1).max(160), limit: z.number().int().min(3).max(12) }).strict();

const text = (value: unknown, max: number): string | undefined => {
  if (!value || typeof value !== "object") return typeof value === "string" ? clean(value, max) : undefined;
  const v = value as { simpleText?: unknown; runs?: unknown };
  if (typeof v.simpleText === "string") return clean(v.simpleText, max);
  if (Array.isArray(v.runs)) return clean(v.runs.map(run => (run && typeof run === "object" && typeof (run as { text?: unknown }).text === "string" ? (run as { text: string }).text : "")).join(""), max);
  return undefined;
};
const clean = (value: string, max: number) => { const out = value.replace(/\s+/g, " ").trim().slice(0, max); return out || undefined; };

/** Read video rows from YouTube's own search-page data (ytInitialData). Anything unexpected is skipped, never guessed. */
export function parseYoutubeSearchData(data: unknown, limit: number): MacVideo[] {
  const videos: MacVideo[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown, depth: number) => {
    if (videos.length >= limit || depth > 12 || !node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
    const record = node as Record<string, unknown>;
    const renderer = record.videoRenderer;
    if (renderer && typeof renderer === "object") {
      const r = renderer as Record<string, unknown>;
      const id = typeof r.videoId === "string" ? r.videoId : "";
      const owner = (r.ownerText ?? r.longBylineText) as { runs?: Array<{ text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }> } | undefined;
      const channelId = owner?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId;
      const candidate = { id, title: text(r.title, 300), channelId: typeof channelId === "string" ? channelId : undefined, channelTitle: text(r.ownerText ?? r.longBylineText, 200),
        publishedText: text(r.publishedTimeText, 80), viewsText: text(r.viewCountText, 80),
        description: text((r.detailedMetadataSnippets as Array<{ snippetText?: unknown }> | undefined)?.[0]?.snippetText ?? r.descriptionSnippet, 400) };
      const parsed = macVideoSchema.safeParse(Object.fromEntries(Object.entries(candidate).filter(([, v]) => v !== undefined)));
      if (parsed.success && !seen.has(id)) { seen.add(id); videos.push(parsed.data); }
      return;
    }
    for (const value of Object.values(record)) walk(value, depth + 1);
  };
  walk(data, 0);
  return videos;
}

export function youtubeSearchUrl(query: string) {
  return `https://www.youtube.com/results?${new URLSearchParams({ search_query: query, sp: "EgIQAQ%3D%3D" }).toString().replace("sp=EgIQAQ%253D%253D", "sp=EgIQAQ%3D%3D")}`;
}
/** Signed-out pages carry a sign-in button and no account avatar (checked against live youtube.com, 2026-11-18). */
export function isSignedInTopbar(data: unknown) {
  const topbar = data && typeof data === "object" ? (data as { topbar?: unknown }).topbar : undefined;
  const text = JSON.stringify(topbar ?? {});
  return !text.includes("signInEndpoint") && text.includes('"avatar"');
}
