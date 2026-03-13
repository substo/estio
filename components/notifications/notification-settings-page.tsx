"use client";

import Link from "next/link";
import { ArrowUpRight, BellRing, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NotificationCurrentBrowserCard } from "@/components/notifications/notification-current-browser-card";
import { NotificationDevicesCard } from "@/components/notifications/notification-devices-card";
import { NotificationPreferencesCard } from "@/components/notifications/notification-preferences-card";
import {
  type NotificationFeatureFlagsState,
  type NotificationPreferenceDraft,
  type NotificationSubscriptionRecord,
  useNotificationPreferences,
} from "@/components/notifications/use-notification-preferences";

type NotificationSettingsPageProps = {
  initialFeatureFlags?: NotificationFeatureFlagsState | null;
  initialPreference?: Partial<NotificationPreferenceDraft> | null;
  initialSubscriptions?: NotificationSubscriptionRecord[] | null;
};

export function NotificationSettingsPage({
  initialFeatureFlags,
  initialPreference,
  initialSubscriptions,
}: NotificationSettingsPageProps) {
  const notificationState = useNotificationPreferences({
    initialFeatureFlags,
    initialPreference,
    initialSubscriptions,
  });

  if (notificationState.featureFlags.reminderUi === false) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications & Reminders</h1>
          <p className="text-muted-foreground">
            User notification settings are disabled for this environment.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Notifications & Reminders</h1>
        <p className="text-muted-foreground">
          Manage how task deadline reminders reach you. Use the bell for inbox/history and this page for persistent settings.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <div className="space-y-6">
          <NotificationPreferencesCard
            draft={notificationState.draft}
            setDraft={notificationState.setDraft}
            toggleOffset={notificationState.toggleOffset}
            savePreferences={notificationState.savePreferences}
            savingPreferences={notificationState.savingPreferences}
            featureFlags={notificationState.featureFlags}
          />

          <NotificationDevicesCard
            subscriptions={notificationState.subscriptions}
            currentBrowserEndpoint={notificationState.currentBrowserEndpoint}
            revokingEndpoint={notificationState.revokingEndpoint}
            onRevoke={notificationState.revokeSubscription}
          />
        </div>

        <div className="space-y-6">
          <NotificationCurrentBrowserCard
            featureFlags={notificationState.featureFlags}
            browserSupported={notificationState.browserSupported}
            pushPermission={notificationState.pushPermission}
            pushEnabledForCurrentBrowser={notificationState.pushEnabledForCurrentBrowser}
            activePushDeviceCount={notificationState.activePushDeviceCount}
            currentBrowserSubscription={notificationState.currentBrowserSubscription}
            managingBrowserPush={notificationState.managingBrowserPush}
            onEnable={notificationState.enableCurrentBrowserPush}
            onDisable={notificationState.disableCurrentBrowserPush}
          />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <BellRing className="h-5 w-5 text-slate-500" />
                How Reminders Work
              </CardTitle>
              <CardDescription>
                The current user-level reminder model for this workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="rounded-md border p-3">
                Only tasks assigned to you are eligible for your reminders.
              </div>
              <div className="rounded-md border p-3">
                A task must be open, assigned, and have a due date before reminder jobs are scheduled.
              </div>
              <div className="rounded-md border p-3">
                The bell remains your inbox and quick-action surface. This page is the source of truth for notification settings.
              </div>

              <Button variant="outline" className="w-full" asChild>
                <Link href="/admin/conversations?view=tasks">
                  <CheckSquare className="mr-2 h-4 w-4" />
                  Open task workspace
                  <ArrowUpRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
