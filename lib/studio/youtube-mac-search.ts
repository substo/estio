import "server-only";
import { Prisma } from "@prisma/client";
import { YoutubeError } from "@/lib/google/youtube-api";
import { studioDb } from "./studio-db";
import { macSearchMessages, startRelatedSearchJob } from "./youtube-search-routing";
import { macSearchResultSchema, type MacSearchResult } from "./youtube-mac-search-policy";

export { macSearchMessages } from "./youtube-search-routing";
type Actor = { locationId: string; app: "estio" | "substo"; userId: string };

export function startMacYoutubeSearch(access: Actor, query: string, limit: number, requestKey: string, options: { deviceNetwork: boolean }) {
  return startRelatedSearchJob(studioDb, access, query, limit, requestKey, options);
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
