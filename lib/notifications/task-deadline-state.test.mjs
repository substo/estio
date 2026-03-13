import test from "node:test";
import assert from "node:assert/strict";
import {
  isTaskDeadlineNotificationStale,
  parseTaskReminderSyncVersion,
} from "./task-deadline-state.ts";

function buildNotification(overrides = {}) {
  return {
    id: "notif_1",
    userId: "user_1",
    type: "task_deadline",
    payload: {
      dueAt: "2026-03-13T19:15:41.471Z",
    },
    task: {
      deletedAt: null,
      status: "open",
      dueAt: new Date("2026-03-13T19:15:41.471Z"),
      assignedUserId: "user_1",
      syncVersion: 2,
      reminderMode: "custom",
    },
    taskReminderJob: {
      idempotencyKey: "task_1:user_1:offset_0:v2",
      status: "completed",
    },
    ...overrides,
  };
}

test("parseTaskReminderSyncVersion reads the task sync version from the job idempotency key", () => {
  assert.equal(parseTaskReminderSyncVersion("task:user:offset_60:v7"), 7);
  assert.equal(parseTaskReminderSyncVersion("task:user:offset_60"), null);
});

test("task deadline notification stays visible when it still matches the live task state", () => {
  assert.equal(isTaskDeadlineNotificationStale(buildNotification()), false);
});

test("task deadline notification becomes stale when the task is deleted", () => {
  const notification = buildNotification({
    task: {
      ...buildNotification().task,
      deletedAt: new Date("2026-03-13T19:20:00.000Z"),
    },
  });

  assert.equal(isTaskDeadlineNotificationStale(notification), true);
});

test("task deadline notification becomes stale when the task is completed", () => {
  const notification = buildNotification({
    task: {
      ...buildNotification().task,
      status: "completed",
    },
  });

  assert.equal(isTaskDeadlineNotificationStale(notification), true);
});

test("task deadline notification becomes stale when the task is reassigned", () => {
  const notification = buildNotification({
    task: {
      ...buildNotification().task,
      assignedUserId: "user_2",
    },
  });

  assert.equal(isTaskDeadlineNotificationStale(notification), true);
});

test("task deadline notification becomes stale when the task sync version moves past the reminder job", () => {
  const notification = buildNotification({
    task: {
      ...buildNotification().task,
      syncVersion: 3,
    },
  });

  assert.equal(isTaskDeadlineNotificationStale(notification), true);
});

test("task deadline notification becomes stale when the task due date changed after the notification was created", () => {
  const notification = buildNotification({
    task: {
      ...buildNotification().task,
      dueAt: new Date("2026-03-13T20:15:41.471Z"),
    },
  });

  assert.equal(isTaskDeadlineNotificationStale(notification), true);
});

test("task deadline notification becomes stale when the reminder job was canceled", () => {
  const notification = buildNotification({
    taskReminderJob: {
      ...buildNotification().taskReminderJob,
      status: "canceled",
    },
  });

  assert.equal(isTaskDeadlineNotificationStale(notification), true);
});

test("task deadline notification becomes stale when the reminder payload is missing its live task link", () => {
  const notification = buildNotification({
    taskReminderJob: null,
  });

  assert.equal(isTaskDeadlineNotificationStale(notification), true);
});
