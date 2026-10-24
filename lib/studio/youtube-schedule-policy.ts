import { StudioCommandError } from "./command-error";
import { isScheduleRequest } from "./schedule-policy";
import { channelIdPattern } from "../google/youtube-policy";
export type YoutubeScheduleSource = "approved_channel" | "search" | "subscription";
export function readYoutubeScheduleCommand(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StudioCommandError("Invalid discovery authorization.");
  const b = value as Record<string, unknown>;
  if (b.action !== "enable_youtube" || typeof b.scheduleId !== "string" || typeof b.version !== "number"
    || !isScheduleRequest(b.scheduleId, b.version) || b.version < 1 || !Number.isSafeInteger(b.stateVersion) || Number(b.stateVersion) < 0
    || typeof b.requestId !== "string" || !isScheduleRequest(b.requestId, 0)
    || typeof b.connectionVersion !== "string" || !isScheduleRequest(b.connectionVersion, 0) || b.confirmShare !== true
    || !["approved_channel", "search", "subscription"].includes(String(b.source)) || typeof b.titlePrefix !== "string"
    || !b.titlePrefix.trim() || b.titlePrefix.trim().length > 100 || /[\x00-\x1f\x7f]/.test(b.titlePrefix)) throw new StudioCommandError("Select a source, label and explicit recurring link-sharing consent.");
  const source = b.source as YoutubeScheduleSource;
  if (source !== "search" && (typeof b.channelId !== "string" || !channelIdPattern.test(b.channelId))) throw new StudioCommandError("Choose one channel ID from discovery or the approved channels.");
  return { action: "enable_youtube" as const, scheduleId: b.scheduleId.toLowerCase(), version: b.version,
    stateVersion: Number(b.stateVersion), requestId: b.requestId.toLowerCase(), connectionVersion: b.connectionVersion.toLowerCase(), source,
    channelId: source === "search" ? "" : String(b.channelId), titlePrefix: b.titlePrefix.trim(), confirmShare: true as const };
}
