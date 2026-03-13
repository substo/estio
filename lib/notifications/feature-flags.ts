function readEnvFlag(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'on', 'yes'].includes(raw)) return true;
  if (['0', 'false', 'off', 'no'].includes(raw)) return false;
  return fallback;
}

export type NotificationFeatureFlags = {
  reminderUi: boolean;
  reminderCron: boolean;
  notificationSse: boolean;
  webPush: boolean;
};

export function getNotificationFeatureFlags(): NotificationFeatureFlags {
  return {
    reminderUi: readEnvFlag('TASK_REMINDERS_UI_ENABLED', true),
    reminderCron: readEnvFlag('TASK_REMINDERS_CRON_ENABLED', true),
    notificationSse: readEnvFlag('NOTIFICATIONS_SSE_ENABLED', true),
    webPush: readEnvFlag('WEB_PUSH_ENABLED', true),
  };
}

export function getClientNotificationFeatureFlags() {
  return {
    reminderUi: readEnvFlag('NEXT_PUBLIC_TASK_REMINDERS_UI_ENABLED', true),
    webPush: readEnvFlag('NEXT_PUBLIC_WEB_PUSH_ENABLED', true),
  };
}
