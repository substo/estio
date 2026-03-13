import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import db from '@/lib/db';
import { isWithinQuietHours } from '@/lib/ai/automation/config';
import { getNotificationFeatureFlags } from '@/lib/notifications/feature-flags';
import { sendWebPushNotification, isWebPushConfigured } from '@/lib/notifications/push';
import { publishNotificationRealtimeEvent } from '@/lib/realtime/notification-events';
import {
  DEFAULT_TASK_REMINDER_OFFSETS_MINUTES,
  normalizeReminderOffsets,
  reminderOffsetLabel,
} from '@/lib/tasks/reminder-config';
import { buildTaskReminderDeepLink } from '@/lib/tasks/reminder-links';

const MAX_REMINDER_ATTEMPTS = 6;
const STALE_PROCESSING_LOCK_MS = 5 * 60 * 1000;

export type TaskReminderEngineStats = {
  scanned: number;
  claimed: number;
  succeeded: number;
  failed: number;
  dead: number;
  skipped: number;
};

type ReminderTaskRecord = Prisma.ContactTaskGetPayload<{
  include: {
    location: {
      select: {
        id: true;
        timeZone: true;
      };
    };
    contact: {
      select: {
        id: true;
        name: true;
        email: true;
        phone: true;
      };
    };
    conversation: {
      select: {
        id: true;
        ghlConversationId: true;
      };
    };
    assignedUser: {
      select: {
        id: true;
        name: true;
        email: true;
        timeZone: true;
        taskReminderPreference: true;
      };
    };
  };
}>;

type ReminderJobRecord = Prisma.TaskReminderJobGetPayload<{
  include: {
    task: {
      include: {
        location: {
          select: {
            id: true;
            timeZone: true;
          };
        };
        contact: {
          select: {
            id: true;
            name: true;
            email: true;
            phone: true;
          };
        };
        conversation: {
          select: {
            id: true;
            ghlConversationId: true;
          };
        };
        assignedUser: {
          select: {
            id: true;
            name: true;
            email: true;
            timeZone: true;
            taskReminderPreference: true;
          };
        };
      };
    };
    user: {
      select: {
        id: true;
        name: true;
        email: true;
        timeZone: true;
        taskReminderPreference: true;
      };
    };
    notification: {
      include: {
        deliveries: true;
      };
    };
  };
}>;

type ReminderEligibilityResult = {
  eligible: boolean;
  reason?: string;
};

type DeliveryOutcome =
  | { status: 'success' }
  | { status: 'disabled' }
  | { status: 'retryable_error'; error: string }
  | { status: 'terminal_error'; error: string };

function normalizeError(error: unknown) {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function toNullableJsonInput(value: Prisma.InputJsonValue | Prisma.JsonValue | Record<string, unknown> | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function computeBackoffMs(attemptCount: number) {
  const exponent = Math.max(0, attemptCount - 1);
  const seconds = Math.min(30 * 60, Math.pow(2, exponent) * 30);
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(seconds * 1000 * jitter);
}

function parseReminderSyncVersion(idempotencyKey: string) {
  const match = String(idempotencyKey || '').match(/:v(\d+)$/);
  if (!match?.[1]) return null;
  const version = Number(match[1]);
  return Number.isFinite(version) ? version : null;
}

function isSupersededReminderJob(idempotencyKey: string, taskSyncVersion: number) {
  const version = parseReminderSyncVersion(idempotencyKey);
  if (!version) return false;
  return version < taskSyncVersion;
}

function getReminderTimezone(task: Pick<ReminderTaskRecord, 'location' | 'assignedUser'>) {
  return String(task.assignedUser?.timeZone || task.location?.timeZone || 'UTC');
}

function deferReminderFromQuietHours(date: Date, timezone: string, quietHours?: {
  enabled?: boolean | null;
  startHour?: number | null;
  endHour?: number | null;
} | null) {
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

function getTaskReminderEligibility(task: ReminderTaskRecord | ReminderJobRecord['task'] | null): ReminderEligibilityResult {
  if (!task) return { eligible: false, reason: 'missing_task' };
  if (task.deletedAt) return { eligible: false, reason: 'deleted' };
  if (String(task.status || '').toLowerCase() !== 'open') return { eligible: false, reason: 'not_open' };
  if (!task.assignedUserId || !task.assignedUser?.id) return { eligible: false, reason: 'missing_assignee' };
  if (!task.dueAt) return { eligible: false, reason: 'missing_due_at' };
  if (String(task.reminderMode || 'default').toLowerCase() === 'off') return { eligible: false, reason: 'reminders_disabled' };
  if (task.assignedUserId !== task.assignedUser.id) return { eligible: false, reason: 'assignee_mismatch' };

  const preference = task.assignedUser.taskReminderPreference;
  if (preference && !preference.enabled) {
    return { eligible: false, reason: 'user_preferences_disabled' };
  }

  return { eligible: true };
}

function getReminderOffsetsForTask(task: ReminderTaskRecord | ReminderJobRecord['task']) {
  if (String(task.reminderMode || 'default').toLowerCase() === 'custom') {
    return normalizeReminderOffsets(task.reminderOffsets);
  }

  return normalizeReminderOffsets(
    task.assignedUser?.taskReminderPreference?.defaultOffsets,
    DEFAULT_TASK_REMINDER_OFFSETS_MINUTES
  );
}

function buildReminderJobRows(task: ReminderTaskRecord) {
  const eligibility = getTaskReminderEligibility(task);
  if (!eligibility.eligible || !task.assignedUser?.id || !task.dueAt) {
    return [];
  }

  const timeZone = getReminderTimezone(task);
  const preference = task.assignedUser.taskReminderPreference;
  const offsets = getReminderOffsetsForTask(task);

  return offsets.map((offsetMinutes) => {
    const baseScheduledFor = new Date(task.dueAt!.getTime() - offsetMinutes * 60_000);
    const scheduledFor = deferReminderFromQuietHours(baseScheduledFor, timeZone, {
      enabled: preference?.quietHoursEnabled ?? true,
      startHour: preference?.quietHoursStartHour ?? 21,
      endHour: preference?.quietHoursEndHour ?? 8,
    });
    const slotKey = `offset_${offsetMinutes}`;

    return {
      taskId: task.id,
      userId: task.assignedUser!.id,
      locationId: task.locationId,
      slotKey,
      offsetMinutes,
      scheduledFor,
      status: 'pending',
      idempotencyKey: `${task.id}:${task.assignedUser!.id}:${slotKey}:v${task.syncVersion}`,
    } satisfies Prisma.TaskReminderJobCreateManyInput;
  });
}

function formatDueDate(date: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function buildReminderNotificationContent(job: ReminderJobRecord) {
  const dueAt = job.task.dueAt || new Date();
  const timeZone = getReminderTimezone(job.task);
  const dueLabel = formatDueDate(dueAt, timeZone);
  const contactName = String(job.task.contact?.name || job.task.contact?.email || job.task.contact?.phone || 'Contact').trim();
  const deepLinkUrl = buildTaskReminderDeepLink({
    taskId: job.taskId,
    conversationId: job.task.conversation?.ghlConversationId || null,
  });

  let title = `Task reminder: ${job.task.title}`;
  if (job.offsetMinutes === 0) {
    title = new Date() >= dueAt ? `Task overdue: ${job.task.title}` : `Task due now: ${job.task.title}`;
  }

  const body = `${contactName} • ${reminderOffsetLabel(job.offsetMinutes)} • Due ${dueLabel}`;

  return {
    title,
    body,
    deepLinkUrl,
    payload: {
      kind: 'task_deadline',
      taskId: job.taskId,
      contactId: job.task.contactId,
      conversationId: job.task.conversationId,
      locationId: job.locationId,
      dueAt: job.task.dueAt?.toISOString() || null,
      offsetMinutes: job.offsetMinutes,
      slotKey: job.slotKey,
    },
  };
}

async function upsertNotificationDelivery(args: {
  notificationId: string;
  channel: 'in_app' | 'web_push';
  status: 'delivered' | 'failed' | 'disabled';
  error?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const existing = await db.userNotificationDelivery.findUnique({
    where: {
      notificationId_channel: {
        notificationId: args.notificationId,
        channel: args.channel,
      },
    },
  });

  if (existing) {
    return db.userNotificationDelivery.update({
      where: { id: existing.id },
      data: {
        status: args.status,
      attemptCount: { increment: 1 },
      lastAttemptAt: new Date(),
      deliveredAt: args.status === 'delivered' ? (existing.deliveredAt || new Date()) : existing.deliveredAt,
      lastError: args.error || null,
      metadata: toNullableJsonInput(args.metadata ?? existing.metadata ?? null),
      },
    });
  }

  return db.userNotificationDelivery.create({
    data: {
      notificationId: args.notificationId,
      channel: args.channel,
      status: args.status,
      attemptCount: 1,
      lastAttemptAt: new Date(),
      deliveredAt: args.status === 'delivered' ? new Date() : null,
      lastError: args.error || null,
      metadata: toNullableJsonInput(args.metadata ?? null),
    },
  });
}

async function ensureTaskReminderNotification(job: ReminderJobRecord) {
  const content = buildReminderNotificationContent(job);
  return db.userNotification.upsert({
    where: {
      taskReminderJobId: job.id,
    },
    update: {
      userId: job.userId,
      locationId: job.locationId,
      type: 'task_deadline',
      title: content.title,
      body: content.body,
      deepLinkUrl: content.deepLinkUrl,
      taskId: job.taskId,
      contactId: job.task.contactId,
      conversationId: job.task.conversationId,
      payload: content.payload as Prisma.InputJsonValue,
    },
    create: {
      userId: job.userId,
      locationId: job.locationId,
      type: 'task_deadline',
      title: content.title,
      body: content.body,
      deepLinkUrl: content.deepLinkUrl,
      taskId: job.taskId,
      contactId: job.task.contactId,
      conversationId: job.task.conversationId,
      taskReminderJobId: job.id,
      payload: content.payload as Prisma.InputJsonValue,
    },
    include: {
      deliveries: true,
    },
  });
}

async function deliverInAppNotification(job: ReminderJobRecord, notification: Awaited<ReturnType<typeof ensureTaskReminderNotification>>): Promise<DeliveryOutcome> {
  const preference = job.user.taskReminderPreference;
  if (preference && !preference.inAppEnabled) {
    await upsertNotificationDelivery({
      notificationId: notification.id,
      channel: 'in_app',
      status: 'disabled',
    });
    return { status: 'disabled' };
  }

  const existing = notification.deliveries.find((item) => item.channel === 'in_app');
  await upsertNotificationDelivery({
    notificationId: notification.id,
    channel: 'in_app',
    status: 'delivered',
  });

  const flags = getNotificationFeatureFlags();
  if (flags.notificationSse && existing?.status !== 'delivered') {
    await publishNotificationRealtimeEvent({
      userId: job.userId,
      type: 'notification.created',
      payload: {
        notificationId: notification.id,
        title: notification.title,
        body: notification.body,
        deepLinkUrl: notification.deepLinkUrl,
        type: notification.type,
        taskId: notification.taskId,
        createdAt: notification.createdAt.toISOString(),
      },
    });
  }

  return { status: 'success' };
}

function getPushErrorStatusCode(error: unknown) {
  const candidate = error as any;
  if (typeof candidate?.statusCode === 'number') return candidate.statusCode;
  if (typeof candidate?.status === 'number') return candidate.status;
  if (typeof candidate?.response?.status === 'number') return candidate.response.status;
  return null;
}

function isRetryablePushError(error: unknown) {
  const status = getPushErrorStatusCode(error);
  if (status === null) return true;
  if (status === 404 || status === 410) return false;
  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) return true;
  if (status >= 400 && status < 500) return false;
  return true;
}

async function deliverWebPushNotification(job: ReminderJobRecord, notification: Awaited<ReturnType<typeof ensureTaskReminderNotification>>): Promise<DeliveryOutcome> {
  const preference = job.user.taskReminderPreference;
  const flags = getNotificationFeatureFlags();
  const existing = notification.deliveries.find((item) => item.channel === 'web_push');

  if (!flags.webPush || (preference && !preference.webPushEnabled)) {
    await upsertNotificationDelivery({
      notificationId: notification.id,
      channel: 'web_push',
      status: 'disabled',
      metadata: { reason: 'disabled_by_preferences' },
    });
    return { status: 'disabled' };
  }

  if (existing?.status === 'delivered') {
    return { status: 'success' };
  }

  if (!isWebPushConfigured()) {
    await upsertNotificationDelivery({
      notificationId: notification.id,
      channel: 'web_push',
      status: 'disabled',
      metadata: { reason: 'missing_vapid_configuration' },
    });
    return { status: 'disabled' };
  }

  const subscriptions = await db.webPushSubscription.findMany({
    where: {
      userId: job.userId,
      status: 'active',
    },
    select: {
      id: true,
      endpoint: true,
      p256dh: true,
      auth: true,
    },
  });

  if (subscriptions.length === 0) {
    await upsertNotificationDelivery({
      notificationId: notification.id,
      channel: 'web_push',
      status: 'disabled',
      metadata: { reason: 'no_active_subscriptions' },
    });
    return { status: 'disabled' };
  }

  const payload = {
    title: notification.title,
    body: notification.body,
    tag: `task-reminder:${job.taskId}`,
    url: notification.deepLinkUrl,
    requireInteraction: job.offsetMinutes === 0,
    data: {
      notificationId: notification.id,
      taskId: job.taskId,
      deepLinkUrl: notification.deepLinkUrl,
    },
  };

  let deliveredCount = 0;
  let transientFailure = false;
  let transientMessage = '';
  let inactiveCount = 0;

  for (const subscription of subscriptions) {
    try {
      await sendWebPushNotification(subscription, payload);
      deliveredCount += 1;
      await db.webPushSubscription.update({
        where: { id: subscription.id },
        data: {
          lastUsedAt: new Date(),
          lastSuccessAt: new Date(),
          failureCount: 0,
          lastFailureAt: null,
        },
      });
    } catch (error) {
      const errorMessage = normalizeError(error);
      const statusCode = getPushErrorStatusCode(error);

      if (statusCode === 404 || statusCode === 410) {
        inactiveCount += 1;
        await db.webPushSubscription.update({
          where: { id: subscription.id },
          data: {
            status: 'inactive',
            lastUsedAt: new Date(),
            lastFailureAt: new Date(),
            failureCount: { increment: 1 },
          },
        });
        continue;
      }

      transientFailure = isRetryablePushError(error);
      transientMessage = errorMessage;
      await db.webPushSubscription.update({
        where: { id: subscription.id },
        data: {
          lastUsedAt: new Date(),
          lastFailureAt: new Date(),
          failureCount: { increment: 1 },
        },
      });
      if (!transientFailure) {
        inactiveCount += 1;
      }
    }
  }

  if (deliveredCount > 0) {
    await upsertNotificationDelivery({
      notificationId: notification.id,
      channel: 'web_push',
      status: 'delivered',
      metadata: {
        subscriptionCount: subscriptions.length,
        deliveredCount,
        inactiveCount,
      },
    });
    return { status: 'success' };
  }

  if (!transientFailure) {
    await upsertNotificationDelivery({
      notificationId: notification.id,
      channel: 'web_push',
      status: 'disabled',
      error: transientMessage || null,
      metadata: {
        subscriptionCount: subscriptions.length,
        deliveredCount,
        inactiveCount,
      },
    });
    return { status: 'disabled' };
  }

  await upsertNotificationDelivery({
    notificationId: notification.id,
    channel: 'web_push',
    status: 'failed',
    error: transientMessage || 'Web push delivery failed',
    metadata: {
      subscriptionCount: subscriptions.length,
      deliveredCount,
      inactiveCount,
    },
  });

  return {
    status: 'retryable_error',
    error: transientMessage || 'Web push delivery failed',
  };
}

async function markTaskReminderJobTerminal(jobId: string, status: 'completed' | 'dead' | 'canceled', error?: string | null) {
  await db.taskReminderJob.update({
    where: { id: jobId },
    data: {
      status,
      processedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: error || null,
    },
  });
}

async function processSingleTaskReminderJob(jobId: string): Promise<'success' | 'failed' | 'dead' | 'skipped'> {
  const job = await db.taskReminderJob.findUnique({
    where: { id: jobId },
    include: {
      task: {
        include: {
          location: {
            select: {
              id: true,
              timeZone: true,
            },
          },
          contact: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          conversation: {
            select: {
              id: true,
              ghlConversationId: true,
            },
          },
          assignedUser: {
            select: {
              id: true,
              name: true,
              email: true,
              timeZone: true,
              taskReminderPreference: true,
            },
          },
        },
      },
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          timeZone: true,
          taskReminderPreference: true,
        },
      },
      notification: {
        include: {
          deliveries: true,
        },
      },
    },
  }) as ReminderJobRecord | null;

  if (!job) return 'skipped';
  if (isSupersededReminderJob(job.idempotencyKey, job.task.syncVersion)) {
    await markTaskReminderJobTerminal(job.id, 'canceled', 'Superseded by a newer task version');
    return 'skipped';
  }

  const eligibility = getTaskReminderEligibility(job.task);
  if (!eligibility.eligible) {
    await markTaskReminderJobTerminal(job.id, 'canceled', eligibility.reason || 'Task is no longer eligible');
    return 'skipped';
  }

  if (job.userId !== job.task.assignedUserId) {
    await markTaskReminderJobTerminal(job.id, 'canceled', 'Reminder recipient no longer matches the task assignee');
    return 'skipped';
  }

  try {
    const notification = await ensureTaskReminderNotification(job);
    const inApp = await deliverInAppNotification(job, notification);
    const webPush = await deliverWebPushNotification(job, notification);

    const retryableError = [inApp, webPush].find((item) => item.status === 'retryable_error') as Extract<DeliveryOutcome, { status: 'retryable_error' }> | undefined;
    const terminalError = [inApp, webPush].find((item) => item.status === 'terminal_error') as Extract<DeliveryOutcome, { status: 'terminal_error' }> | undefined;

    if (terminalError) {
      await markTaskReminderJobTerminal(job.id, 'dead', terminalError.error);
      return 'dead';
    }

    if (retryableError) {
      const shouldRetry = job.attemptCount < MAX_REMINDER_ATTEMPTS;
      if (!shouldRetry) {
        await markTaskReminderJobTerminal(job.id, 'dead', retryableError.error);
        return 'dead';
      }

      await db.taskReminderJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          scheduledFor: new Date(Date.now() + computeBackoffMs(job.attemptCount)),
          lockedAt: null,
          lockedBy: null,
          lastError: retryableError.error,
        },
      });
      return 'failed';
    }

    await markTaskReminderJobTerminal(job.id, 'completed');
    return 'success';
  } catch (error) {
    const message = normalizeError(error);
    const shouldRetry = job.attemptCount < MAX_REMINDER_ATTEMPTS;

    if (!shouldRetry) {
      await markTaskReminderJobTerminal(job.id, 'dead', message);
      return 'dead';
    }

    await db.taskReminderJob.update({
      where: { id: job.id },
      data: {
        status: 'failed',
        scheduledFor: new Date(Date.now() + computeBackoffMs(job.attemptCount)),
        lockedAt: null,
        lockedBy: null,
        lastError: message,
      },
    });
    return 'failed';
  }
}

export async function rebuildTaskReminderJobs(taskId: string) {
  const task = await db.contactTask.findUnique({
    where: { id: taskId },
    include: {
      location: {
        select: {
          id: true,
          timeZone: true,
        },
      },
      contact: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
        },
      },
      conversation: {
        select: {
          id: true,
          ghlConversationId: true,
        },
      },
      assignedUser: {
        select: {
          id: true,
          name: true,
          email: true,
          timeZone: true,
          taskReminderPreference: true,
        },
      },
    },
  }) as ReminderTaskRecord | null;

  if (!task) {
    return { success: false as const, count: 0, reason: 'task_not_found' };
  }

  await db.$transaction(async (tx) => {
    await tx.taskReminderJob.updateMany({
      where: {
        taskId: task.id,
        status: {
          in: ['pending', 'processing', 'failed'],
        },
      },
      data: {
        status: 'canceled',
        processedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: 'Canceled by task update',
      },
    });

    const rows = buildReminderJobRows(task);
    if (rows.length === 0) return;

    await tx.taskReminderJob.createMany({
      data: rows,
      skipDuplicates: true,
    });
  });

  const rows = buildReminderJobRows(task);
  return {
    success: true as const,
    count: rows.length,
    eligible: rows.length > 0,
  };
}

export async function rebuildTaskReminderJobsForAssignee(userId: string) {
  const tasks = await db.contactTask.findMany({
    where: {
      assignedUserId: userId,
      deletedAt: null,
      status: 'open',
    },
    select: { id: true },
  });

  for (const task of tasks) {
    await rebuildTaskReminderJobs(task.id);
  }

  return { success: true as const, count: tasks.length };
}

export async function processTaskReminderBatch(options?: {
  batchSize?: number;
  workerId?: string;
}): Promise<TaskReminderEngineStats> {
  const batchSize = Math.max(1, Math.min(Number(options?.batchSize || 25), 200));
  const workerId = String(options?.workerId || `task-reminder-${randomUUID()}`);
  const stats: TaskReminderEngineStats = {
    scanned: 0,
    claimed: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
    skipped: 0,
  };

  const now = new Date();

  await db.taskReminderJob.updateMany({
    where: {
      status: 'processing',
      lockedAt: {
        lt: new Date(Date.now() - STALE_PROCESSING_LOCK_MS),
      },
    },
    data: {
      status: 'pending',
      lockedAt: null,
      lockedBy: null,
      lastError: 'Recovered stale processing lock',
    },
  });

  const candidates = await db.taskReminderJob.findMany({
    where: {
      status: {
        in: ['pending', 'failed'],
      },
      scheduledFor: {
        lte: now,
      },
    },
    orderBy: [
      { scheduledFor: 'asc' },
      { createdAt: 'asc' },
    ],
    take: batchSize,
    select: { id: true },
  });

  stats.scanned = candidates.length;

  const claimedIds: string[] = [];
  for (const candidate of candidates) {
    const claimed = await db.taskReminderJob.updateMany({
      where: {
        id: candidate.id,
        status: {
          in: ['pending', 'failed'],
        },
      },
      data: {
        status: 'processing',
        lockedAt: new Date(),
        lockedBy: workerId,
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });

    if (claimed.count > 0) {
      claimedIds.push(candidate.id);
    }
  }

  stats.claimed = claimedIds.length;

  for (const jobId of claimedIds) {
    const result = await processSingleTaskReminderJob(jobId);
    if (result === 'success') stats.succeeded += 1;
    if (result === 'failed') stats.failed += 1;
    if (result === 'dead') stats.dead += 1;
    if (result === 'skipped') stats.skipped += 1;
  }

  return stats;
}
