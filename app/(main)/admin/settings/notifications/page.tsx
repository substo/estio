import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { NotificationSettingsPage } from "@/components/notifications/notification-settings-page";
import {
  getCurrentUserTaskReminderPreference,
  listCurrentUserWebPushSubscriptions,
} from "@/lib/notifications/server";

export default async function UserNotificationSettingsPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const [preferenceResult, subscriptions] = await Promise.all([
    getCurrentUserTaskReminderPreference(),
    listCurrentUserWebPushSubscriptions(),
  ]);

  return (
    <div className="mx-auto w-full max-w-7xl p-6">
      <NotificationSettingsPage
        initialFeatureFlags={preferenceResult.featureFlags}
        initialPreference={{
          enabled: preferenceResult.preference.enabled,
          inAppEnabled: preferenceResult.preference.inAppEnabled,
          webPushEnabled: preferenceResult.preference.webPushEnabled,
          defaultOffsets: preferenceResult.preference.defaultOffsets,
          quietHoursEnabled: preferenceResult.preference.quietHoursEnabled,
          quietHoursStartHour: preferenceResult.preference.quietHoursStartHour,
          quietHoursEndHour: preferenceResult.preference.quietHoursEndHour,
        }}
        initialSubscriptions={subscriptions.map((subscription) => ({
          id: subscription.id,
          endpoint: subscription.endpoint,
          status: subscription.status,
          deviceLabel: subscription.deviceLabel,
          browser: subscription.browser,
          platform: subscription.platform,
          expiration: subscription.expiration?.toISOString() || null,
          updatedAt: subscription.updatedAt.toISOString(),
          lastSuccessAt: subscription.lastSuccessAt?.toISOString() || null,
          lastFailureAt: subscription.lastFailureAt?.toISOString() || null,
          failureCount: subscription.failureCount,
        }))}
      />
    </div>
  );
}
