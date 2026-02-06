import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { syncEmailsFromOWA } from '@/lib/microsoft/owa-email-sync';
import { syncContactsFromOutlook } from '@/lib/microsoft/contact-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow 5 minutes for cron job

export async function GET(req: NextRequest) {
    // 1. Security Check
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    console.log('[OutlookCron] Starting scheduled sync & maintenance');

    try {
        // 2. Fetch Users with Outlook Sync Enabled and valid session
        const users = await db.user.findMany({
            where: {
                outlookSyncEnabled: true,
                outlookSessionCookies: { not: null }
            }
        });

        console.log(`[OutlookCron] Found ${users.length} users to sync.`);

        for (const user of users) {
            try {
                console.log(`[OutlookCron] Processing user ${user.id} (${user.email})...`);

                // A. Sync Emails (Inbox & Sent) using OWA Puppeteer
                // We run these sequentially to avoid overwhelming system resources (launching too many pages)
                await syncEmailsFromOWA(user.id, 'inbox');
                await syncEmailsFromOWA(user.id, 'sentitems');
                await syncEmailsFromOWA(user.id, 'archive');

                // B. Contact Sync (Inbound) - Graph API based
                // Wrap in try-catch in case user only has Puppeteer credentials (cookies) and no Graph Token
                try {
                    await syncContactsFromOutlook(user.id);
                } catch (contactErr) {
                    console.warn(`[OutlookCron] Contact sync skipped/failed for user ${user.id} (might lack Graph Token):`, contactErr);
                }

            } catch (error) {
                console.error(`[OutlookCron] Error for user ${user.id}:`, error);
                // Continue to next user
            }
        }

        return NextResponse.json({ success: true, usersProcessed: users.length });

    } catch (error: any) {
        console.error('[OutlookCron] Fatal Error:', error);
        return new NextResponse(`Internal Error: ${error.message}`, { status: 500 });
    }
}
