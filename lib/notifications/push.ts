import type { WebPushSubscription } from '@prisma/client';
import { getNotificationFeatureFlags } from './feature-flags.ts';

type WebPushPayload = {
  title: string;
  body?: string | null;
  tag?: string;
  url?: string | null;
  requireInteraction?: boolean;
  data?: Record<string, unknown>;
};

let vapidConfigured = false;

function getPublicKey() {
  return String(
    process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY
    || process.env.WEB_PUSH_VAPID_PUBLIC_KEY
    || ''
  ).trim();
}

function getPrivateKey() {
  return String(process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '').trim();
}

function getSubject() {
  return String(process.env.WEB_PUSH_VAPID_SUBJECT || 'mailto:support@estio.app').trim();
}

export function getWebPushPublicKey() {
  return getPublicKey();
}

export function isWebPushConfigured() {
  const flags = getNotificationFeatureFlags();
  return flags.webPush && Boolean(getPublicKey() && getPrivateKey());
}

async function getWebPushModule() {
  const mod = await import('web-push');
  if (!vapidConfigured) {
    mod.setVapidDetails(getSubject(), getPublicKey(), getPrivateKey());
    vapidConfigured = true;
  }
  return mod;
}

export async function sendWebPushNotification(
  subscription: Pick<WebPushSubscription, 'endpoint' | 'p256dh' | 'auth'>,
  payload: WebPushPayload
) {
  const webPush = await getWebPushModule();

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body || '',
    tag: payload.tag || 'task-reminder',
    url: payload.url || null,
    requireInteraction: payload.requireInteraction ?? false,
    data: payload.data || {},
  });

  return webPush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
    },
    body
  );
}
