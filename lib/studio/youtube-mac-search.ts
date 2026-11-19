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

/** Tier 1 is the requesting account's own paired Mac. Only when that Mac cannot search does tier 2 apply: the hosted worker searches
 * through the Location's connected device network. There is no tier 3 (the metered Data API is not used here). */
const MAC_NOT_READY = new Set(["YS001", "YS002", "YS003", "YS004"]);
export async function startMacYoutubeSearch(access: Actor, query: string, limit: number, requestKey: string) {
  const identity = { p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId };
  try {
    const result = await studioDb.call<{ jobId: string; status: string }>("studio_enqueue_youtube_search", { ...identity, p_command: { query, limit, requestKey } });
    return result.jobId;
  } catch (error) {
    const code = error instanceof StudioDbError ? error.code : undefined;
    if (code && MAC_NOT_READY.has(code)) {
      try {
        const result = await studioDb.call<{ jobId: string }>("studio_enqueue_youtube_search_egress", { ...identity, p_command: { query, limit, requestKey, macReason: code } });
        return result.jobId;
      } catch (egressError) {
        const egressCode = egressError instanceof StudioDbError ? egressError.code : undefined;
        if (egressCode && macSearchMessages[egressCode] && egressCode !== "42501") throw new YoutubeError("mac_search_unavailable", macSearchMessages[egressCode]);
        throw new YoutubeError("mac_search_unavailable", macSearchMessages[code]);
      }
    }
    if (code && macSearchMessages[code]) throw new YoutubeError("mac_search_unavailable", macSearchMessages[code]);
    throw error;
  }
}

export type MacSearchState = { status: "pending" } | { status: "failed"; message: string } | { status: "done"; result: MacSearchResult; limit: number; query: string; viaDevice: boolean };
export async function readMacYoutubeSearch(access: Actor, jobId: unknown): Promise<MacSearchState> {
  if (typeof jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) throw new YoutubeError("invalid_request", "Search again.");
  const row = await studioDb.rows<{ status: string; result: unknown; payload: { query?: string; limit?: number; macReason?: string }; last_error_message: string | null; last_error_code: string | null }>(Prisma.sql`
    select status, result, payload, last_error_message, last_error_code from studio.studio_jobs
    where id = ${jobId}::uuid and location_id = ${access.locationId} and kind in ('studio.youtube_search', 'studio.youtube_search_egress') and created_by_clerk_user_id = ${access.userId} limit 1`);
  const job = row[0];
  if (!job) throw new YoutubeError("invalid_request", "This search expired. Search again.");
  if (job.status === "queued" || job.status === "running") return { status: "pending" };
  if (job.status === "succeeded") {
    const parsed = macSearchResultSchema.safeParse(job.result);
    if (parsed.success) return { status: "done", result: parsed.data, limit: Number(job.payload.limit) || 5, query: String(job.payload.query ?? ""), viaDevice: parsed.data.via === "device_network" };
    return { status: "failed", message: "The Mac returned an unexpected result. Search again." };
  }
  // No phone relay either: the Mac's own reason is the actionable one.
  if (job.last_error_code === "youtube_no_device" && job.payload.macReason && macSearchMessages[job.payload.macReason]) return { status: "failed", message: macSearchMessages[job.payload.macReason] };
  return { status: "failed", message: job.last_error_message || (job.status === "cancelled" ? "The search was cancelled because the Mac's settings changed. Search again." : "The Mac could not finish this search. Search again.") };
}
