import { google, gmail_v1 } from 'googleapis';
import { getValidAccessToken } from './auth';
import db from '@/lib/db';
import { createInboundMessage } from '@/lib/ghl/conversations';

/**
 * Core Engine for Native Gmail Sync
 */

// Helper to parse header values
function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string | null {
    if (!headers) return null;
    const header = headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
    return header?.value || null;
}

// Helper to get body from payload
function getBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
    if (!payload) return '';

    let body = '';

    // If it has a body.data directly (plain text/html in simple messages)
    if (payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    // If it has parts (multipart/alternative or mixed)
    if (payload.parts) {
        // Prioritize HTML, then Plain Text
        const htmlPart = payload.parts.find(p => p.mimeType === 'text/html');
        const textPart = payload.parts.find(p => p.mimeType === 'text/plain');

        if (htmlPart && htmlPart.body?.data) {
            return Buffer.from(htmlPart.body.data, 'base64').toString('utf-8');
        }
        if (textPart && textPart.body?.data) {
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

export async function syncRecentMessages(userId: string) {
    console.log(`[Gmail Sync] Starting initial sync for user ${userId}`);
    const client = await getValidAccessToken(userId);
    const gmail = google.gmail({ version: 'v1', auth: client });

    // 1. Get Profile to know our own email (for direction)
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const myEmail = profile.data.emailAddress;

    // 2. List messages
    const res = await gmail.users.messages.list({
        userId: 'me',
        q: 'after:2024/01/01', // Reasonable default for "recent"
        maxResults: 50, // Batch size
    });

    const messages = res.data.messages || [];
    console.log(`[Gmail Sync] Found ${messages.length} messages to sync`);

    // 3. Process each message
    for (const msgStub of messages) {
        if (!msgStub.id) continue;
        await processMessage(gmail, userId, msgStub.id, myEmail!);
    }

    // 4. Update Sync State with latest history ID
    // We fetch a fresh profile or use list result historyId
    const freshProfile = await gmail.users.getProfile({ userId: 'me' });
    if (freshProfile.data.historyId) {
        await db.gmailSyncState.upsert({
            where: { userId },
            create: { userId, historyId: freshProfile.data.historyId, emailAddress: myEmail },
            update: { historyId: freshProfile.data.historyId, lastSyncedAt: new Date(), emailAddress: myEmail }
        });
    }
    if (freshProfile.data.historyId) {
        await db.gmailSyncState.upsert({
            where: { userId },
            create: { userId, historyId: freshProfile.data.historyId, emailAddress: myEmail },
            update: { historyId: freshProfile.data.historyId, lastSyncedAt: new Date(), emailAddress: myEmail }
        });
    }
}

export async function watchGmail(userId: string) {
    console.log(`[Gmail Sync] Setting up watch for user ${userId}`);
    const client = await getValidAccessToken(userId);
    const gmail = google.gmail({ version: 'v1', auth: client });

    const topicName = `projects/${process.env.GOOGLE_CLOUD_PROJECT_ID || 'estio-crm'}/topics/gmail-sync`; // Make sure to set env or hardcode consistent id

    const res = await gmail.users.watch({
        userId: 'me',
        requestBody: {
            topicName: topicName,
            labelIds: ['INBOX'], // Watch Inbox
        }
    });

    console.log(`[Gmail Sync] Watch initialized. History ID: ${res.data.historyId}, Expiration: ${res.data.expiration}`);

    // Store expiration to know when to refresh
    if (res.data.historyId) {
        // We might not have emailAddress here easily without profile call, 
        // but syncRecentMessages usually runs first or concurrently.
        // Let's just update if exists or we can't really simple upsert without email.
        // Actually, let's just let syncRecentMessages handle the creation/full update.
        // We just log for now, or update if record exists.

        await db.gmailSyncState.updateMany({
            where: { userId },
            data: {
                historyId: res.data.historyId,
                watchExpiration: res.data.expiration ? new Date(parseInt(res.data.expiration)) : undefined
            }
        });
    }

    return res.data;
}

export async function processMessage(gmail: gmail_v1.Gmail, userId: string, messageId: string, myEmail: string) {
    try {
        // Check if exists first to skip expensive fetch? 
        // Can add optimization here.

        const fullMsg = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full'
        });

        const data = fullMsg.data;
        const headers = data.payload?.headers;

        const subject = getHeader(headers, 'Subject') || '(No Subject)';
        const from = getHeader(headers, 'From') || '';
        const to = getHeader(headers, 'To') || '';
        const dateStr = getHeader(headers, 'Date');
        const internalDate = data.internalDate ? parseInt(data.internalDate) : Date.now();

        // Determine direction
        // Simple logic: If 'From' contains myEmail, it's outbound. Else inbound.
        const isOutbound = from.includes(myEmail);
        const direction = isOutbound ? 'outbound' : 'inbound';

        const body = getBody(data.payload);

        // Find Conversation: We need a Contact.
        // For inbound: Contact is 'From'. For outbound: Contact is 'To'.
        const targetEmail = isOutbound ? extractEmail(to) : extractEmail(from);

        let conversationId: string | undefined;
        let contactId: string | undefined;

        if (targetEmail) {
            // Find contact by email in this user's locations? 
            // This is complex because User -> Locations -> Contacts.
            // Simplified: Find ANY contact with this email in a location the user has access to.
            // For now, let's look for a contact globally or in primary location.
            const contact = await db.contact.findFirst({
                where: { email: targetEmail }
            });

            if (contact) {
                contactId = contact.id;
                // Find or Create Conversation with Atomic Upsert
                // We use the new unique constraint [locationId, contactId] to prevent race conditions
                try {
                    const conversation = await db.conversation.upsert({
                        where: {
                            locationId_contactId: {
                                locationId: contact.locationId,
                                contactId: contact.id
                            }
                        },
                        create: {
                            contactId: contact.id,
                            locationId: contact.locationId,
                            ghlConversationId: `native-${Date.now()}-${Math.random().toString(36).substring(7)}`, // Ensure uniqueness for GHL ID too
                            status: 'open',
                            lastMessageType: 'TYPE_EMAIL'
                        },
                        update: {} // No stats update needed just for fetching the ID
                    });
                    conversationId = conversation.id;
                } catch (err) {
                    // Fallback: If upsert failed (rare edge case with GHL ID unique constraint?), try find again
                    console.error("[Gmail Sync] Upsert failed, retrying find:", err);
                    const existing = await db.conversation.findFirst({
                        where: { contactId: contact.id, locationId: contact.locationId }
                    });
                    if (existing) conversationId = existing.id;
                }

                // --- GHL LOGGING HOOK ---
                // If we found a contact, we should ensure GHL knows about this message.
                // We do this asynchronously/independently.
                const location = await db.location.findUnique({ where: { id: contact.locationId } });
                if (location?.ghlAccessToken) {
                    await createInboundMessage(location.ghlAccessToken, {
                        type: 'Email',
                        contactId: contact.ghlContactId || '', // Need GHL Contact ID
                        direction: direction,
                        status: 'delivered', // Assume delivered if in Gmail
                        subject: subject,
                        html: body,
                        emailFrom: extractEmail(from) || undefined,
                        emailTo: extractEmail(to) || undefined,
                        dateAdded: internalDate,
                        threadId: data.threadId || undefined // Use Gmail Thread ID for grouping
                    }).catch(e => console.error("Failed to log to GHL:", e));
                }
            }
        }

        // If no conversation found (contact unknown), we can optionally create a "Ghost" contact or just skip associating.
        // For Native Sync V1, we require a Message record to store the cached email.
        // But Message requires ConversationId in schema? Yes.
        // So allow Orphan messages? No, schema says `conversationId` is required.
        // If no contact found, we SKIP saving to DB for now (cleaner than creating junk contacts).
        if (!conversationId) {
            console.log(`[Gmail Sync] Skipped message ${messageId}: No matching contact found for ${targetEmail}`);
            return;
        }

        // Upsert Message
        await db.message.upsert({
            where: { emailMessageId: messageId },
            create: {
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
                source: 'GMAIL_SYNC'
            },
            update: {
                // Update status or body if changed? Usually immutable.
                emailThreadId: data.threadId
            }
        });

        console.log(`[Gmail Sync] Synced message ${messageId} for contact ${targetEmail}`);

    } catch (error) {
        console.error(`[Gmail Sync] Error processing message ${messageId}:`, error);
    }
}

// Helper
function extractEmail(text: string): string | null {
    const match = text.match(/<(.+)>/);
    if (match) return match[1];
    if (text.includes('@')) return text.trim();
    return null;
}
