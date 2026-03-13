import { isWithinQuietHours } from '../ai/automation/config.ts';
import { normalizeReminderOffsets } from './reminder-config.ts';

export type ReminderQuietHoursWindow = {
  enabled?: boolean | null;
  startHour?: number | null;
  endHour?: number | null;
} | null | undefined;

export type ReminderScheduleSlot = {
  offsetMinutes: number;
  scheduledFor: Date;
  effectiveOffsetMinutes: number;
  deferredByQuietHours: boolean;
};

export function deferReminderFromQuietHours(date: Date, timezone: string, quietHours?: ReminderQuietHoursWindow) {
  if (!quietHours?.enabled) return date;

  let candidate = new Date(date);
  for (let i = 0; i < 24 * 60 + 5; i += 1) {
    if (!isWithinQuietHours(candidate, timezone, {
      enabled: !!quietHours.enabled,
      startHour: Number(quietHours.startHour ?? 21),
      endHour: Number(quietHours.endHour ?? 8),
    })) {
      return candidate;
    }
    candidate = new Date(candidate.getTime() + 60_000);
  }

  return candidate;
}

export function getEffectiveReminderLeadMinutes(dueAt: Date, scheduledFor: Date) {
  const deltaMs = dueAt.getTime() - scheduledFor.getTime();
  if (!Number.isFinite(deltaMs)) return 0;
  return Math.max(0, Math.round(deltaMs / 60_000));
}

export function buildReminderScheduleSlots(args: {
  dueAt: Date;
  offsets: unknown;
  timeZone: string;
  quietHours?: ReminderQuietHoursWindow;
}) {
  const offsets = normalizeReminderOffsets(args.offsets, []);
  const rowsByTimestamp = new Map<number, ReminderScheduleSlot>();

  for (const offsetMinutes of offsets) {
    const baseScheduledFor = new Date(args.dueAt.getTime() - offsetMinutes * 60_000);
    const scheduledFor = offsetMinutes === 0
      ? baseScheduledFor
      : deferReminderFromQuietHours(baseScheduledFor, args.timeZone, args.quietHours);

    if (offsetMinutes > 0 && scheduledFor.getTime() >= args.dueAt.getTime()) {
      continue;
    }

    const timeKey = scheduledFor.getTime();
    const slot: ReminderScheduleSlot = {
      offsetMinutes,
      scheduledFor,
      effectiveOffsetMinutes: getEffectiveReminderLeadMinutes(args.dueAt, scheduledFor),
      deferredByQuietHours: scheduledFor.getTime() !== baseScheduledFor.getTime(),
    };
    const existing = rowsByTimestamp.get(timeKey);

    if (!existing || offsetMinutes < existing.offsetMinutes) {
      rowsByTimestamp.set(timeKey, slot);
    }
  }

  return Array.from(rowsByTimestamp.values()).sort((a, b) => {
    const byTime = a.scheduledFor.getTime() - b.scheduledFor.getTime();
    if (byTime !== 0) return byTime;
    return a.offsetMinutes - b.offsetMinutes;
  });
}
