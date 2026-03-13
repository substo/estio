import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReminderScheduleSlots,
  getEffectiveReminderLeadMinutes,
} from "./reminder-schedule.ts";

const quietHours = {
  enabled: true,
  startHour: 21,
  endHour: 8,
};

test("at-due-time reminders stay on the due timestamp even inside quiet hours", () => {
  const dueAt = new Date("2026-03-13T20:10:00.000Z"); // 22:10 Asia/Nicosia
  const slots = buildReminderScheduleSlots({
    dueAt,
    offsets: [60, 0],
    timeZone: "Asia/Nicosia",
    quietHours,
  });

  assert.deepEqual(
    slots.map((slot) => ({
      offsetMinutes: slot.offsetMinutes,
      scheduledFor: slot.scheduledFor.toISOString(),
      effectiveOffsetMinutes: slot.effectiveOffsetMinutes,
    })),
    [
      {
        offsetMinutes: 0,
        scheduledFor: "2026-03-13T20:10:00.000Z",
        effectiveOffsetMinutes: 0,
      },
    ]
  );
});

test("quiet-hours deferral keeps a pre-due reminder only when it still lands before the due time", () => {
  const dueAt = new Date("2026-03-14T06:15:00.000Z"); // 08:15 Asia/Nicosia
  const slots = buildReminderScheduleSlots({
    dueAt,
    offsets: [60, 0],
    timeZone: "Asia/Nicosia",
    quietHours,
  });

  assert.deepEqual(
    slots.map((slot) => ({
      offsetMinutes: slot.offsetMinutes,
      scheduledFor: slot.scheduledFor.toISOString(),
      effectiveOffsetMinutes: slot.effectiveOffsetMinutes,
    })),
    [
      {
        offsetMinutes: 60,
        scheduledFor: "2026-03-14T06:00:00.000Z",
        effectiveOffsetMinutes: 15,
      },
      {
        offsetMinutes: 0,
        scheduledFor: "2026-03-14T06:15:00.000Z",
        effectiveOffsetMinutes: 0,
      },
    ]
  );
});

test("collapsed quiet-hours reminder times dedupe to the closest offset", () => {
  const dueAt = new Date("2026-03-14T06:15:00.000Z"); // 08:15 Asia/Nicosia
  const slots = buildReminderScheduleSlots({
    dueAt,
    offsets: [180, 60],
    timeZone: "Asia/Nicosia",
    quietHours,
  });

  assert.deepEqual(
    slots.map((slot) => ({
      offsetMinutes: slot.offsetMinutes,
      scheduledFor: slot.scheduledFor.toISOString(),
      effectiveOffsetMinutes: slot.effectiveOffsetMinutes,
    })),
    [
      {
        offsetMinutes: 60,
        scheduledFor: "2026-03-14T06:00:00.000Z",
        effectiveOffsetMinutes: 15,
      },
    ]
  );
});

test("effective lead minutes never goes negative for delayed reminders", () => {
  const dueAt = new Date("2026-03-14T06:15:00.000Z");
  const scheduledFor = new Date("2026-03-14T07:00:00.000Z");

  assert.equal(getEffectiveReminderLeadMinutes(dueAt, scheduledFor), 0);
});
