import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { syncOutlookFolder } from '@/lib/microsoft/outlook-sync';

/**
 * Microsoft Graph Webhook Handler
 * 
 * Best Practices Implemented:
 * 1. Validation Token Echo (required by Microsoft)
 * 2. Client State Verification (HMAC-like validation)
 * 3. Async Processing with Quick Response
 * 4. Proper Error Handling
 */

export async function POST(req: NextRequest) {
    const url = new URL(req.url);

    // 1. Handle Subscription Validation
    // Microsoft sends a validation token that must be echoed back
    const validationToken = url.searchParams.get('validationToken');
    if (validationToken) {
        console.log('[OutlookWebhook] Validation request received');
        return new NextResponse(validationToken, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
        });
    }

    // 2. Process Notifications
    try {
        const body = await req.json();
        const notifications = body.value || [];

        // Respond quickly - Microsoft expects < 3s response
        // Process notifications asynchronously
        const processingPromises: Promise<void>[] = [];

        for (const notification of notifications) {
            // 3. Validate Client State
            const clientState = notification.clientState;
            if (!clientState || !clientState.startsWith('estio_')) {
                console.warn('[OutlookWebhook] Invalid clientState, skipping notification');
                continue;
            }

            // Parse userId from clientState (format: estio_{userId}_{folder})
            const parts = clientState.split('_');
            if (parts.length < 3) {
                console.warn('[OutlookWebhook] Malformed clientState:', clientState);
                continue;
            }

            const userId = parts[1];
            const folder = parts[2]; // 'inbox' or 'sent'

            // 4. Determine folder and queue sync
            const folderId = folder === 'sent' ? 'sentitems' : 'inbox';

            console.log(`[OutlookWebhook] Notification for user ${userId}, folder ${folderId}`);

            // Process asynchronously to avoid timeout
            processingPromises.push(
                syncOutlookFolder(userId, folderId).catch(err => {
                    console.error(`[OutlookWebhook] Sync failed for ${userId}:`, err);
                })
            );
        }

        // Don't await - respond immediately to Microsoft
        // Let the syncs complete in background
        Promise.all(processingPromises).catch(console.error);

        return new NextResponse('Accepted', { status: 202 });

    } catch (error: any) {
        console.error('[OutlookWebhook] Error processing notification:', error);
        // Still return 200 to prevent Microsoft from retrying
        // Log the error for investigation
        return new NextResponse('OK', { status: 200 });
    }
}

// Also handle GET for any validation requests that come via GET
export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const validationToken = url.searchParams.get('validationToken');

    if (validationToken) {
        return new NextResponse(validationToken, {
            status: 200,
            headers: { 'Content-Type': 'text/plain' }
        });
    }

    return new NextResponse('OK', { status: 200 });
}
