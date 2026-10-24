export const schedulePresets = {
  "youtube-discovery": "YouTube discovery",
  "idea-review": "Idea review",
  "script-brief": "Script brief",
} as const;

export interface ScheduleDraft {
  presetId: keyof typeof schedulePresets;
  query: string;
  intervalHours: 24 | 168;
  dailyTime: string;
}

export function readScheduleDraft(form: FormData): ScheduleDraft {
  const presetId = form.get("presetId");
  const query = form.get("query") ?? "";
  const interval = form.get("intervalHours");
  const dailyTime = form.get("dailyTime");
  if (typeof presetId !== "string" || !Object.hasOwn(schedulePresets, presetId)) throw new Error("Choose a workflow.");
  if (typeof query !== "string" || query.length > 160 || /[\x00-\x1f\x7f]/.test(query)) throw new Error("Focus must be at most 160 characters without control characters.");
  if (interval !== "24" && interval !== "168") throw new Error("Choose daily or every seven days.");
  if (typeof dailyTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyTime)) throw new Error("Choose a valid daily time.");
  return { presetId: presetId as ScheduleDraft["presetId"], query, intervalHours: Number(interval) as 24 | 168, dailyTime };
}

export function isScheduleRequest(id: string, version: number): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    && Number.isSafeInteger(version) && version >= 0;
}
