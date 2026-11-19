import "server-only";
import { Prisma } from "@prisma/client";
import { YoutubeError } from "@/lib/google/youtube-api";
import { studioDb } from "./studio-db";
import { macSearchMessages, startRelatedSearchJob, type RelatedSearchCommand } from "./youtube-search-routing";
import { relatedResultSchema, type RelatedResult, type RelatedTrace } from "./related-search-policy";

export { macSearchMessages } from "./youtube-search-routing";
type Actor = { locationId: string; app: "estio" | "substo"; userId: string };

export function startMacYoutubeSearch(access: Actor, command: RelatedSearchCommand, options: { deviceNetwork: boolean }) {
  return startRelatedSearchJob(studioDb, access, command, options);
}

export type MacSearchState = { status: "pending" } | { status: "failed"; message: string } | { status: "done"; result: RelatedResult; limit: number; query: string; viaDevice: boolean; egress: boolean; jobId: string };
export async function readMacYoutubeSearch(access: Actor, jobId: unknown): Promise<MacSearchState> {
  if (typeof jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) throw new YoutubeError("invalid_request", "Search again.");
  const row = await studioDb.rows<{ status: string; kind: string; result: unknown; payload: { query?: string; limit?: number; macReason?: string }; last_error_message: string | null; last_error_code: string | null }>(Prisma.sql`
    select status, kind, result, payload, last_error_message, last_error_code from studio.studio_jobs
    where id = ${jobId}::uuid and location_id = ${access.locationId} and kind in ('studio.youtube_search', 'studio.youtube_search_egress') and created_by_clerk_user_id = ${access.userId} limit 1`);
  const job = row[0];
  if (!job) throw new YoutubeError("invalid_request", "This search expired. Search again.");
  if (job.status === "queued" || job.status === "running") return { status: "pending" };
  if (job.status === "succeeded") {
    const parsed = relatedResultSchema.safeParse(job.result);
    if (parsed.success) return { status: "done", result: parsed.data, limit: Number(job.payload.limit) || 5, query: String(job.payload.query ?? ""), viaDevice: parsed.data.via === "device_network", egress: job.kind === "studio.youtube_search_egress", jobId };
    return { status: "failed", message: "The Mac returned an unexpected result. Search again." };
  }
  // No phone relay either: the Mac's own reason is the actionable one.
  if (job.last_error_code === "youtube_no_device" && job.payload.macReason && macSearchMessages[job.payload.macReason]) return { status: "failed", message: macSearchMessages[job.payload.macReason] };
  const ref = ` (ref ${jobId.slice(0, 8)})`;
  // The runner's generic text says "It will retry", which is false for a search: it is never retried automatically.
  if (job.last_error_code === "unexpected_error") return { status: "failed", message: `The Mac finished the search but the result could not be saved. It was not retried; search again.${ref}` };
  if (job.last_error_code === "worker_lease_expired") return { status: "failed", message: `The Mac stopped (or went to sleep) before finishing this search. Search again.${ref}` };
  return { status: "failed", message: (job.last_error_message || (job.status === "cancelled" ? "The search was cancelled because the Mac's settings changed. Search again." : "The Mac could not finish this search. Search again.")) + ref };
}

/** Keep the reasoning of a run (route, queries, prompts, model, scores). Idempotent per job; a failure to log never hides the results. */
export async function recordRelatedRun(access: Actor, anchorId: string, jobId: string | null, trace: RelatedTrace) {
  try {
    return await studioDb.call<string>("studio_record_related_run", { p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_anchor: anchorId, p_job: jobId,
      p_route: trace.route, p_mode: trace.mode, p_trace: trace });
  } catch { return null; }
}
