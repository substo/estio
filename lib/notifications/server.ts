import db from '@/lib/db';
import { Prisma } from '@prisma/client';
import { auth } from '@clerk/nextjs/server';
import { getRuntimeNotificationFeatureFlags } from '@/lib/notifications/runtime-config';
import { DEFAULT_TASK_REMINDER_OFFSETS_MINUTES, normalizeReminderOffsets } from '@/lib/tasks/reminder-config';
import { rebuildTaskReminderJobsForAssignee } from '@/lib/tasks/reminders';

function trimToNull(value: unknown) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function toNullableJsonInput(value: Prisma.InputJsonValue | Prisma.JsonValue | Record<string, unknown> | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

export async function getCurrentDbUserIdOrThrow() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    throw new Error('Unauthorized');
  }

  const user = await db.user.findUnique({
    where: { clerkId: clerkUserId },
    select: { id: true },
  });

  if (!user?.id) {
    throw new Error('User not found');
  }

  return user.id;
}

export async function getCurrentUserNotificationSnapshot(options?: {
  limit?: number;
  unreadOnly?: boolean;
}) {
  const dbUserId = await getCurrentDbUserIdOrThrow();
  const flags = getRuntimeNotificationFeatureFlags();
  const take = Math.min(Math.max(Number(options?.limit || 20), 1), 100);
  const unreadOnly = !!options?.unreadOnly;

  const [unreadCount, notifications] = await Promise.all([
    db.userNotification.count({
      where: {
        userId: dbUserId,
        readAt: null,
      },
    }),
    db.userNotification.findMany({
      where: {
        userId: dbUserId,
        ...(unreadOnly ? { readAt: null } : {}),
      },
      orderBy: [
        { readAt: 'asc' },
        { createdAt: 'desc' },
      ],
      take,
      include: {
        task: {
          select: {
            id: true,
            title: true,
            status: true,
            dueAt: true,
            priority: true,
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
        deliveries: {
          select: {
            channel: true,
            status: true,
            deliveredAt: true,
            lastAttemptAt: true,
            lastError: true,
            attemptCount: true,
          },
        },
      },
    }),
  ]);

  return {
    featureFlags: flags,
    unreadCount,
    notifications,
  };
}

export async function markUserNotificationRead(notificationId: string, options?: { clicked?: boolean }) {
  const dbUserId = await getCurrentDbUserIdOrThrow();
  const id = String(notificationId || '').trim();
  if (!id) {
    return { success: false as const, error: 'Notification ID is required' };
  }

  const updated = await db.userNotification.updateMany({
    where: {
      id,
      userId: dbUserId,
    },
    data: {
      readAt: new Date(),
      ...(options?.clicked ? { clickedAt: new Date() } : {}),
    },
  });

  return { success: updated.count > 0 };
}

export async function markAllUserNotificationsRead() {
  const dbUserId = await getCurrentDbUserIdOrThrow();
  const updated = await db.userNotification.updateMany({
    where: {
      userId: dbUserId,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });

  return { success: true as const, count: updated.count };
}

export async function getCurrentUserTaskReminderPreference() {
  const dbUserId = await getCurrentDbUserIdOrThrow();
  const flags = getRuntimeNotificationFeatureFlags();

  const preference = await db.userTaskReminderPreference.upsert({
    where: { userId: dbUserId },
    update: {},
    create: {
      userId: dbUserId,
      defaultOffsets: [...DEFAULT_TASK_REMINDER_OFFSETS_MINUTES],
    },
  });

  await rebuildTaskReminderJobsForAssignee(dbUserId);

  return {
    featureFlags: flags,
    preference: {
      ...preference,
      defaultOffsets: normalizeReminderOffsets(preference.defaultOffsets),
    },
  };
}

export async function updateCurrentUserTaskReminderPreference(input: {
  enabled?: boolean;
  inAppEnabled?: boolean;
  webPushEnabled?: boolean;
  defaultOffsets?: number[] | null;
  quietHoursEnabled?: boolean;
  quietHoursStartHour?: number;
  quietHoursEndHour?: number;
}) {
  const dbUserId = await getCurrentDbUserIdOrThrow();
  const defaultOffsets = input.defaultOffsets === undefined
    ? undefined
    : normalizeReminderOffsets(input.defaultOffsets);

  const preference = await db.userTaskReminderPreference.upsert({
    where: { userId: dbUserId },
    update: {
      ...(input.enabled !== undefined ? { enabled: !!input.enabled } : {}),
      ...(input.inAppEnabled !== undefined ? { inAppEnabled: !!input.inAppEnabled } : {}),
      ...(input.webPushEnabled !== undefined ? { webPushEnabled: !!input.webPushEnabled } : {}),
      ...(defaultOffsets !== undefined ? { defaultOffsets } : {}),
      ...(input.quietHoursEnabled !== undefined ? { quietHoursEnabled: !!input.quietHoursEnabled } : {}),
      ...(input.quietHoursStartHour !== undefined ? { quietHoursStartHour: Math.max(0, Math.min(23, Number(input.quietHoursStartHour))) } : {}),
      ...(input.quietHoursEndHour !== undefined ? { quietHoursEndHour: Math.max(0, Math.min(23, Number(input.quietHoursEndHour))) } : {}),
    },
    create: {
      userId: dbUserId,
      enabled: input.enabled ?? true,
      inAppEnabled: input.inAppEnabled ?? true,
      webPushEnabled: input.webPushEnabled ?? true,
      defaultOffsets: defaultOffsets ?? [...DEFAULT_TASK_REMINDER_OFFSETS_MINUTES],
      quietHoursEnabled: input.quietHoursEnabled ?? true,
      quietHoursStartHour: Math.max(0, Math.min(23, Number(input.quietHoursStartHour ?? 21))),
      quietHoursEndHour: Math.max(0, Math.min(23, Number(input.quietHoursEndHour ?? 8))),
    },
  });

  return {
    success: true as const,
    preference: {
      ...preference,
      defaultOffsets: normalizeReminderOffsets(preference.defaultOffsets),
    },
  };
}

export async function listCurrentUserWebPushSubscriptions() {
  const dbUserId = await getCurrentDbUserIdOrThrow();
  return db.webPushSubscription.findMany({
    where: {
      userId: dbUserId,
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      endpoint: true,
      status: true,
      deviceLabel: true,
      browser: true,
      platform: true,
      expiration: true,
      updatedAt: true,
      lastSuccessAt: true,
      lastFailureAt: true,
      failureCount: true,
    },
  });
}

export async function upsertWebPushSubscriptionForUser(args: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expiration?: number | null;
  deviceLabel?: string | null;
  browser?: string | null;
  platform?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  return db.webPushSubscription.upsert({
    where: {
      endpoint: args.endpoint,
    },
    update: {
      userId: args.userId,
      p256dh: args.p256dh,
      auth: args.auth,
      status: 'active',
      expiration: typeof args.expiration === 'number' && Number.isFinite(args.expiration)
        ? new Date(args.expiration)
        : null,
      deviceLabel: trimToNull(args.deviceLabel),
      browser: trimToNull(args.browser),
      platform: trimToNull(args.platform),
      userAgent: trimToNull(args.userAgent),
      lastUsedAt: new Date(),
      metadata: toNullableJsonInput(args.metadata ?? null),
      failureCount: 0,
      lastFailureAt: null,
    },
    create: {
      userId: args.userId,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      status: 'active',
      expiration: typeof args.expiration === 'number' && Number.isFinite(args.expiration)
        ? new Date(args.expiration)
        : null,
      deviceLabel: trimToNull(args.deviceLabel),
      browser: trimToNull(args.browser),
      platform: trimToNull(args.platform),
      userAgent: trimToNull(args.userAgent),
      lastUsedAt: new Date(),
      metadata: toNullableJsonInput(args.metadata ?? null),
    },
  });
}

export async function deactivateWebPushSubscriptionForUser(args: {
  userId: string;
  endpoint: string;
}) {
  const endpoint = String(args.endpoint || '').trim();
  if (!endpoint) return { success: false as const, count: 0 };

  const updated = await db.webPushSubscription.updateMany({
    where: {
      userId: args.userId,
      endpoint,
    },
    data: {
      status: 'inactive',
      lastFailureAt: new Date(),
    },
  });

  return { success: true as const, count: updated.count };
}
