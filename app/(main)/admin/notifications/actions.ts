'use server';

import { assertCrmActionAllowed } from "@/lib/auth/crm-action-guard";

import {
  getCurrentUserNotificationSnapshot,
  getCurrentUserTaskReminderPreference,
  markAllUserNotificationsRead,
  markUserNotificationRead,
  updateCurrentUserTaskReminderPreference,
} from '@/lib/notifications/server';

export async function getNotificationSnapshot(limit?: number, unreadOnly?: boolean) {
    await assertCrmActionAllowed("notifications/actions.ts", "getNotificationSnapshot");
  return getCurrentUserNotificationSnapshot({ limit, unreadOnly });
}

export async function markNotificationReadAction(notificationId: string, clicked?: boolean) {
    await assertCrmActionAllowed("notifications/actions.ts", "markNotificationReadAction");
  return markUserNotificationRead(notificationId, { clicked });
}

export async function markAllNotificationsReadAction() {
    await assertCrmActionAllowed("notifications/actions.ts", "markAllNotificationsReadAction");
  return markAllUserNotificationsRead();
}

export async function getTaskReminderPreferenceAction() {
    await assertCrmActionAllowed("notifications/actions.ts", "getTaskReminderPreferenceAction");
  return getCurrentUserTaskReminderPreference();
}

export async function updateTaskReminderPreferenceAction(input: {
  enabled?: boolean;
  inAppEnabled?: boolean;
  webPushEnabled?: boolean;
  defaultOffsets?: number[] | null;
  quietHoursEnabled?: boolean;
  quietHoursStartHour?: number;
  quietHoursEndHour?: number;
}) {
    await assertCrmActionAllowed("notifications/actions.ts", "updateTaskReminderPreferenceAction");
  return updateCurrentUserTaskReminderPreference(input);
}
