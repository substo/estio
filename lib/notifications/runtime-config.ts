import { getNotificationFeatureFlags, type NotificationFeatureFlags } from "./feature-flags";
import { getWebPushPublicKey, isWebPushConfigured } from "./push";

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
