import "server-only";
import { requireOwnStudioCommandLocation } from "./paid-workspace";
import { getPlatformProfile } from "../platform/profile";
import { getStudioAccess } from "./access";
import { studioRest, queryPath } from "./rest";
import { profileYoutubeAccess, profileYoutubeConnection } from "../google/profile-youtube";
import { createYoutubeApi } from "../google/youtube-api";
import { StudioCommandError } from "./command-error";
import type { readYoutubeScheduleCommand } from "./youtube-schedule-policy";
type YoutubeScheduleCommand = ReturnType<typeof readYoutubeScheduleCommand>;
// Shared by activation and Run now: own profile, current grant, subscription check.
async function verifyYoutubeScheduleSource(locationId: string, command: YoutubeScheduleCommand) {
  const access = await requireOwnStudioCommandLocation(locationId);
  const profile = await getPlatformProfile();
  if (!profile) throw new StudioCommandError("Use your own profile.", 403);
  const connection = await profileYoutubeConnection(profile);
  if (!connection) throw new StudioCommandError("Connect YouTube in your profile first.");
  if (connection.version !== command.connectionVersion) throw new StudioCommandError("Your profile connection changed. Reload and authorize the selected grant again.", 409);
  // Verify private subscription selection only for this principal. The full
  // subscription list is never read, shared or stored by this command.
  if (command.source === "subscription") {
    const grant = await profileYoutubeAccess(profile);
    if (grant.version !== connection.version) throw new StudioCommandError("Your connection changed. Reload.", 409);
    const slot = await studioRest<boolean>("rpc/studio_youtube_request_slot", { method: "POST", body: JSON.stringify({ p_location: access.locationId, p_app: access.app, p_user: access.userId }) });
    if (!slot) throw new StudioCommandError("Daily discovery limit reached. Try tomorrow.");
    const subscribed = await createYoutubeApi({ accessToken: grant.token }).subscriptions("", command.channelId);
    if (!subscribed.channels.some(channel => channel.id === command.channelId)) throw new StudioCommandError("Choose a channel subscribed by this connected profile.");
  }
  return { access, connection };
}
export async function enableStudioYoutubeSchedule(locationId: string, command: YoutubeScheduleCommand) {
  const { access, connection } = await verifyYoutubeScheduleSource(locationId, command);
  return studioRest("rpc/studio_enable_youtube_schedule", { method: "POST", body: JSON.stringify({ p_location: access.locationId, p_app: access.app,
    p_user: access.userId, p_schedule: command.scheduleId, p_version: command.version, p_state_version: command.stateVersion,
    p_request: command.requestId, p_connection_version: connection.version, p_source: command.source, p_channel: command.channelId,
    p_title: command.titlePrefix, p_confirm_share: command.confirmShare }) });
}
export async function runStudioYoutubeScheduleNow(locationId: string, command: YoutubeScheduleCommand) {
  const { access, connection } = await verifyYoutubeScheduleSource(locationId, command);
  return studioRest<{ executionId: string; discoveryRunId: string; jobId: string; workflow: "youtube_discovery" }>("rpc/studio_run_youtube_schedule_now", { method: "POST", body: JSON.stringify({
    p_location: access.locationId, p_app: access.app, p_user: access.userId, p_schedule: command.scheduleId, p_version: command.version,
    p_request: command.requestId, p_connection_version: connection.version, p_source: command.source, p_channel: command.channelId,
    p_title: command.titlePrefix, p_confirm_share: command.confirmShare }) });
}
export async function getStudioYoutubeScheduleSettings(locationId: string) {
  const access = await getStudioAccess(locationId); const profile = await getPlatformProfile();
  if (!access || !profile || profile.userId !== access.userId || profile.brand !== access.app) return null;
  const [channels, connection] = await Promise.all([
    studioRest<Array<{ channel_id: string; label: string }>>(queryPath("studio_youtube_channels", { select: "channel_id,label", location_id: `eq.${access.locationId}`, order: "label.asc,channel_id.asc", limit: "100" })),
    profileYoutubeConnection(profile),
  ]);
  return { connected: !!connection, connectionVersion: connection?.version ?? null, channels };
}
export async function getStudioYoutubeScheduleRun(locationId: string, scheduleId: string, runId: string) {
  const access = await getStudioAccess(locationId);
  if (!access || !/^[0-9a-f-]{36}$/i.test(scheduleId) || !/^[0-9a-f-]{36}$/i.test(runId)) return null;
  const [run] = await studioRest<Array<{ job_id: string; created_at: string; completed_at: string | null;
    result: { links: Array<{ videoId: string; recordId: string; reused: boolean }>; observedAt: string } | null }>>(queryPath("studio_youtube_schedule_runs", {
      select: "job_id,created_at,completed_at,result", location_id: `eq.${access.locationId}`, schedule_id: `eq.${scheduleId}`, id: `eq.${runId}`, limit: "1" }));
  if (!run) return null;
  const [job] = await studioRest<Array<{ status: string; last_error_message: string | null }>>(queryPath("studio_jobs", { select: "status,last_error_message",
    location_id: `eq.${access.locationId}`, id: `eq.${run.job_id}`, limit: "1" }));
  return { run, job };
}
