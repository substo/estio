import { withGraphClient } from './graph-client';
import db from '@/lib/db';
import { addDays } from 'date-fns';

const NOTIFICATION_URL = (process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL) + '/api/webhooks/outlook';

export async function createOutlookSubscriptions(userId: string) {
    return withGraphClient(userId, async (client) => {
        // We create subscriptions for Inbox and SentItems
        // Note: In reality, we might track IDs in DB to avoid dupes/renew logic.
        // For V1, we just try to create. 

        // 1. Inbox
        const expirationDateTime = new Date(Date.now() + 4200 * 60 * 1000).toISOString(); // ~2.9 days

        const subInbox = await client.api('/subscriptions').post({
            changeType: 'created,updated',
            notificationUrl: NOTIFICATION_URL,
            resource: "me/mailFolders('inbox')/messages",
            expirationDateTime,
            clientState: `estio_${userId}_inbox` // Including userId for lookup
        });

        // 2. Sent Items
        const subSent = await client.api('/subscriptions').post({
            changeType: 'created,updated', // we care about created (sent)
            notificationUrl: NOTIFICATION_URL,
            resource: "me/mailFolders('sentitems')/messages",
            expirationDateTime,
            clientState: `estio_${userId}_sent`
        });

        // Store active subscription IDs (Maybe just comma separated or latest one for renewal?)
        // Schema has `outlookSubscriptionId` (singular). This is a limitation if we have multiple.
        // Option: Just store the Inbox one for renewal, or assume we renew all found.
        // Ideally we update schema to store multiple or just store the latest.
        // Or we rely on 'Renewal Job' to list all subscriptions and renew them?
        // Better: List valid subscriptions from Graph and renew them.

        await db.user.update({
            where: { id: userId },
            data: {
                outlookSubscriptionId: subInbox.id, // storing one for now implies primary tracking
                outlookSubscriptionExpiry: new Date(expirationDateTime)
            }
        });

        console.log(`[OutlookWebhook] Created subscriptions for user ${userId}. Inbox: ${subInbox.id}, Sent: ${subSent.id}`);
        return [subInbox, subSent];
    });
}

export async function renewOutlookSubscriptions(userId: string) {
    return withGraphClient(userId, async (client) => {
        // List existing subscriptions
        const existing = await client.api('/subscriptions').get();
        const subs = existing.value;

        const newExpiration = new Date(Date.now() + 4200 * 60 * 1000).toISOString();

        for (const sub of subs) {
            // Only renew ours
            if (sub.notificationUrl === NOTIFICATION_URL) {
                await client.api(`/subscriptions/${sub.id}`).update({
                    expirationDateTime: newExpiration
                });
                console.log(`[OutlookWebhook] Renewed subscription ${sub.id}`);
            }
        }

        // Update DB with new expiry (approx)
        await db.user.update({
            where: { id: userId },
            data: { outlookSubscriptionExpiry: new Date(newExpiration) }
        });
    });
}
