'use server';

import db from '@/lib/db';
import { auth } from '@clerk/nextjs/server';

export interface OutlookEmail {
    id: string;
    subject: string;
    sender: string;
    senderEmail: string;
    preview: string;
    date: string;
    isRead: boolean;
    folder: 'inbox' | 'sent';
}

/**
 * Fetch emails from Outlook for a specific contact (by email address)
 */
export async function fetchOutlookEmailsForContactAction(contactEmail: string): Promise<{
    success: boolean;
    data?: OutlookEmail[];
    error?: string;
}> {
    try {
        const { userId: clerkUserId } = await auth();
        if (!clerkUserId) {
            return { success: false, error: 'Unauthorized' };
        }

        // Get user with Outlook connection
        const user = await db.user.findUnique({
            where: { clerkId: clerkUserId },
            select: {
                id: true,
                outlookAuthMethod: true,
                outlookSessionCookies: true,
                outlookSessionExpiry: true,
                outlookSyncEnabled: true
            }
        });

        if (!user || !user.outlookSyncEnabled) {
            return { success: false, error: 'Outlook not connected. Please connect your account first.' };
        }

        // For now, fetch from our local database (synced messages)
        // This is faster and doesn't require browser automation for every request
        const messages = await db.message.findMany({
            where: {
                OR: [
                    { emailFrom: { contains: contactEmail, mode: 'insensitive' } },
                    { emailTo: { contains: contactEmail, mode: 'insensitive' } }
                ],
                type: 'EMAIL'
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
                id: true,
                subject: true,
                body: true,
                emailFrom: true,
                direction: true,
                createdAt: true
            }
        });

        const emails: OutlookEmail[] = messages.map(msg => ({
            id: msg.id,
            subject: msg.subject || '(No Subject)',
            sender: msg.emailFrom || 'Unknown',
            senderEmail: msg.emailFrom || '',
            preview: msg.body?.substring(0, 200) || '',
            date: msg.createdAt.toISOString(),
            isRead: true,
            folder: msg.direction === 'inbound' ? 'inbox' : 'sent'
        }));

        return { success: true, data: emails };

    } catch (error: any) {
        console.error('[fetchOutlookEmailsForContact] Error:', error);
        return { success: false, error: error.message || 'Failed to fetch emails' };
    }
}

/**
 * Sync emails from Outlook for a specific sender email
 * This triggers a live sync from OWA
 */
export async function syncOutlookEmailsAction(senderEmail?: string): Promise<{
    success: boolean;
    count?: number;
    error?: string;
}> {
    try {
        const { userId: clerkUserId } = await auth();
        if (!clerkUserId) {
            return { success: false, error: 'Unauthorized' };
        }

        const user = await db.user.findUnique({
            where: { clerkId: clerkUserId },
            select: {
                id: true,
                outlookAuthMethod: true,
                outlookSyncEnabled: true
            }
        });

        if (!user || !user.outlookSyncEnabled) {
            return { success: false, error: 'Outlook not connected' };
        }

        // Import sync function
        const { syncEmailsFromOWA } = await import('@/lib/microsoft/owa-email-sync');

        let count = 0;

        if (senderEmail) {
            // Targeted Sync via Search (Best for specific contacts)
            console.log(`[syncOutlookEmails] searching for ${senderEmail}`);
            count = await syncEmailsFromOWA(user.id, 'search', senderEmail);
        } else {
            // Full Sync (Inbox + Sent)
            // Sync inbox
            const inboxCount = await syncEmailsFromOWA(user.id, 'inbox');
            // Sync sent items
            const sentCount = await syncEmailsFromOWA(user.id, 'sentitems');
            count = inboxCount + sentCount;
        }

        return {
            success: true,
            count
        };

    } catch (error: any) {
        console.error('[syncOutlookEmails] Error:', error);
        return { success: false, error: error.message || 'Sync failed' };
    }
}

/**
 * Get Outlook connection status
 */
export async function getOutlookStatusAction(): Promise<{
    connected: boolean;
    method?: 'oauth' | 'puppeteer';
    email?: string;
    lastSyncedAt?: Date;
}> {
    try {
        const { userId: clerkUserId } = await auth();
        if (!clerkUserId) {
            return { connected: false };
        }

        const user = await db.user.findUnique({
            where: { clerkId: clerkUserId },
            select: {
                outlookSyncEnabled: true,
                outlookAuthMethod: true,
                outlookEmail: true,
                outlookAccessToken: true,
                outlookSyncState: {
                    select: {
                        lastSyncedAt: true
                    }
                }
            }
        });

        if (!user) {
            return { connected: false };
        }

        const connected = user.outlookSyncEnabled &&
            (user.outlookAuthMethod === 'puppeteer' || !!user.outlookAccessToken);

        return {
            connected,
            method: user.outlookAuthMethod as 'oauth' | 'puppeteer' | undefined,
            email: user.outlookEmail || undefined,
            lastSyncedAt: user.outlookSyncState?.lastSyncedAt
        };

    } catch (error) {
        return { connected: false };
    }
}
