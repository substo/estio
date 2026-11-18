import "server-only";
import { Prisma } from "@prisma/client";
import { YoutubeError } from "@/lib/google/youtube-api";
import { studioDb } from "./studio-db";
import { StudioDbError } from "./db";
import { macSearchResultSchema, type MacSearchResult } from "./youtube-mac-search-policy";

export const macSearchMessages: Record<string, string> = {
  YS001: "Pair your Mac in Setup so Related videos can search YouTube from it. Nothing was sent to a paid service.",
  YS002: "Turn Mac processing on in Setup so Related videos can search YouTube from your Mac.",
  YS003: "Install Google Chrome on your Mac (and run youtube-login once to sign in), then search again.",
  YS004: "Update the Studio companion on your Mac, which does not support YouTube search yet.",
  YS005: "Too many searches in a minute. Wait a moment and try again.",
  "42501": "Only a Business admin with a paired Mac can search YouTube from their Mac.",
};
type Actor = { locationId: string; app: "estio" | "substo"; userId: string };

/** Queue one read-only search on the requesting account's own paired Mac. No hosted or paid fallback exists here. */
export async function startMacYoutubeSearch(access: Actor, query: string, limit: number, requestKey: string) {
  try {
    const result = await studioDb.call<{ jobId: string; status: string }>("studio_enqueue_youtube_search", { p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId,
      p_command: { query, limit, requestKey } });
    return result.jobId;
  } catch (error) {
    const message = error instanceof StudioDbError && error.code ? macSearchMessages[error.code] : undefined;
    if (message) throw new YoutubeError("mac_search_unavailable", message);
    throw error;
  }
}

export type MacSearchState = { status: "pending" } | { status: "failed"; message: string } | { status: "done"; result: MacSearchResult; limit: number; query: string };
export async function readMacYoutubeSearch(access: Actor, jobId: unknown): Promise<MacSearchState> {
  if (typeof jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) throw new YoutubeError("invalid_request", "Search again.");
  const row = await studioDb.rows<{ status: string; result: unknown; payload: { query?: string; limit?: number }; last_error_message: string | null }>(Prisma.sql`
    select status, result, payload, last_error_message from studio.studio_jobs
    where id = ${jobId}::uuid and location_id = ${access.locationId} and kind = 'studio.youtube_search' and created_by_clerk_user_id = ${access.userId} limit 1`);
  const job = row[0];
  if (!job) throw new YoutubeError("invalid_request", "This search expired. Search again.");
  if (job.status === "queued" || job.status === "running") return { status: "pending" };
  if (job.status === "succeeded") {
    const parsed = macSearchResultSchema.safeParse(job.result);
    if (parsed.success) return { status: "done", result: parsed.data, limit: Number(job.payload.limit) || 5, query: String(job.payload.query ?? "") };
    return { status: "failed", message: "The Mac returned an unexpected result. Search again." };
  }
  return { status: "failed", message: job.last_error_message || (job.status === "cancelled" ? "The search was cancelled because the Mac's settings changed. Search again." : "The Mac could not finish this search. Search again.") };
}
