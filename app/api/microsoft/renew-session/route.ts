import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import db from '@/lib/db';
import {
    getOutlookSessionRenewStatus,
    requestOutlookSessionRenew
} from '@/lib/microsoft/outlook-session-renew-manager';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST() {
    try {
        const clerkUser = await currentUser();
        if (!clerkUser) {
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        }

        const user = await db.user.findFirst({
            where: { clerkId: clerkUser.id },
            select: {
                id: true,
                outlookAuthMethod: true,
                outlookEmail: true,
                outlookPasswordEncrypted: true,
                outlookSessionCookies: true,
                outlookSessionExpiry: true,
                outlookSyncEnabled: true
            }
        });

        if (!user) {
            return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
        }

        const inferredMethod =
            (user.outlookAuthMethod as 'oauth' | 'puppeteer' | null)
            || (user.outlookSessionCookies ? 'puppeteer' : null)
            || (user.outlookPasswordEncrypted ? 'puppeteer' : null);

        if (inferredMethod !== 'puppeteer') {
            return NextResponse.json({
                success: false,
                error: 'Session renewal is only available for Puppeteer-based Outlook connections.'
            }, { status: 400 });
        }

        if (!user.outlookEmail || !user.outlookPasswordEncrypted) {
            return NextResponse.json({
                success: false,
                error: 'Stored Outlook credentials are required to renew the session automatically.'
            }, { status: 400 });
        }

        const wasExpired = user.outlookSessionExpiry ? new Date() > user.outlookSessionExpiry : true;
        console.log(`[OutlookRenewSession] Triggered for user ${user.id} (expired=${wasExpired})`);

        const renew = await requestOutlookSessionRenew(user.id, {
            mode: 'manual',
            force: true,
            awaitCompletion: true
        });

        if (renew.inFlight && !renew.started) {
            const runtime = getOutlookSessionRenewStatus(user.id);
            return NextResponse.json({
                success: false,
                renewing: true,
                message: 'Outlook session renewal is already in progress.',
                autoRenewRetryAt: runtime.nextEligibleAt
            }, { status: 202 });
        }

        if (!renew.result?.success) {
            return NextResponse.json({
                success: false,
                error: renew.result?.error || 'Automatic session renewal failed. Please reconnect manually.'
            }, { status: 400 });
        }

        const updatedUser = await db.user.findUnique({
            where: { id: user.id },
            select: {
                outlookSessionExpiry: true,
                outlookSyncEnabled: true
            }
        });

        return NextResponse.json({
            success: true,
            renewed: true,
            message: wasExpired
                ? 'Outlook session renewed successfully.'
                : 'Outlook session refreshed successfully.',
            renewing: false,
            sessionExpiry: updatedUser?.outlookSessionExpiry ?? null,
            syncEnabled: updatedUser?.outlookSyncEnabled ?? user.outlookSyncEnabled
        });
    } catch (error: any) {
        console.error('[OutlookRenewSession] Error:', error);
        return NextResponse.json({
            success: false,
            error: error?.message || 'Failed to renew Outlook session'
        }, { status: 500 });
    }
}
