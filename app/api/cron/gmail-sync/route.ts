import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { syncRecentMessages, watchGmail } from '@/lib/google/gmail-sync';
import { syncContactsFromGoogle } from '@/lib/google/people';
import { CronGuard } from '@/lib/cron/guard';

/**
 * Gmail Sync Cron Job
 * 
 * This endpoint is designed to be called by Vercel Cron or an external scheduler (e.g., cron-job.org)
 * every 5 minutes as a fallback for real-time Pub/Sub notifications.
 * 
 * Best Practice: "Belt and Suspenders"
 * - Primary: Real-time Pub/Sub (instant, ~2s latency)
 * - Fallback: Scheduled polling (catches anything missed, max 5min delay)
 * 
 * Security: Uses a simple bearer token check. Set CRON_SECRET in env.
 * 
 * Now also performs bidirectional contact sync (Google → Estio).
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max (Vercel Pro limit)

const guard = new CronGuard('gmail-sync');

export async function GET(request: NextRequest) {
    // Security check
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        console.warn('[Cron Gmail] Unauthorized request');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Cron Gmail] Starting scheduled sync job...');

    // Concurrency & Resource Check
    const resources = await guard.checkResources(400, 5.0); // Slightly focused requirements for Gmail (less heavy than Puppeteer)
    if (!resources.ok) {
        console.warn(`[Cron Gmail] SKIPPING run: ${resources.reason}`);
        return NextResponse.json({ skipped: true, reason: resources.reason });
    }

    if (!(await guard.acquire())) {
        console.warn('[Cron Gmail] SKIPPING run: Job is already running (locked)');
        return NextResponse.json({ skipped: true, reason: 'locked' });
    }

    try {
        // Find all users with Gmail sync enabled
        const users = await db.user.findMany({
            where: {
                googleSyncEnabled: true,
                googleRefreshToken: { not: null }
            },
            select: {
                id: true,
                email: true,
                locations: { take: 1, select: { id: true } }, // For inbound contact sync
                gmailSyncState: {
                    select: { historyId: true, watchExpiration: true }
                }
            }
        });

        console.log(`[Cron Gmail] Found ${users.length} users with Gmail sync enabled`);

        let synced = 0;
        let errors = 0;
        let contactsStats = { synced: 0, created: 0, skipped: 0 };
        const results: { userId: string; status: string; error?: string; contacts?: any }[] = [];

        for (const user of users) {
            try {
                // Check if watch needs renewal (expires every 7 days)
                const watchExpiration = user.gmailSyncState?.watchExpiration;
                const now = new Date();

                if (!watchExpiration || watchExpiration < now) {
                    console.log(`[Cron Gmail] Renewing watch for user ${user.id}`);
                    await watchGmail(user.id);
                }

                // Run Gmail delta sync
                await syncRecentMessages(user.id);

                // DISABLED: Inbound sync removed. Use Google Sync Manager for manual sync.
                // Run inbound contact sync (Google → Estio) for bidirectional sync
                let userContactStats = { synced: 0, created: 0, skipped: 0 };
                // if (user.locations?.[0]?.id) {
                //     userContactStats = await syncContactsFromGoogle(user.id, user.locations[0].id);
                //     contactsStats.synced += userContactStats.synced;
                //     contactsStats.created += userContactStats.created;
                //     contactsStats.skipped += userContactStats.skipped;
                // }

                synced++;
                results.push({ userId: user.id, status: 'synced', contacts: userContactStats });

            } catch (err: any) {
                console.error(`[Cron Gmail] Error syncing user ${user.id}:`, err.message);
                errors++;
                results.push({ userId: user.id, status: 'error', error: err.message });
            }
        }

        console.log(`[Cron Gmail] Job complete. Synced: ${synced}, Errors: ${errors}, Contacts: ${JSON.stringify(contactsStats)}`);

        return NextResponse.json({
            success: true,
            synced,
            errors,
            contactsStats,
            results
        });

    } catch (error: any) {
        console.error('[Cron Gmail] Fatal error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    } finally {
        await guard.release();
    }
}
