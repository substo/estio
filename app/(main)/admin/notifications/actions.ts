'use server';

import {
  getCurrentUserNotificationSnapshot,
  getCurrentUserTaskReminderPreference,
  markAllUserNotificationsRead,
  markUserNotificationRead,
  updateCurrentUserTaskReminderPreference,
} from '@/lib/notifications/server';

export async function getNotificationSnapshot(limit?: number, unreadOnly?: boolean) {
  return getCurrentUserNotificationSnapshot({ limit, unreadOnly });
}

export async function markNotificationReadAction(notificationId: string, clicked?: boolean) {
  return markUserNotificationRead(notificationId, { clicked });
}

export async function markAllNotificationsReadAction() {
  return markAllUserNotificationsRead();
}

export async function getTaskReminderPreferenceAction() {
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
  return updateCurrentUserTaskReminderPreference(input);
}
