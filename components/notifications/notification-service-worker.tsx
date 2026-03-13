"use client";

import { useEffect } from "react";
import { getClientNotificationFeatureFlags } from "@/lib/notifications/feature-flags";
import { registerNotificationServiceWorker } from "@/lib/notifications/browser";

export function NotificationServiceWorker() {
  useEffect(() => {
    if (!getClientNotificationFeatureFlags().webPush) {
      return;
    }

    registerNotificationServiceWorker().catch((error) => {
      console.warn("[notifications] Failed to register service worker:", error);
    });
  }, []);

  return null;
}

