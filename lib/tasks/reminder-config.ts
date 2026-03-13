export const DEFAULT_TASK_REMINDER_OFFSETS_MINUTES = [1440, 60, 0] as const;
export const AVAILABLE_TASK_REMINDER_OFFSETS_MINUTES = [4320, 1440, 60, 0] as const;
const MAX_OFFSET_MINUTES = 7 * 24 * 60;

export function normalizeReminderOffsets(input: unknown, fallback: readonly number[] = DEFAULT_TASK_REMINDER_OFFSETS_MINUTES) {
  const source = Array.isArray(input) ? input : fallback;
  const normalized = Array.from(
    new Set(
      source
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= MAX_OFFSET_MINUTES)
    )
  ).sort((a, b) => b - a);

  return normalized.length > 0 ? normalized : [...fallback];
}

export function reminderOffsetLabel(offsetMinutes: number) {
  if (offsetMinutes === 0) return 'At due time';
  if (offsetMinutes % 1440 === 0) {
    const days = offsetMinutes / 1440;
    return days === 1 ? '24 hours before' : `${days} days before`;
  }
  if (offsetMinutes % 60 === 0) {
    const hours = offsetMinutes / 60;
    return hours === 1 ? '1 hour before' : `${hours} hours before`;
  }
  return `${offsetMinutes} minutes before`;
}
