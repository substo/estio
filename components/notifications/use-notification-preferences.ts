"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  getTaskReminderPreferenceAction,
  updateTaskReminderPreferenceAction,
} from "@/app/(main)/admin/notifications/actions";
import {
  areBrowserNotificationsSupported,
  getBrowserNotificationPermission,
  subscribeCurrentBrowserToPush,
  unsubscribeCurrentBrowserFromPush,
} from "@/lib/notifications/browser";
import { normalizeReminderOffsets } from "@/lib/tasks/reminder-config";

export type NotificationFeatureFlagsState = {
  reminderUi?: boolean;
  reminderCron?: boolean;
  notificationSse?: boolean;
  webPush?: boolean;
};

export type NotificationPreferenceDraft = {
  enabled: boolean;
  inAppEnabled: boolean;
  webPushEnabled: boolean;
  defaultOffsets: number[];
  quietHoursEnabled: boolean;
  quietHoursStartHour: number;
  quietHoursEndHour: number;
};

export type NotificationSubscriptionRecord = {
  id: string;
  endpoint: string;
  status: string;
  deviceLabel?: string | null;
  browser?: string | null;
  platform?: string | null;
  expiration?: string | Date | null;
  updatedAt?: string | Date | null;
  lastSuccessAt?: string | Date | null;
  lastFailureAt?: string | Date | null;
  failureCount?: number | null;
};

const EMPTY_PREFERENCE: NotificationPreferenceDraft = {
  enabled: true,
  inAppEnabled: true,
  webPushEnabled: true,
  defaultOffsets: [1440, 60, 0],
  quietHoursEnabled: true,
  quietHoursStartHour: 21,
  quietHoursEndHour: 8,
};

type SubscriptionResponse = {
  success?: boolean;
  featureFlags?: NotificationFeatureFlagsState;
  publicKey?: string;
  subscriptions?: NotificationSubscriptionRecord[];
  error?: string;
};

function buildDraftFromPreference(preference: any): NotificationPreferenceDraft {
  return {
    enabled: preference?.enabled ?? true,
    inAppEnabled: preference?.inAppEnabled ?? true,
    webPushEnabled: preference?.webPushEnabled ?? true,
    defaultOffsets: normalizeReminderOffsets(preference?.defaultOffsets),
    quietHoursEnabled: preference?.quietHoursEnabled ?? true,
    quietHoursStartHour: Number(preference?.quietHoursStartHour ?? 21),
    quietHoursEndHour: Number(preference?.quietHoursEndHour ?? 8),
  };
}

async function fetchSubscriptionState(): Promise<SubscriptionResponse | null> {
  try {
    const response = await fetch("/api/notifications/subscriptions", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return payload;
    }

    return payload;
  } catch (error) {
    console.error("[notifications] Failed to fetch subscription state:", error);
    return null;
  }
}

export function useNotificationPreferences(options?: {
  initialPreference?: Partial<NotificationPreferenceDraft> | null;
  initialFeatureFlags?: NotificationFeatureFlagsState | null;
  initialSubscriptions?: NotificationSubscriptionRecord[] | null;
}) {
  const [featureFlags, setFeatureFlags] = useState<NotificationFeatureFlagsState>(
    options?.initialFeatureFlags || {}
  );
  const [draft, setDraft] = useState<NotificationPreferenceDraft>(
    buildDraftFromPreference(options?.initialPreference)
  );
  const [subscriptions, setSubscriptions] = useState<NotificationSubscriptionRecord[]>(
    Array.isArray(options?.initialSubscriptions) ? options!.initialSubscriptions! : []
  );
  const [settingsLoading, setSettingsLoading] = useState(
    !options?.initialPreference && !options?.initialSubscriptions
  );
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [managingBrowserPush, setManagingBrowserPush] = useState(false);
  const [revokingEndpoint, setRevokingEndpoint] = useState<string | null>(null);
  const [pushPermission, setPushPermission] = useState<string>("unsupported");
  const [currentBrowserEndpoint, setCurrentBrowserEndpoint] = useState<string | null>(null);

  const browserSupported = areBrowserNotificationsSupported();

  const refreshBrowserState = useCallback(async () => {
    setPushPermission(getBrowserNotificationPermission());

    if (!browserSupported) {
      setCurrentBrowserEndpoint(null);
      return null;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const currentSubscription = registration
        ? await registration.pushManager.getSubscription()
        : null;
      const endpoint = currentSubscription?.endpoint || null;
      setCurrentBrowserEndpoint(endpoint);
      return endpoint;
    } catch (error) {
      console.warn("[notifications] Failed to inspect current browser subscription:", error);
      setCurrentBrowserEndpoint(null);
      return null;
    }
  }, [browserSupported]);

  const refreshSettings = useCallback(async (showSpinner = false) => {
    if (showSpinner) setSettingsLoading(true);

    try {
      const [preferenceResult, subscriptionResult] = await Promise.all([
        getTaskReminderPreferenceAction(),
        fetchSubscriptionState(),
      ]);

      if (preferenceResult?.featureFlags || subscriptionResult?.featureFlags) {
        setFeatureFlags({
          ...(preferenceResult?.featureFlags || {}),
          ...(subscriptionResult?.featureFlags || {}),
        });
      }

      if (preferenceResult?.preference) {
        setDraft(buildDraftFromPreference(preferenceResult.preference));
      }

      if (Array.isArray(subscriptionResult?.subscriptions)) {
        setSubscriptions(subscriptionResult.subscriptions);
      }

      await refreshBrowserState();
    } catch (error) {
      console.error("[notifications] Failed to refresh notification preferences:", error);
    } finally {
      if (showSpinner) setSettingsLoading(false);
    }
  }, [refreshBrowserState]);

  useEffect(() => {
    void refreshSettings(!options?.initialPreference && !options?.initialSubscriptions);
  }, [options?.initialPreference, options?.initialSubscriptions, refreshSettings]);

  const activePushDeviceCount = useMemo(
    () => subscriptions.filter((subscription) => String(subscription.status || "").toLowerCase() === "active").length,
    [subscriptions]
  );

  const currentBrowserSubscription = useMemo(
    () => (
      currentBrowserEndpoint
        ? subscriptions.find((subscription) => subscription.endpoint === currentBrowserEndpoint) || null
        : null
    ),
    [currentBrowserEndpoint, subscriptions]
  );

  const pushEnabledForCurrentBrowser = useMemo(
    () => (
      !!currentBrowserEndpoint
      && subscriptions.some((subscription) => (
        subscription.endpoint === currentBrowserEndpoint
        && String(subscription.status || "").toLowerCase() === "active"
      ))
    ),
    [currentBrowserEndpoint, subscriptions]
  );

  const toggleOffset = useCallback((offset: number, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      defaultOffsets: checked
        ? normalizeReminderOffsets([...current.defaultOffsets, offset])
        : current.defaultOffsets.filter((value) => value !== offset),
    }));
  }, []);

  const savePreferences = useCallback(async () => {
    setSavingPreferences(true);

    try {
      const result = await updateTaskReminderPreferenceAction({
        enabled: draft.enabled,
        inAppEnabled: draft.inAppEnabled,
        webPushEnabled: draft.webPushEnabled,
        defaultOffsets: draft.defaultOffsets,
        quietHoursEnabled: draft.quietHoursEnabled,
        quietHoursStartHour: draft.quietHoursStartHour,
        quietHoursEndHour: draft.quietHoursEndHour,
      });

      setDraft(buildDraftFromPreference(result.preference));
      toast.success("Notification settings saved");
      await refreshSettings(false);
      return { success: true as const };
    } catch (error: any) {
      console.error("[notifications] Failed to save notification preferences:", error);
      toast.error(error?.message || "Failed to save notification settings");
      return { success: false as const, error: error?.message || "Failed to save notification settings" };
    } finally {
      setSavingPreferences(false);
    }
  }, [draft, refreshSettings]);

  const enableCurrentBrowserPush = useCallback(async () => {
    setManagingBrowserPush(true);

    try {
      const subscriptionState = await fetchSubscriptionState();
      if (!subscriptionState?.success) {
        toast.error(String(subscriptionState?.error || "Failed to load push configuration"));
        return { success: false as const };
      }

      if (subscriptionState.featureFlags) {
        setFeatureFlags((current) => ({
          ...current,
          ...subscriptionState.featureFlags,
        }));
      }

      if (subscriptionState.featureFlags?.webPush === false) {
        toast.message("Browser push is disabled for this environment.");
        return { success: false as const };
      }

      const subscriptionResult = await subscribeCurrentBrowserToPush(String(subscriptionState.publicKey || ""));
      if (!subscriptionResult.success) {
        toast.error(subscriptionResult.error);
        await refreshBrowserState();
        return { success: false as const };
      }

      const saveResponse = await fetch("/api/notifications/subscriptions", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...subscriptionResult.subscription,
          browser: subscriptionResult.browser,
          platform: subscriptionResult.platform,
          deviceLabel: subscriptionResult.deviceLabel,
          userAgent: subscriptionResult.userAgent,
        }),
      });

      const savePayload = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok || !savePayload?.success) {
        toast.error(String(savePayload?.error || "Failed to save this browser subscription"));
        return { success: false as const };
      }

      toast.success("Browser notifications enabled");
      await refreshSettings(false);
      return { success: true as const };
    } catch (error: any) {
      console.error("[notifications] Failed to enable browser notifications:", error);
      toast.error(error?.message || "Failed to enable browser notifications");
      return { success: false as const, error: error?.message };
    } finally {
      setManagingBrowserPush(false);
    }
  }, [refreshBrowserState, refreshSettings]);

  const disableCurrentBrowserPush = useCallback(async () => {
    setManagingBrowserPush(true);

    try {
      const result = await unsubscribeCurrentBrowserFromPush();
      if (!result.success) {
        toast.error(result.error);
        return { success: false as const };
      }

      if (result.endpoint) {
        await fetch("/api/notifications/subscriptions", {
          method: "DELETE",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ endpoint: result.endpoint }),
        });
      }

      toast.success("Browser notifications disabled");
      await refreshSettings(false);
      return { success: true as const };
    } catch (error: any) {
      console.error("[notifications] Failed to disable browser notifications:", error);
      toast.error(error?.message || "Failed to disable browser notifications");
      return { success: false as const, error: error?.message };
    } finally {
      setManagingBrowserPush(false);
    }
  }, [refreshSettings]);

  const revokeSubscription = useCallback(async (endpoint: string) => {
    const trimmedEndpoint = String(endpoint || "").trim();
    if (!trimmedEndpoint) return { success: false as const };

    setRevokingEndpoint(trimmedEndpoint);

    try {
      if (trimmedEndpoint === currentBrowserEndpoint) {
        await unsubscribeCurrentBrowserFromPush();
      }

      const response = await fetch("/api/notifications/subscriptions", {
        method: "DELETE",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ endpoint: trimmedEndpoint }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload?.success === false) {
        toast.error(String(payload?.error || "Failed to revoke device"));
        return { success: false as const };
      }

      toast.success("Device subscription revoked");
      await refreshSettings(false);
      return { success: true as const };
    } catch (error: any) {
      console.error("[notifications] Failed to revoke browser subscription:", error);
      toast.error(error?.message || "Failed to revoke device");
      return { success: false as const, error: error?.message };
    } finally {
      setRevokingEndpoint(null);
    }
  }, [currentBrowserEndpoint, refreshSettings]);

  return {
    featureFlags,
    draft,
    setDraft,
    subscriptions,
    settingsLoading,
    savingPreferences,
    managingBrowserPush,
    revokingEndpoint,
    browserSupported,
    pushPermission,
    currentBrowserEndpoint,
    currentBrowserSubscription,
    pushEnabledForCurrentBrowser,
    activePushDeviceCount,
    toggleOffset,
    refreshSettings,
    savePreferences,
    enableCurrentBrowserPush,
    disableCurrentBrowserPush,
    revokeSubscription,
  };
}
