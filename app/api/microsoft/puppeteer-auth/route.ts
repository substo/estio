import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import db from '@/lib/db';
import { outlookPuppeteerService } from '@/lib/microsoft/outlook-puppeteer';
import {
    getOutlookSessionRenewStatus,
    requestOutlookSessionRenew
} from '@/lib/microsoft/outlook-session-renew-manager';
import { syncEmailsFromOWA } from '@/lib/microsoft/owa-email-sync';

export const dynamic = 'force-dynamic';

/**
 * POST: Initiate Puppeteer login
 * Body: { email: string, password: string }
 */
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

        const body = await req.json();
        const { email, password } = body;

        if (!email || !password) {
            return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
        }

        console.log(`[OutlookPuppeteerAuth] Starting login for user ${user.id}`);

        // Attempt login
        const result = await outlookPuppeteerService.loginToOWA(email, password);

        if (!result.success) {
            return NextResponse.json({
                success: false,
                error: result.error,
                mfaRequired: result.mfaRequired
            }, { status: 400 });
        }

        // Save session
        if (result.cookies) {
            await outlookPuppeteerService.saveSession(user.id, email, password, result.cookies);
        }

        const response = NextResponse.json({
            success: true,
            message: 'Connected to Outlook successfully'
        });

        // Fire-and-forget initial sync to populate "Last Synced" state immediately
        // We don't await this to keep the UI responsive
        (async () => {
            try {
                console.log(`[OutlookPuppeteerAuth] Triggering initial sync for user ${user.id}`);
                // Sync inbox first to update state quickly
                await syncEmailsFromOWA(user.id, 'inbox');
            } catch (err) {
                console.error('[OutlookPuppeteerAuth] Initial sync failed:', err);
            }
        })();

        return response;

    } catch (error: any) {
        console.error('[OutlookPuppeteerAuth] Error:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to connect'
        }, { status: 500 });
    }
}

/**
 * GET: Check session status
 */
export async function GET(req: NextRequest) {
    try {
        const clerkUser = await currentUser();
        if (!clerkUser) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await db.user.findFirst({
            where: { clerkId: clerkUser.id },
            select: {
                id: true,
                outlookAuthMethod: true,
                outlookEmail: true,
                outlookSyncEnabled: true,
                outlookAccessToken: true,
                outlookRefreshToken: true,
                outlookSessionCookies: true,
                outlookPasswordEncrypted: true,
                outlookSessionExpiry: true,
                outlookSubscriptionExpiry: true,
                outlookSyncState: {
                    select: {
                        emailAddress: true,
                        lastSyncedAt: true
                    }
                }
            }
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const inferredMethod =
            (user.outlookAuthMethod as 'oauth' | 'puppeteer' | null)
            || (user.outlookSessionCookies ? 'puppeteer' : null)
            || ((user.outlookAccessToken || user.outlookRefreshToken) ? 'oauth' : null);

        if (inferredMethod === 'puppeteer') {
            const sessionExpired = user.outlookSessionExpiry
                ? new Date() > user.outlookSessionExpiry
                : true;
            const recoverableSession = !!user.outlookPasswordEncrypted;

            if (sessionExpired && recoverableSession && user.outlookSyncEnabled) {
                // Fire-and-forget auto-renew with throttling/single-flight. This keeps GET responsive.
                await requestOutlookSessionRenew(user.id, { mode: 'auto', awaitCompletion: false });
            }

            const renewStatus = getOutlookSessionRenewStatus(user.id);

            return NextResponse.json({
                connected: user.outlookSyncEnabled && !!user.outlookSessionCookies && !sessionExpired,
                method: 'puppeteer',
                email: user.outlookEmail || user.outlookSyncState?.emailAddress || null,
                sessionExpiry: user.outlookSessionExpiry,
                sessionExpired,
                recoverableSession,
                renewing: renewStatus.inFlight,
                autoRenewThrottled: renewStatus.throttled && !renewStatus.inFlight,
                autoRenewRetryAt: renewStatus.nextEligibleAt,
                autoRenewLastAttemptAt: renewStatus.lastAttemptAt,
                autoRenewLastAttemptMode: renewStatus.lastAttemptMode,
                autoRenewLastSuccessAt: renewStatus.lastSuccessAt,
                autoRenewLastError: renewStatus.lastError,
                autoRenewLastErrorAt: renewStatus.lastErrorAt,
                lastSyncedAt: user.outlookSyncState?.lastSyncedAt,
                syncEnabled: user.outlookSyncEnabled
            });
        }

        if (inferredMethod === 'oauth') {
            const connected = user.outlookSyncEnabled && !!(user.outlookAccessToken || user.outlookRefreshToken);
            const subscriptionExpired = user.outlookSubscriptionExpiry
                ? new Date() > user.outlookSubscriptionExpiry
                : false;

            return NextResponse.json({
                connected,
                method: 'oauth',
                email: user.outlookEmail || user.outlookSyncState?.emailAddress || null,
                sessionExpiry: user.outlookSubscriptionExpiry,
                sessionExpired: subscriptionExpired,
                recoverableSession: false,
                renewing: false,
                autoRenewThrottled: false,
                autoRenewRetryAt: null,
                autoRenewLastAttemptAt: null,
                autoRenewLastAttemptMode: null,
                autoRenewLastSuccessAt: null,
                autoRenewLastError: null,
                autoRenewLastErrorAt: null,
                lastSyncedAt: user.outlookSyncState?.lastSyncedAt,
                syncEnabled: user.outlookSyncEnabled
            });
        }

        return NextResponse.json({
            connected: false,
            method: user.outlookAuthMethod || null,
            recoverableSession: false,
            renewing: false,
            autoRenewThrottled: false,
            autoRenewRetryAt: null,
            autoRenewLastAttemptAt: null,
            autoRenewLastAttemptMode: null,
            autoRenewLastSuccessAt: null,
            autoRenewLastError: null,
            autoRenewLastErrorAt: null,
            syncEnabled: user.outlookSyncEnabled
        });

    } catch (error: any) {
        console.error('[OutlookPuppeteerAuth] Status check error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

/**
 * DELETE: Disconnect Outlook
 */
export async function DELETE(req: NextRequest) {
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

        await outlookPuppeteerService.disconnect(user.id);

        return NextResponse.json({
            success: true,
            message: 'Disconnected from Outlook'
        });

    } catch (error: any) {
        console.error('[OutlookPuppeteerAuth] Disconnect error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
