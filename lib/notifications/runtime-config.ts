import { getNotificationFeatureFlags, type NotificationFeatureFlags } from "./feature-flags.ts";
import { getWebPushPublicKey, isWebPushConfigured } from "./push.ts";

export function getRuntimeNotificationFeatureFlags(): NotificationFeatureFlags {
  const featureFlags = getNotificationFeatureFlags();
  if (!featureFlags.webPush) {
    return featureFlags;
  }

  return {
    ...featureFlags,
    webPush: isWebPushConfigured(),
  };
}

export function getRuntimeWebPushPublicKey() {
  return isWebPushConfigured() ? getWebPushPublicKey() : "";
}
