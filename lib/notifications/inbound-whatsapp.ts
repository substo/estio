import db from "@/lib/db";
import { deliverUserNotificationWebPush } from "@/lib/notifications/delivery-service";
import { getNotificationFeatureFlags } from "@/lib/notifications/feature-flags";
import { publishNotificationRealtimeEvent } from "@/lib/realtime/notification-events";

export const INBOUND_WHATSAPP_NOTIFICATION_MAX_AGE_MS = 10 * 60 * 1000;
export const INBOUND_WHATSAPP_NOTIFICATION_MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;

export function isInboundWhatsAppNotificationFresh(createdAt: Date, now = new Date()) {
    const createdAtMs = createdAt instanceof Date ? createdAt.getTime() : Number.NaN;
    const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
    if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) return false;
    const ageMs = nowMs - createdAtMs;
    return ageMs <= INBOUND_WHATSAPP_NOTIFICATION_MAX_AGE_MS
        && ageMs >= -INBOUND_WHATSAPP_NOTIFICATION_MAX_FUTURE_SKEW_MS;
}

export function buildInboundWhatsAppNotificationContent(conversationId: string) {
    const normalizedConversationId = String(conversationId || "").trim();
    return {
        title: "New WhatsApp message",
        body: "Open Estio to view and reply.",
        deepLinkUrl: `/admin/conversations?mode=chats&id=${encodeURIComponent(normalizedConversationId)}`,
    };
}

export function dedupeLocationNotificationRecipientIds(rows: Array<{ userId?: string | null; id?: string | null }>) {
    return Array.from(new Set((rows || [])
        .map((row) => String(row.userId || row.id || "").trim())
        .filter(Boolean)));
}

export async function notifyLocationUsersOfInboundWhatsAppMessage(args: {
    locationId: string;
    conversationId: string;
    contactId: string;
    messageId: string;
    createdAt: Date;
}) {
    const locationId = String(args.locationId || "").trim();
    const conversationId = String(args.conversationId || "").trim();
    const messageId = String(args.messageId || "").trim();
    if (!locationId || !conversationId || !messageId) return { recipients: 0, created: 0 };

    const users = await db.user.findMany({
        where: {
            clerkId: { not: null },
            OR: [
                { locations: { some: { id: locationId } } },
                { locationRoles: { some: { locationId } } },
            ],
        },
        select: { id: true },
    });
    const userIds = dedupeLocationNotificationRecipientIds(users);
    const flags = getNotificationFeatureFlags();
    const content = buildInboundWhatsAppNotificationContent(conversationId);
    let created = 0;
    const pushJobs: Array<Promise<unknown>> = [];

    for (const userId of userIds) {
        const existing = await db.userNotification.findFirst({
            where: {
                userId,
                type: "whatsapp_inbound",
                conversationId,
                payload: { path: ["messageId"], equals: messageId },
            },
            select: { id: true },
        });
        if (existing) continue;

        const notification = await db.userNotification.create({
            data: {
                userId,
                locationId,
                type: "whatsapp_inbound",
                title: content.title,
                body: content.body,
                deepLinkUrl: content.deepLinkUrl,
                contactId: args.contactId,
                conversationId,
                payload: {
                    messageId,
                    channel: "whatsapp",
                    createdAt: args.createdAt.toISOString(),
                },
                deliveries: {
                    create: {
                        channel: "in_app",
                        status: "delivered",
                        attemptCount: 1,
                        lastAttemptAt: new Date(),
                        deliveredAt: new Date(),
                    },
                },
            },
        });
        created += 1;

        if (flags.notificationSse) {
            await publishNotificationRealtimeEvent({
                userId,
                type: "notification.created",
                payload: {
                    notificationId: notification.id,
                    title: notification.title,
                    body: notification.body,
                    deepLinkUrl: notification.deepLinkUrl,
                    type: notification.type,
                    conversationId,
                    createdAt: notification.createdAt.toISOString(),
                },
            });
        }

        pushJobs.push(deliverUserNotificationWebPush({
            notificationId: notification.id,
            userId,
            payload: {
                title: content.title,
                body: content.body,
                tag: `whatsapp-inbound:${conversationId}`,
                url: content.deepLinkUrl,
                data: {
                    notificationId: notification.id,
                    conversationId,
                    deepLinkUrl: content.deepLinkUrl,
                },
            },
        }));
    }

    await Promise.allSettled(pushJobs);

    return { recipients: userIds.length, created };
}
