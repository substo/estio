import "server-only";
import { createYoutubeApi, YoutubeError } from "@/lib/google/youtube-api";
import { getStudioAccess } from "./access";
import { StudioCommandError } from "./command-error";
import { studioDb } from "./studio-db";
import { Prisma } from "@prisma/client";
import { canonicalYoutubeVideo } from "./video-transcription-policy";

export type CommentSample =
  | { status: "ok"; size: number; order: "relevance"; fetchedAt: string; videoUrl: string; comments: Array<{ text: string; href: string }> }
  | { status: "unavailable"; reason: string };

/**
 * An on-demand, read-only sample of public comments for ONE saved YouTube source, through the official commentThreads.list endpoint with the
 * server's Data API key (never a personal OAuth grant, never scraping). Nothing is stored or sent to a model: the text goes to the signed-in
 * browser for reading and each comment is linked to its own page. Author names and channel ids are never requested or returned.
 */
export async function sampleAudienceComments(locationId: string, sourceId: string, fetcher: typeof fetch = fetch): Promise<CommentSample> {
  const access = await getStudioAccess(locationId);
  if (!access) throw new StudioCommandError("Location access is required.", 403);
  const source = await studioDb.one<{ source_url: string | null }>(Prisma.sql`
    SELECT source_url FROM studio.studio_records WHERE location_id=${access.locationId} AND id=${sourceId}::uuid AND kind='reference' AND NOT archived`);
  if (!source) throw new StudioCommandError("Source unavailable.", 404);
  const video = canonicalYoutubeVideo(source.source_url ?? undefined);
  if (!video) return { status: "unavailable", reason: "Comments can be sampled for saved YouTube videos only." };
  const key = process.env.YOUTUBE_DATA_API_KEY?.trim();
  if (!key) return { status: "unavailable", reason: "YouTube comment sampling isn't configured on this server. You can still add your own audience observations." };
  const slot = await studioDb.call<boolean>("studio_youtube_request_slot", { p_location: access.locationId, p_app: access.app, p_user: access.userId });
  if (!slot) return { status: "unavailable", reason: "This workspace reached its daily YouTube request limit. Try tomorrow." };
  try {
    const rows = await createYoutubeApi({ apiKey: key }, fetcher).comments(video.videoId, 20);
    if (!rows.length) return { status: "unavailable", reason: "No public comments were returned for this video." };
    return { status: "ok", size: rows.length, order: "relevance", fetchedAt: new Date().toISOString(), videoUrl: `https://www.youtube.com/watch?v=${video.videoId}`,
      comments: rows.map(row => ({ text: row.text, href: `https://www.youtube.com/watch?v=${video.videoId}&lc=${encodeURIComponent(row.id)}` })) };
  } catch (error) {
    if (error instanceof YoutubeError) return { status: "unavailable", reason: error.code === "comments_disabled" ? error.message : "YouTube didn't return comments right now. Check API access and quota, or add your own observations." };
    throw error;
  }
}
