
import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { enqueueGmailSyncOutboxJob } from '@/lib/google/gmail-sync-outbox';
import { enqueueGmailSyncQueueJob, initGmailSyncWorker } from '@/lib/queue/gmail-sync';

// Public Route for Google Pub/Sub
// Note: Real-world security requires verifying the JWT token sent by Google in Authorization header
export async function POST(req: NextRequest) {
    try {
        // Handle empty body (Pub/Sub heartbeat/verification requests)
        const text = await req.text();
        if (!text || text.trim() === '') {
            console.log('[Gmail Webhook] Received empty body (heartbeat/ack)');
            return NextResponse.json({ status: 'ack' });
        }

        let body;
        try {
            body = JSON.parse(text);
        } catch (parseError) {
            console.warn('[Gmail Webhook] Invalid JSON received:', text.substring(0, 100));
            return NextResponse.json({ status: 'ack' }); // Return 200 so Pub/Sub doesn't retry
        }

        const message = body.message;

        if (!message || !message.data) {
            return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
        }

        const decodedData = Buffer.from(message.data, 'base64').toString('utf-8');
        const event = JSON.parse(decodedData);
        // format: { emailAddress: 'user@example.com', historyId: 12345 }

        console.log('[Gmail Webhook] Received push for:', event.emailAddress);

        // Lookup user by the connected email address
        const syncState = await db.gmailSyncState.findUnique({
            where: { emailAddress: event.emailAddress },
            include: { user: true }
        });

        if (!syncState) {
            console.warn(`[Gmail Webhook] No user found for email ${event.emailAddress}`);
            return NextResponse.json({ status: 'ignored' });
        }

        console.log(`[Gmail Webhook] Queueing sync for user ${syncState.userId} (History: ${event.historyId})`);

        const outbox = await enqueueGmailSyncOutboxJob({
            userId: syncState.userId,
            operation: 'sync_user_gmail',
            payload: {
                source: 'gmail_webhook',
                eventHistoryId: event.historyId ? String(event.historyId) : undefined,
                emailAddress: event.emailAddress || undefined,
            },
        });

        initGmailSyncWorker()
            .then(() => enqueueGmailSyncQueueJob({ outboxId: String(outbox.id) }))
            .catch((error) => {
                console.error('[Gmail Webhook] Failed to dispatch Gmail sync queue job; cron will retry:', error);
            });

        return NextResponse.json({ status: 'queued', outboxId: outbox.id });
    } catch (error) {
        console.error('[Gmail Webhook] Error:', error);
        return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
    }
}
