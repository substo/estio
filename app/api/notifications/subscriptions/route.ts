import { NextRequest, NextResponse } from 'next/server';
import { getNotificationFeatureFlags } from '@/lib/notifications/feature-flags';
import { getWebPushPublicKey } from '@/lib/notifications/push';
import {
  deactivateWebPushSubscriptionForUser,
  getCurrentDbUserIdOrThrow,
  listCurrentUserWebPushSubscriptions,
  upsertWebPushSubscriptionForUser,
} from '@/lib/notifications/server';

type SubscriptionRequestBody = {
  endpoint?: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
  deviceLabel?: string | null;
  browser?: string | null;
  platform?: string | null;
  userAgent?: string | null;
};

function trim(value: unknown) {
  return String(value || '').trim();
}

export async function GET() {
  try {
    const featureFlags = getNotificationFeatureFlags();
    const subscriptions = await listCurrentUserWebPushSubscriptions();

    return NextResponse.json({
      success: true,
      featureFlags,
      publicKey: getWebPushPublicKey(),
      subscriptions,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to load subscriptions',
      },
      { status: 401 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentDbUserIdOrThrow();
    const body = await request.json() as SubscriptionRequestBody;
    const endpoint = trim(body?.endpoint);
    const p256dh = trim(body?.keys?.p256dh);
    const auth = trim(body?.keys?.auth);

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid push subscription payload',
        },
        { status: 400 }
      );
    }

    const subscription = await upsertWebPushSubscriptionForUser({
      userId,
      endpoint,
      p256dh,
      auth,
      expiration: typeof body?.expirationTime === 'number' ? body.expirationTime : null,
      deviceLabel: body?.deviceLabel || null,
      browser: body?.browser || null,
      platform: body?.platform || null,
      userAgent: body?.userAgent || request.headers.get('user-agent'),
      metadata: {
        source: 'browser_push_subscription',
      },
    });

    return NextResponse.json({
      success: true,
      subscription: {
        id: subscription.id,
        endpoint: subscription.endpoint,
        status: subscription.status,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to save push subscription',
      },
      { status: 401 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = await getCurrentDbUserIdOrThrow();
    const body = await request.json().catch(() => ({}));
    const endpoint = trim(body?.endpoint);
    if (!endpoint) {
      return NextResponse.json(
        {
          success: false,
          error: 'Subscription endpoint is required',
        },
        { status: 400 }
      );
    }

    const result = await deactivateWebPushSubscriptionForUser({
      userId,
      endpoint,
    });

    return NextResponse.json({
      success: result.success,
      count: result.count,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Failed to deactivate push subscription',
      },
      { status: 401 }
    );
  }
}
