import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import db from '@/lib/db';
import { syncEmailsFromOWA } from '@/lib/microsoft/owa-email-sync';

// Allow long-running requests for sync
export const maxDuration = 300;

export async function POST(req: NextRequest) {
    try {
        const clerkUser = await currentUser();
        if (!clerkUser) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await db.user.findFirst({
            where: { clerkId: clerkUser.id }
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        if (!user.outlookSyncEnabled || !user.outlookSessionCookies) {
            return NextResponse.json({ error: 'Outlook sync is not configured or connected.' }, { status: 400 });
        }

        console.log(`[ManualSync] Triggered by user ${user.id} (${user.email})`);

        // Run sync for Inbox
        // Note: For manual sync, we await it so the user sees real progress/success
        const inboxCount = await syncEmailsFromOWA(user.id, 'inbox');
        const sentCount = await syncEmailsFromOWA(user.id, 'sentitems');

        const count = inboxCount + sentCount;

        return NextResponse.json({
            success: true,
            count,
            message: `Successfully synced ${count} emails.`
        });

    } catch (error: any) {
        console.error('[ManualSync] Error:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to sync'
        }, { status: 500 });
    }
}
