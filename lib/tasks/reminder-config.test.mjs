import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TASK_REMINDER_OFFSETS_MINUTES,
  normalizeReminderOffsets,
  reminderOffsetLabel,
} from "./reminder-config.ts";

test("normalizeReminderOffsets sorts, deduplicates, and drops invalid values", () => {
  const result = normalizeReminderOffsets([60, 0, 60, -5, 999999, 1440]);
  assert.deepEqual(result, [1440, 60, 0]);
});

test("normalizeReminderOffsets falls back to defaults when input is empty", () => {
  const result = normalizeReminderOffsets([]);
  assert.deepEqual(result, [...DEFAULT_TASK_REMINDER_OFFSETS_MINUTES]);
});

test("reminderOffsetLabel formats common reminder presets", () => {
  assert.equal(reminderOffsetLabel(0), "At due time");
  assert.equal(reminderOffsetLabel(60), "1 hour before");
  assert.equal(reminderOffsetLabel(1440), "24 hours before");
  assert.equal(reminderOffsetLabel(4320), "3 days before");
});
