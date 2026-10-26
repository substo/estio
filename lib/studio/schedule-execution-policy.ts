import { readYoutubeScheduleCommand } from "./youtube-schedule-policy";
import { StudioCommandError } from "./command-error";
import { readIdeaReviewRequest } from "./idea-review-policy";
import { isScheduleRequest } from "./schedule-policy";

/** Reuse the same canonical current-record selection as interactive text runs. */
export function readScheduleRunCommand(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StudioCommandError("Invalid schedule run.");
  const body = value as Record<string, unknown>;
  if (body.action !== "run_now" || typeof body.scheduleId !== "string" || typeof body.version !== "number"
    || !isScheduleRequest(body.scheduleId, body.version) || body.version < 1) throw new StudioCommandError("Reload the saved schedule before running it.");
  const selection = readIdeaReviewRequest({ ...body, focus: "" });
  return { action: "run_now" as const, scheduleId: body.scheduleId.toLowerCase(), version: body.version,
    requestId: selection.requestId, ideas: selection.ideas, confirmPaid: true as const };
}

export function readScheduleCommand(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value) && ["enable_youtube", "run_youtube_now"].includes(String((value as Record<string, unknown>).action))) return readYoutubeScheduleCommand(value);
  if (value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).action === "run_now") return readScheduleRunCommand(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StudioCommandError("Invalid recurring command.");
  const body = value as Record<string, unknown>;
  if ((body.action !== "enable" && body.action !== "pause") || typeof body.scheduleId !== "string" || typeof body.version !== "number"
    || !isScheduleRequest(body.scheduleId, body.version) || body.version < 1 || !Number.isSafeInteger(body.stateVersion) || Number(body.stateVersion) < 0
    || typeof body.requestId !== "string" || !isScheduleRequest(body.requestId, 0)) throw new StudioCommandError("Reload the schedule and its activation before continuing.");
  const common = { scheduleId: body.scheduleId.toLowerCase(), version: body.version, stateVersion: Number(body.stateVersion), requestId: body.requestId.toLowerCase() };
  if (body.action === "pause") return { ...common, action: "pause" as const, ideas: [], confirmRecurringPaid: false as const };
  if (body.confirmRecurringPaid !== true) throw new StudioCommandError("Explicitly authorize recurring paid runs until paused.");
  const selection = readIdeaReviewRequest({ ...body, focus: "", confirmPaid: true });
  return { ...common, action: "enable" as const, ideas: selection.ideas, confirmRecurringPaid: true as const };
}
