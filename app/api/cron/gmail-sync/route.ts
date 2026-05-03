import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { enqueueGmailSyncOutboxJob } from '@/lib/google/gmail-sync-outbox';
import { enqueueDueGmailSyncJobs, enqueueGmailSyncQueueJob, initGmailSyncWorker } from '@/lib/queue/gmail-sync';
import { CronGuard } from '@/lib/cron/guard';
import { verifyCronAuthorization } from '@/lib/cron/auth';

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
 * This route only enqueues Gmail sync work. The worker owns Gmail API processing.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max (Vercel Pro limit)

const guard = new CronGuard('gmail-sync');

export async function GET(request: NextRequest) {
    const auth = verifyCronAuthorization(request);
    if (!auth.ok) return auth.response;

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

        let enqueued = 0;
        let errors = 0;
        const results: { userId: string; status: string; error?: string; outboxIds?: string[] }[] = [];

        for (const user of users) {
            try {
                // Check if watch needs renewal (expires every 7 days)
                const watchExpiration = user.gmailSyncState?.watchExpiration;
                const now = new Date();
                const outboxIds: string[] = [];

                if (!watchExpiration || watchExpiration < now) {
                    console.log(`[Cron Gmail] Queueing watch renewal for user ${user.id}`);
                    const watchOutbox = await enqueueGmailSyncOutboxJob({
                        userId: user.id,
                        operation: 'renew_watch',
                        payload: { source: 'gmail_cron', reason: 'watch_expired_or_missing' },
                    });
                    outboxIds.push(String(watchOutbox.id));
                }

                const syncOutbox = await enqueueGmailSyncOutboxJob({
                    userId: user.id,
                    operation: 'sync_user_gmail',
                    payload: { source: 'gmail_cron' },
                });
                outboxIds.push(String(syncOutbox.id));

                enqueued += outboxIds.length;
                results.push({ userId: user.id, status: 'queued', outboxIds });

            } catch (err: any) {
                console.error(`[Cron Gmail] Error queueing user ${user.id}:`, err.message);
                errors++;
                results.push({ userId: user.id, status: 'error', error: err.message });
            }
        }

        await initGmailSyncWorker().catch((error) => {
            console.error('[Cron Gmail] Failed to initialize Gmail sync worker:', error);
        });

        for (const result of results) {
            for (const outboxId of result.outboxIds || []) {
                await enqueueGmailSyncQueueJob({ outboxId }).catch((error) => {
                    console.error('[Cron Gmail] Failed to dispatch Gmail sync queue job:', outboxId, error);
                });
            }
        }

        const dueStats = await enqueueDueGmailSyncJobs({ limit: 200 });

        console.log(`[Cron Gmail] Job complete. Enqueued: ${enqueued}, Errors: ${errors}, Due: ${JSON.stringify(dueStats)}`);

        return NextResponse.json({
            success: true,
            enqueued,
            errors,
            dueStats,
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
