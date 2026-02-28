import { google, gmail_v1 } from 'googleapis';
import { Prisma } from '@prisma/client';
import { getValidAccessToken } from './auth';
import db from '@/lib/db';
import { createInboundMessage } from '@/lib/ghl/conversations';

/**
 * Core Engine for Native Gmail Sync
 *
 * Best-practice strategy:
 * - Bootstrap once (small recent window)
 * - Continue with Gmail history delta sync (startHistoryId)
 * - Keep ingestion idempotent by only incrementing unread for newly-inserted messages
 */

const BOOTSTRAP_MAX_RESULTS = 50;
const HISTORY_PAGE_SIZE = 500;

interface SyncRecentOptions {
    forceBootstrap?: boolean;
}

interface ProcessMessageOptions {
    countUnread?: boolean;
}

// Helper to parse header values
function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string | null {
    if (!headers) return null;
    const header = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
    return header?.value || null;
}

// Helper to get body from payload
function getBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
    if (!payload) return '';

    // If it has a body.data directly (plain text/html in simple messages)
    if (payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    // If it has parts (multipart/alternative or mixed)
    if (payload.parts) {
        // Prioritize HTML, then Plain Text
        const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
        const textPart = payload.parts.find((p) => p.mimeType === 'text/plain');

        if (htmlPart?.body?.data) {
            return Buffer.from(htmlPart.body.data, 'base64').toString('utf-8');
        }
        if (textPart?.body?.data) {
            return Buffer.from(textPart.body.data, 'base64').toString('utf-8');
        }

        // Recursive check for nested parts
        for (const part of payload.parts) {
            const nestedBody = getBody(part);
            if (nestedBody) return nestedBody;
        }
    }

    return '';
}

function isHistoryTooOldError(error: unknown): boolean {
    const status = (error as any)?.code || (error as any)?.response?.status;
    const message = String((error as any)?.message || '').toLowerCase();
    return status === 404 && (message.includes('historyid') || message.includes('starthistoryid'));
}

async function persistSyncState(userId: string, emailAddress: string | null | undefined, historyId: string | null | undefined) {
    if (!historyId) return;

    await db.gmailSyncState.upsert({
        where: { userId },
        create: {
            userId,
            historyId,
            emailAddress: emailAddress || undefined,
            lastSyncedAt: new Date(),
        },
        update: {
            historyId,
            emailAddress: emailAddress || undefined,
            lastSyncedAt: new Date(),
        },
    });
}

async function bootstrapRecentMessages(gmail: gmail_v1.Gmail, userId: string, myEmail: string): Promise<number> {
    const res = await gmail.users.messages.list({
        userId: 'me',
        maxResults: BOOTSTRAP_MAX_RESULTS,
    });

    const messages = res.data.messages || [];
    console.log(`[Gmail Sync] Bootstrap found ${messages.length} messages for user ${userId}`);

    let processed = 0;
    for (const msgStub of messages) {
        if (!msgStub.id) continue;
        await processMessage(gmail, userId, msgStub.id, myEmail, { countUnread: false });
        processed++;
    }

    return processed;
}

async function processHistoryDelta(gmail: gmail_v1.Gmail, userId: string, myEmail: string, startHistoryId: string): Promise<{ processed: number; latestHistoryId?: string }> {
    let pageToken: string | undefined;
    let latestHistoryId: string | undefined;
    const messageIds = new Set<string>();

    do {
        const historyRes = await gmail.users.history.list({
            userId: 'me',
            startHistoryId,
            historyTypes: ['messageAdded'],
            maxResults: HISTORY_PAGE_SIZE,
            pageToken,
        });

        latestHistoryId = historyRes.data.historyId || latestHistoryId;

        for (const historyRecord of historyRes.data.history || []) {
            for (const added of historyRecord.messagesAdded || []) {
                const id = added.message?.id;
                if (id) messageIds.add(id);
            }
        }

        pageToken = historyRes.data.nextPageToken || undefined;
    } while (pageToken);

    let processed = 0;
    for (const messageId of messageIds) {
        await processMessage(gmail, userId, messageId, myEmail, { countUnread: true });
        processed++;
    }

    return { processed, latestHistoryId };
}

export async function syncRecentMessages(userId: string, options: SyncRecentOptions = {}) {
    console.log(`[Gmail Sync] Starting sync for user ${userId}`);

    const client = await getValidAccessToken(userId);
    const gmail = google.gmail({ version: 'v1', auth: client });

    const profile = await gmail.users.getProfile({ userId: 'me' });
    const myEmail = profile.data.emailAddress;
    if (!myEmail) {
        throw new Error(`Gmail profile email is missing for user ${userId}`);
    }

    const syncState = await db.gmailSyncState.findUnique({
        where: { userId },
        select: { historyId: true },
    });

    let processed = 0;
    let nextHistoryId: string | undefined = profile.data.historyId || undefined;

    if (options.forceBootstrap || !syncState?.historyId) {
        processed = await bootstrapRecentMessages(gmail, userId, myEmail);
    } else {
        try {
            const delta = await processHistoryDelta(gmail, userId, myEmail, syncState.historyId);
            processed = delta.processed;
            nextHistoryId = delta.latestHistoryId || nextHistoryId;
        } catch (error) {
            if (isHistoryTooOldError(error)) {
                console.warn(`[Gmail Sync] historyId invalid/stale for ${userId}; falling back to bootstrap.`);
                processed = await bootstrapRecentMessages(gmail, userId, myEmail);
            } else {
                throw error;
            }
        }
    }

    await persistSyncState(userId, myEmail, nextHistoryId);

    console.log(`[Gmail Sync] Completed sync for user ${userId}. Processed: ${processed}, historyId: ${nextHistoryId || 'n/a'}`);

    return {
        processed,
        historyId: nextHistoryId || null,
    };
}

export async function watchGmail(userId: string) {
    console.log(`[Gmail Sync] Setting up watch for user ${userId}`);
    const client = await getValidAccessToken(userId);
    const gmail = google.gmail({ version: 'v1', auth: client });

    const topicName = `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID || 'estio-crm'}/topics/gmail-sync`;

    const res = await gmail.users.watch({
        userId: 'me',
        requestBody: {
            topicName,
            labelIds: ['INBOX'],
        },
    });

    console.log(`[Gmail Sync] Watch initialized. History ID: ${res.data.historyId}, Expiration: ${res.data.expiration}`);

    if (res.data.historyId) {
        await db.gmailSyncState.updateMany({
            where: { userId },
            data: {
                historyId: res.data.historyId,
                watchExpiration: res.data.expiration ? new Date(parseInt(res.data.expiration, 10)) : undefined,
            },
        });
    }

    return res.data;
}

export async function processMessage(
    gmail: gmail_v1.Gmail,
    userId: string,
    messageId: string,
    myEmail: string,
    options: ProcessMessageOptions = {}
) {
    try {
        const fullMsg = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full',
        });

        const data = fullMsg.data;
        const headers = data.payload?.headers;

        const subject = getHeader(headers, 'Subject') || '(No Subject)';
        const from = getHeader(headers, 'From') || '';
        const to = getHeader(headers, 'To') || '';
        const internalDate = data.internalDate ? parseInt(data.internalDate, 10) : Date.now();

        const isOutbound = from.includes(myEmail);
        const direction = isOutbound ? 'outbound' : 'inbound';
        const body = getBody(data.payload);
        const targetEmail = isOutbound ? extractEmail(to) : extractEmail(from);
        const hasUnreadLabel = Array.isArray(data.labelIds) && data.labelIds.includes('UNREAD');

        let conversationId: string | undefined;
        let locationId: string | undefined;
        let contact: { id: string; ghlContactId: string | null } | null = null;

        if (targetEmail) {
            let localContact = await db.contact.findFirst({
                where: {
                    email: targetEmail,
                    location: { users: { some: { id: userId } } },
                },
            });

            if (!localContact) {
                const user = await db.user.findUnique({
                    where: { id: userId },
                    include: { locations: { take: 1 } },
                });

                if (user?.locations?.[0]) {
                    const newLocationId = user.locations[0].id;
                    const displayName = extractDisplayName(isOutbound ? to : from);

                    let contactName = displayName || 'Email Contact';
                    let googleContactId: string | undefined;

                    if (user.googleSyncEnabled) {
                        try {
                            const { lookupGoogleContactByEmail } = await import('./people');
                            const googleContact = await lookupGoogleContactByEmail(userId, targetEmail);
                            if (googleContact) {
                                contactName = googleContact.name || contactName;
                                googleContactId = googleContact.resourceName;
                                console.log(`[Gmail Sync] Found contact in Google: ${contactName}`);
                            }
                        } catch (e) {
                            console.log(`[Gmail Sync] Could not lookup Google Contact for ${targetEmail}:`, e);
                        }
                    }

                    console.log(`[Gmail Sync] Auto-creating contact: ${contactName} <${targetEmail}>`);

                    localContact = await db.contact.create({
                        data: {
                            locationId: newLocationId,
                            name: contactName,
                            email: targetEmail,
                            status: 'new',
                            contactType: 'Lead',
                            leadSource: 'Email',
                            googleContactId,
                        },
                    });
                }
            }

            if (localContact) {
                locationId = localContact.locationId;
                contact = { id: localContact.id, ghlContactId: localContact.ghlContactId ?? null };

                try {
                    const conversation = await db.conversation.upsert({
                        where: {
                            locationId_contactId: {
                                locationId: localContact.locationId,
                                contactId: localContact.id,
                            },
                        },
                        create: {
                            contactId: localContact.id,
                            locationId: localContact.locationId,
                            ghlConversationId: `native-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                            status: 'open',
                            lastMessageType: 'TYPE_EMAIL',
                        },
                        update: {},
                    });
                    conversationId = conversation.id;
                } catch (err) {
                    console.error('[Gmail Sync] Conversation upsert failed, retrying find:', err);
                    const existing = await db.conversation.findFirst({
                        where: { contactId: localContact.id, locationId: localContact.locationId },
                    });
                    if (existing) conversationId = existing.id;
                }
            }
        }

        if (!conversationId) {
            console.log(`[Gmail Sync] Skipped message ${messageId}: No matching contact found for ${targetEmail}`);
            return;
        }

        let isNewMessage = false;
        try {
            await db.message.create({
                data: {
                    conversationId,
                    emailMessageId: messageId,
                    emailThreadId: data.threadId,
                    type: 'Email',
                    direction,
                    status: 'delivered',
                    subject,
                    body,
                    emailFrom: from,
                    emailTo: to,
                    createdAt: new Date(internalDate),
                    source: 'GMAIL_SYNC',
                },
            });
            isNewMessage = true;
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                isNewMessage = false;
            } else {
                throw error;
            }
        }

        if (!isNewMessage) {
            console.log(`[Gmail Sync] Duplicate message ${messageId}; skipping side effects.`);
            return;
        }

        if (locationId && contact) {
            const location = await db.location.findUnique({ where: { id: locationId } });

            if (location?.ghlAccessToken && location?.ghlLocationId) {
                let ghlContactId = contact.ghlContactId;
                if (!ghlContactId) {
                    try {
                        const { ensureRemoteContact } = await import('@/lib/crm/contact-sync');
                        ghlContactId = await ensureRemoteContact(contact.id, location.ghlLocationId, location.ghlAccessToken);
                        if (ghlContactId) {
                            console.log(`[Gmail Sync] Created/linked GHL contact: ${ghlContactId}`);
                        }
                    } catch (e) {
                        console.warn(`[Gmail Sync] Could not ensure remote contact for ${contact.id}:`, e);
                    }
                }

                if (ghlContactId) {
                    await createInboundMessage(location.ghlAccessToken, {
                        type: 'Email',
                        contactId: ghlContactId,
                        direction,
                        status: 'delivered',
                        subject,
                        html: body,
                        emailFrom: extractEmail(from) || undefined,
                        emailTo: extractEmail(to) || undefined,
                        dateAdded: internalDate,
                        threadId: data.threadId || undefined,
                    }).catch((e) => console.error('Failed to log to GHL:', e));
                } else {
                    console.log(`[Gmail Sync] Skipping GHL logging for ${targetEmail}: No GHL contact ID available`);
                }
            }
        }

        const { updateConversationLastMessage } = await import('@/lib/conversations/update');
        const shouldIncrementUnread =
            options.countUnread !== false &&
            direction === 'inbound' &&
            hasUnreadLabel;

        await updateConversationLastMessage({
            conversationId,
            messageBody: body,
            messageType: 'TYPE_EMAIL',
            messageDate: new Date(internalDate),
            direction,
            unreadCountIncrement: shouldIncrementUnread ? 1 : 0,
        });

        console.log(`[Gmail Sync] Synced message ${messageId} for contact ${targetEmail}`);
    } catch (error) {
        console.error(`[Gmail Sync] Error processing message ${messageId}:`, error);
    }
}

// Helper
function extractEmail(text: string): string | null {
    const match = text.match(/<([^>]+)>/);
    if (match) return match[1];
    if (text.includes('@')) return text.trim();
    return null;
}

// Helper to extract display name from email header like "John Doe <john@example.com>"
function extractDisplayName(text: string): string | null {
    const match = text.match(/^(.+?)\s*<.+>$/);
    if (match?.[1]) {
        return match[1].replace(/^["']|["']$/g, '').trim();
    }
    return null;
}
