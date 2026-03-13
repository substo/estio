"use client";

const SERVICE_WORKER_PATH = "/sw.js";

function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const base64 = normalized + padding;
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function detectBrowserName(userAgent: string) {
  const agent = userAgent.toLowerCase();
  if (agent.includes("edg/")) return "Edge";
  if (agent.includes("chrome/") && !agent.includes("edg/")) return "Chrome";
  if (agent.includes("safari/") && !agent.includes("chrome/")) return "Safari";
  if (agent.includes("firefox/")) return "Firefox";
  return "Browser";
}

export function areBrowserNotificationsSupported() {
  return (
    typeof window !== "undefined"
    && typeof navigator !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window
  );
}

export function getBrowserNotificationPermission() {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported" as const;
  }

  return Notification.permission;
}

export async function registerNotificationServiceWorker() {
  if (!areBrowserNotificationsSupported()) {
    return null;
  }

  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH, {
    scope: "/",
    updateViaCache: "none",
  });

  return registration;
}

export async function subscribeCurrentBrowserToPush(publicKey: string) {
  if (!areBrowserNotificationsSupported()) {
    return {
      success: false as const,
      error: "This browser does not support push notifications.",
    };
  }

  if (!publicKey) {
    return {
      success: false as const,
      error: "Web push is not configured for this environment.",
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return {
      success: false as const,
      error: permission === "denied"
        ? "Browser notifications are blocked for this site."
        : "Browser notifications were not enabled.",
    };
  }

  await registerNotificationServiceWorker();
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(publicKey),
    });
  }

  const browser = detectBrowserName(navigator.userAgent || "");
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    || navigator.platform
    || "Unknown";

  return {
    success: true as const,
    subscription: subscription.toJSON(),
    browser,
    platform,
    deviceLabel: `${browser} on ${platform}`,
    userAgent: navigator.userAgent || null,
  };
}

export async function unsubscribeCurrentBrowserFromPush() {
  if (!areBrowserNotificationsSupported()) {
    return {
      success: false as const,
      error: "This browser does not support push notifications.",
    };
  }

  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) {
    return {
      success: true as const,
      endpoint: null,
      unsubscribed: false,
    };
  }

  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return {
      success: true as const,
      endpoint: null,
      unsubscribed: false,
    };
  }

  const endpoint = subscription.endpoint;
  const unsubscribed = await subscription.unsubscribe();
  return {
    success: true as const,
    endpoint,
    unsubscribed,
  };
}
