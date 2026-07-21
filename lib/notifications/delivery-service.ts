import db from "@/lib/db";
import { getNotificationFeatureFlags } from "@/lib/notifications/feature-flags";
import { isWebPushConfigured, sendWebPushNotification } from "@/lib/notifications/push";

const WEB_PUSH_DELIVERY_TIMEOUT_MS = 8_000;

type NotificationPushPayload = {
    title: string;
    body: string;
    tag: string;
    url: string;
    data: Record<string, unknown>;
};

function getPushStatusCode(error: unknown) {
    const candidate = error as any;
    if (typeof candidate?.statusCode === "number") return candidate.statusCode;
    if (typeof candidate?.status === "number") return candidate.status;
    if (typeof candidate?.response?.status === "number") return candidate.response.status;
    return null;
}

async function withPushTimeout<T>(work: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            work,
            new Promise<T>((_, reject) => {
                timeout = setTimeout(() => reject(new Error("notification_push_timeout")), WEB_PUSH_DELIVERY_TIMEOUT_MS);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

export async function deliverUserNotificationWebPush(args: {
    notificationId: string;
    userId: string;
    payload: NotificationPushPayload;
}) {
    const flags = getNotificationFeatureFlags();
    const preference = await db.userTaskReminderPreference.findUnique({
        where: { userId: args.userId },
        select: { webPushEnabled: true },
    });
    if (!flags.webPush || !isWebPushConfigured() || preference?.webPushEnabled === false) {
        await db.userNotificationDelivery.upsert({
            where: { notificationId_channel: { notificationId: args.notificationId, channel: "web_push" } },
            create: { notificationId: args.notificationId, channel: "web_push", status: "disabled", attemptCount: 1, lastAttemptAt: new Date() },
            update: { status: "disabled", attemptCount: { increment: 1 }, lastAttemptAt: new Date(), lastError: null },
        });
        return { delivered: 0, disabled: true };
    }

    const subscriptions = await db.webPushSubscription.findMany({
        where: { userId: args.userId, status: "active" },
        select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    if (subscriptions.length === 0) {
        await db.userNotificationDelivery.upsert({
            where: { notificationId_channel: { notificationId: args.notificationId, channel: "web_push" } },
            create: { notificationId: args.notificationId, channel: "web_push", status: "disabled", attemptCount: 1, lastAttemptAt: new Date() },
            update: { status: "disabled", attemptCount: { increment: 1 }, lastAttemptAt: new Date(), lastError: null },
        });
        return { delivered: 0, disabled: true };
    }

    let delivered = 0;
    let failed = 0;
    for (const subscription of subscriptions) {
        try {
            await withPushTimeout(sendWebPushNotification(subscription, args.payload));
            delivered += 1;
            await db.webPushSubscription.update({
                where: { id: subscription.id },
                data: { lastUsedAt: new Date(), lastSuccessAt: new Date(), lastFailureAt: null, failureCount: 0 },
            });
        } catch (error) {
            failed += 1;
            const statusCode = getPushStatusCode(error);
            await db.webPushSubscription.update({
                where: { id: subscription.id },
                data: {
                    ...(statusCode === 404 || statusCode === 410 ? { status: "inactive" } : {}),
                    lastUsedAt: new Date(),
                    lastFailureAt: new Date(),
                    failureCount: { increment: 1 },
                },
            });
        }
    }

    const deliveryStatus = delivered > 0 ? "delivered" : "failed";
    await db.userNotificationDelivery.upsert({
        where: { notificationId_channel: { notificationId: args.notificationId, channel: "web_push" } },
        create: {
            notificationId: args.notificationId,
            channel: "web_push",
            status: deliveryStatus,
            attemptCount: 1,
            lastAttemptAt: new Date(),
            deliveredAt: delivered > 0 ? new Date() : null,
            lastError: delivered > 0 ? null : "notification_push_delivery_failed",
            metadata: { subscriptionCount: subscriptions.length, delivered, failed },
        },
        update: {
            status: deliveryStatus,
            attemptCount: { increment: 1 },
            lastAttemptAt: new Date(),
            ...(delivered > 0 ? { deliveredAt: new Date() } : {}),
            lastError: delivered > 0 ? null : "notification_push_delivery_failed",
            metadata: { subscriptionCount: subscriptions.length, delivered, failed },
        },
    });
    return { delivered, disabled: false };
}
