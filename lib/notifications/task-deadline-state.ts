import type { Prisma } from "@prisma/client";

export type TaskDeadlineNotificationSnapshot = {
  id: string;
  userId: string;
  type: string;
  payload?: Prisma.JsonValue | null;
  task?: {
    deletedAt?: Date | null;
    status?: string | null;
    dueAt?: Date | null;
    assignedUserId?: string | null;
    syncVersion?: number | null;
    reminderMode?: string | null;
  } | null;
  taskReminderJob?: {
    idempotencyKey?: string | null;
    status?: string | null;
  } | null;
};

export function parseTaskReminderSyncVersion(idempotencyKey: string | null | undefined) {
  const match = String(idempotencyKey || "").match(/:v(\d+)$/);
  if (!match?.[1]) return null;
  const version = Number(match[1]);
  return Number.isFinite(version) ? version : null;
}

function normalizePayloadDueAt(payload: Prisma.JsonValue | null | undefined) {
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return null;

  const value = (payload as Record<string, unknown>).dueAt;
  if (typeof value !== "string") return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "invalid";
  }

  return parsed.toISOString();
}

export function isTaskDeadlineNotificationStale(notification: TaskDeadlineNotificationSnapshot) {
  if (notification.type !== "task_deadline") {
    return false;
  }

  const task = notification.task;
  if (!task) {
    return true;
  }

  if (task.deletedAt) return true;
  if (String(task.status || "").toLowerCase() !== "open") return true;
  if (!task.dueAt) return true;
  if (!task.assignedUserId || task.assignedUserId !== notification.userId) return true;
  if (String(task.reminderMode || "default").toLowerCase() === "off") return true;

  const taskReminderJob = notification.taskReminderJob;
  if (!taskReminderJob) {
    return true;
  }

  if (String(taskReminderJob.status || "").toLowerCase() === "canceled") {
    return true;
  }

  const jobSyncVersion = parseTaskReminderSyncVersion(taskReminderJob.idempotencyKey);
  if (jobSyncVersion !== null && Number(task.syncVersion || 0) > jobSyncVersion) {
    return true;
  }

  const payloadDueAt = normalizePayloadDueAt(notification.payload);
  if (payloadDueAt === "invalid") {
    return true;
  }
  if (payloadDueAt && task.dueAt.toISOString() !== payloadDueAt) {
    return true;
  }

  return false;
}
