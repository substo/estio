import { StudioRestError, queryPath } from "../rest-client";
import { authorizeEstioSchedule, type ScheduleRest } from "../schedule-authority";
import { readProfileYoutubeAccess } from "../../google/profile-youtube-credentials";
import { createYoutubeApi, YoutubeError } from "../../google/youtube-api";
import { StudioJobError, type StudioJobHandler } from "./handlers";
export interface YoutubeDiscoveryContext {
  outcome: "ready"; brand: "estio" | "substo"; userId: string; connectionVersion: string;
  source: "approved_channel" | "search" | "subscription"; channelId: string; query: string;
}
export interface YoutubeDiscoveryDeps {
  rest: ScheduleRest;
  authorize(locationId: string, userId: string): Promise<boolean>;
  discover(context: YoutubeDiscoveryContext): Promise<string[]>;
}
export function createYoutubeDiscoveryHandler(deps: YoutubeDiscoveryDeps): StudioJobHandler {
  return async (job, context) => {
    const id = String(job.payload.discoveryRunId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new StudioJobError("invalid_job_payload", "This discovery job is invalid.", false);
    const [run] = await deps.rest<Array<{ result: Record<string, unknown> | null; actor_app: string; created_by_clerk_user_id: string }>>(queryPath("studio_youtube_schedule_runs", {
      select: "result,actor_app,created_by_clerk_user_id", location_id: `eq.${job.location_id}`, id: `eq.${id}`, job_id: `eq.${job.id}`, limit: "1" }));
    if (!run) throw new StudioJobError("discovery_missing", "This discovery run is unavailable.", false);
    if (run.result) return { discoveryRunId: id, alreadySaved: true };
    const fence = { p_location: job.location_id, p_run: id, p_job: job.id, p_worker: context.workerId, p_lease: job.lease_token };
    const rpc = <T>(name: string, body: Record<string, unknown> = {}) => deps.rest<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify({ ...fence, ...body }) });
    const active = () => { if (context.signal.aborted) throw new StudioJobError("worker_lease_lost", "The worker lost its lease.", true); };
    let stop: string | null = null;
    async function authority() {
      active();
      if (run!.actor_app === "estio" && !await deps.authorize(job.location_id, run!.created_by_clerk_user_id)) {
        stop = "authority_revoked"; throw new StudioJobError("discovery_authority_revoked", "Discovery authorization no longer has workspace access.", false);
      }
    }
    try {
      await authority();
      const input = await rpc<YoutubeDiscoveryContext | { outcome: "saved"; result: unknown } | { outcome: "quota" }>("studio_begin_youtube_discovery");
      if (input.outcome === "saved") return { discoveryRunId: id, alreadySaved: true };
      if (input.outcome === "quota") throw new StudioJobError("discovery_daily_limit", "This workspace reached its daily discovery limit.", true, 3600);
      active();
      const videos = await deps.discover(input);
      if (videos.length > 10 || new Set(videos).size !== videos.length || videos.some(v => !/^[A-Za-z0-9_-]{11}$/.test(v))) throw new Error("Invalid discovery result");
      await authority(); active();
      await rpc("studio_finish_youtube_discovery", { p_videos: videos });
      return { discoveryRunId: id };
    } catch (error) {
      if (error instanceof YoutubeError && ["google_reconnect", "youtube_not_connected", "profile_key_unavailable"].includes(error.code)) stop = "profile_grant_changed";
      if (error instanceof YoutubeError && ["not_subscribed", "youtube_channel_missing"].includes(error.code)) stop = "source_unavailable";
      if (stop && !context.signal.aborted) await rpc("studio_stop_youtube_discovery", { p_reason: stop }).catch(() => {});
      if (error instanceof StudioRestError && error.code === "42501") throw new StudioJobError("discovery_authorization_changed", "Profile grant, channel approval or schedule consent changed. Reauthorize discovery.", false);
      if (error instanceof YoutubeError) throw new StudioJobError(stop ? "discovery_authorization_changed" : "youtube_unavailable", stop ? "Reconnect your profile or review the selected source, then reauthorize discovery." : "YouTube is unavailable or quota-limited. This bounded read can retry.", !stop);
      throw error;
    }
  };
}
export async function discoverScheduledYoutube(input: YoutubeDiscoveryContext, rest: ScheduleRest, fetcher: typeof fetch = fetch) {
  const grant = await readProfileYoutubeAccess(rest, { brand: input.brand, userId: input.userId }, input.connectionVersion, fetcher);
  const api = createYoutubeApi({ accessToken: grant.token }, fetcher);
  if (input.source === "subscription") {
    const subscribed = await api.subscriptions("", input.channelId);
    if (!subscribed.channels.some(channel => channel.id === input.channelId)) throw new YoutubeError("not_subscribed", "This channel is no longer subscribed.");
  }
  const result = input.source === "search" ? await api.search(input.query) : await api.channelVideos(input.channelId);
  return [...new Set(result.videos.map(video => video.id))].slice(0, 10);
}
export function productionYoutubeDiscoveryDeps(rest: ScheduleRest): YoutubeDiscoveryDeps {
  return { rest, authorize: (locationId, userId) => authorizeEstioSchedule(rest, locationId, userId),
    discover: input => discoverScheduledYoutube(input, rest) };
}
