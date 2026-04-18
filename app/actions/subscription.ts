"use server"

import { syncContactToGHL } from '@/lib/ghl/stakeholders';
import { getAccessToken } from '@/lib/ghl/token';
import db from '@/lib/db';

export async function subscribe(prevState: any, formData: FormData) {
    const email = formData.get('email') as string;

    if (!email) {
        return { success: false, message: "Email is required" };
    }

    // 1. Persist to Database (Source of Truth)
    let subscriber;
    try {
        subscriber = await db.subscriber.upsert({
            where: { email },
            update: { updatedAt: new Date() }, // Touch the record
            create: { email, source: 'footer_subscription' },
        });
    } catch (error) {
        console.error("Database Error:", error);
        return { success: false, message: "Failed to save subscription. Please try again." };
    }

    // 2. Fire-and-forget: Sync to GoHighLevel in the background
    const ghlLocationId = process.env.NEXT_PUBLIC_GHL_NEWSLETTER_LOCATION_ID;
    if (ghlLocationId) {
        const subscriberId = subscriber.id;
        void (async () => {
            try {
                const contactId = await syncContactToGHL(ghlLocationId, {
                    email,
                    tags: ['subscription-lead'],
                    name: 'Subscriber',
                });
                if (contactId) {
                    await db.subscriber.update({
                        where: { id: subscriberId },
                        data: { ghlContactId: contactId, syncedAt: new Date(), syncError: null }
                    });
                }
            } catch (error: any) {
                console.error("[Subscribe] GHL Sync Error:", error);
                await db.subscriber.update({
                    where: { id: subscriberId },
                    data: { syncError: error.message }
                }).catch(() => {});
            }
        })();
    }

    return { success: true, message: "Successfully subscribed!" };
}
