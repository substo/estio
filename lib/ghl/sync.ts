import db from "@/lib/db";
import { getMessages, getConversations, getConversation } from "./conversations";
import { ensureLocalContactSynced } from "@/lib/crm/contact-sync";
import { Prisma } from "@prisma/client";

export async function syncMessageFromWebhook(payload: any) {
    // Normalize Payload (Handling both snake_case and camelCase just in case)
    const type = payload.type; // "InboundMessage" or "OutboundMessage"
    const locationId = payload.locationId;

    // GHL Webhook payload mapping
    const ghlMessageId = payload.id || payload.messageId;
    const ghlConversationId = payload.conversationId;
    const ghlContactId = payload.contactId;

    if (!ghlConversationId || !ghlMessageId || !ghlContactId) {
        console.warn("Skipping sync: Missing required IDs", { ghlConversationId, ghlMessageId, ghlContactId });
        return;
    }

    // 1. Find Location & Contact
    // We assume the contact exists or we perform a JIT sync? 
    // Webhook implies real-time, but contact might be new.
    // For performance, check local first.

    let location = await db.location.findUnique({
        where: { ghlLocationId: locationId }
    });

    if (!location) {
        console.warn(`Skipping sync: Location ${locationId} not found locally.`);
        return;
    }

    let contact = await db.contact.findUnique({
        where: { ghlContactId: ghlContactId }
    });

    if (!contact) {
        // JIT Sync Contact
        try {
            // We need access token... usually stored on Location
            // If location has no token, we can't sync contact from API, unless payload has contact details?
            // Webhook usually has basic details.
            // But let's try to sync if we have token.
            if (location.ghlAccessToken) {
                // [JIT Sync] Ensure contact exists locally (if it's a GHL ID we don't have yet)
                // First, check if we can find it locally by ID or GHL ID
                const existingContact = await db.contact.findFirst({
                    where: {
                        OR: [
                            { id: ghlContactId },
                            { ghlContactId: ghlContactId }
                        ],
                        locationId: location.id
                    },
                    select: { id: true, ghlContactId: true }
                });

                if (!existingContact) {
                    // If not found locally, assume it's a GHL ID and try to sync
                    try {
                        await ensureLocalContactSynced(ghlContactId, location.id, location.ghlAccessToken);
                    } catch (e) {
                        console.warn(`[syncMessageFromWebhook] Skipping sync: Contact ${ghlContactId} could not be resolved locally.`);
                        // If it fails (e.g. 400 Bad Request because it was an internal ID that doesn't exist), we should probably stop?
                        // But we might still want to record the message if we can link it to a conversation?
                        // Actually, if we can't find the contact, we can't really link the message safely unless we create a placeholder.
                        // For now, let's proceed and let the message creation fail if foreign key fails, or handle it.
                    }
                } else if (existingContact.ghlContactId) {
                    // Optionally refresh if it has a GHL ID, but not strictly necessary for every message
                    // await ensureLocalContactSynced(existingContact.ghlContactId, location.id, location.ghlAccessToken);
                }
                contact = await db.contact.findUnique({ where: { ghlContactId: ghlContactId } });
            }
        } catch (e) {
            console.warn("Failed to JIT sync contact during message webhook", e);
        }
    }

    if (!contact) {
        console.warn(`Skipping sync: Contact ${ghlContactId} could not be resolved locally.`);
        return;
    }

    const direction = payload.direction || (type === 'InboundMessage' ? 'inbound' : 'outbound');
    const dateAdded = payload.dateAdded ? new Date(payload.dateAdded) : new Date();
    const body = payload.body || payload.message || '';
    const messageType = payload.messageType || payload.type || 'TYPE_SMS'; // Default fallback

    // 2. Upsert Conversation
    const conversation = await db.conversation.upsert({
        where: { ghlConversationId: ghlConversationId },
        update: {
            // Only update "Last Message" if this new message is newer than what we have
            // But usually webhooks are latest.
            lastMessageBody: body,
            lastMessageAt: dateAdded,
            lastMessageType: messageType,
            unreadCount: {
                increment: direction === 'inbound' ? 1 : 0
            },
            status: 'open',
            updatedAt: new Date()
        },
        create: {
            ghlConversationId: ghlConversationId,
            locationId: location.id,
            contactId: contact.id,
            lastMessageBody: body,
            lastMessageAt: dateAdded,
            lastMessageType: messageType,
            status: 'open',
            unreadCount: direction === 'inbound' ? 1 : 0
        }
    });

    // 3. Upsert Message

    await db.message.upsert({
        where: { ghlMessageId: ghlMessageId },
        update: {
            status: payload.status,
            body: body,
            updatedAt: new Date()
        },
        create: {
            ghlMessageId: ghlMessageId,
            conversationId: conversation.id,
            type: messageType,
            direction: direction,
            status: payload.status || 'sent',
            body: body,
            subject: payload.subject,
            // New Metadata
            emailFrom: payload.emailFrom,
            emailTo: payload.emailTo || payload.email, // simple fallback
            userId: payload.userId,
            source: payload.source,
            createdAt: dateAdded
        }
    });
}

/**
 * Ensures that the conversation history for a given contact is fully synced to the local DB.
 * Use this when opening a contact's chat to guarantee data readiness.
 */
export async function ensureConversationHistory(internalContactId: string, locationId: string, accessToken: string) {
    const contact = await db.contact.findUnique({
        where: { id: internalContactId },
        include: {
            conversations: {
                select: { id: true, ghlConversationId: true, messages: { take: 1 } }
            }
        }
    });

    if (!contact || !contact.ghlContactId) return;

    // Check if we have ANY data.
    // If we have a conversation with messages, assume we are good (for now).
    // A more robust check would be to fetch GHL conversation metadata and compare lastMessageId.
    const hasData = contact.conversations.some(c => c.messages.length > 0);

    // Force sync if empty
    if (!hasData) {
        // Find the conversation ID from database first
        // We know we have a conversation attached to this contact if syncConversationBatch ran, OR we might not.
        // If we don't have a conversation GHL ID, we can't fetch messages easily.

        // 1. Check if we have a conversation linked to this contact
        const storedConv = contact.conversations[0];
        let ghlConversationId = storedConv?.ghlConversationId;

        // If not found, try to find it via GHL API (Search)?
        // OR rely on syncConversationBatch to find it. 
        // If syncConversationBatch ran and didn't find it, it's not in top 20.
        // But let's assume if we are viewing the contact, maybe we can fetch via Search?
        if (!ghlConversationId) {
            console.log(`[History Sync] No local conversation found for contact ${internalContactId}. Trying to sync list...`);
            // We can trigger batch sync again, but maybe ineffective if conv is old.
            // Let's defer to batch sync for now or maybe implement search later.
            return;
        }

        console.log(`[History Sync] Backfilling messages for conversation ${ghlConversationId}...`);

        try {
            const messagesRes = await getMessages(accessToken, ghlConversationId);
            const messagesData = (messagesRes as any)?.messages; // Cast to any to handle structure variations

            let msgArray: any[] = [];
            if (Array.isArray(messagesData)) {
                msgArray = messagesData;
            } else if (messagesData && Array.isArray(messagesData.messages)) {
                msgArray = messagesData.messages;
            } else if (Array.isArray(messagesRes)) { // Some endpoints might return array at top
                msgArray = messagesRes;
            }

            // Upsert all messages
            for (const msg of msgArray) {
                // Determine direction/type using robust inference
                const direction = inferMessageDirection(msg, contact.email || '');
                const dateAdded = msg.dateAdded ? new Date(msg.dateAdded) : new Date();

                await db.message.upsert({
                    where: { ghlMessageId: msg.id },
                    update: {
                        status: msg.status,
                        body: msg.body || '',
                        updatedAt: new Date()
                    },
                    create: {
                        ghlMessageId: msg.id,
                        conversationId: storedConv.id, // Use local ID
                        type: msg.messageType || 'TYPE_SMS', // default
                        direction: direction,
                        status: msg.status || 'sent',
                        body: msg.body || '',
                        subject: msg.subject,
                        // New Metadata from API
                        emailFrom: msg.emailFrom,
                        emailTo: msg.emailTo,
                        userId: msg.userId,
                        source: msg.source,
                        createdAt: dateAdded
                    }
                });
            }
            console.log(`[History Sync] Backfilled ${msgArray.length} messages.`);
        } catch (e) {
            console.error(`[History Sync] Failed to fetch messages for ${ghlConversationId}`, e);
        }
    }
}

/**
 * Robustly infers message direction based on sender, source, and user attribution.
 * See: documentation/ai-agentic-conversations-hub.md
 */
function inferMessageDirection(msg: any, contactEmail: string): 'inbound' | 'outbound' {
    // Priority 1: Contact Match (Email)
    // If sender email matches contact email, it's inbound.
    if (msg.emailFrom && contactEmail && msg.emailFrom.toLowerCase().includes(contactEmail.toLowerCase())) {
        return 'inbound';
    }

    // Priority 2: GHL Explicit Direction
    if (msg.direction === 'inbound' || msg.direction === 'outbound') {
        return msg.direction;
    }

    // Priority 3: User Action (userId present implies usually outbound)
    if (msg.userId) {
        return 'outbound';
    }

    // Priority 4: Source
    const source = (msg.source || '').toLowerCase();
    if (['workflow', 'campaign', 'api', 'bulk_action', 'system', 'public_api', 'mobile_app'].includes(source)) {
        return 'outbound';
    }

    // Priority 5: Heuristic Fallback
    // If source is 'app', it's usually outbound (manual send), UNLESS body contains reply indicators.
    if (source === 'app') {
        // Check for reply indicators in body (simple check)
        const body = (msg.body || '').toLowerCase();
        if (body.includes('wrote:') || body.includes('gmail_quote') || body.includes('yahoo_quoted')) {
            return 'inbound';
        }
        return 'outbound';
    }

    // Default Fallback
    return 'inbound'; // Safer to show on left if unknown? Or outbound? 
    // GHL default often depends. 
    // If we really don't know, maybe 'outbound' is typical for system messages, 'inbound' for replies.
    // Let's stick to GHL 'inbound' default if no cues.
}

export async function syncConversationBatch(accessToken: string, locationId: string, internalLocationId: string) {
    const res = await getConversations(accessToken, {
        locationId: locationId,
        limit: 20,
        status: 'all'
    });

    if (res.conversations) {
        for (const conv of res.conversations) {
            for (const conv of res.conversations) {
                await upsertConversationFromGHL(conv, internalLocationId, accessToken);
            }
        }
    }
}

async function upsertConversationFromGHL(conv: any, internalLocationId: string, accessToken: string) {
    if (!conv.contactId) return;

    let contact = await db.contact.findUnique({
        where: { ghlContactId: conv.contactId }
    });

    if (!contact) {
        // JIT Sync Contact
        try {
            contact = await ensureLocalContactSynced(conv.contactId, internalLocationId, accessToken);
        } catch (e) {
            console.warn(`Failed to JIT sync contact ${conv.contactId}`, e);
        }

        if (!contact) return;
    }

    await db.conversation.upsert({
        where: { ghlConversationId: conv.id },
        update: {
            lastMessageBody: conv.lastMessageBody,
            lastMessageAt: conv.lastMessageDate ? new Date(conv.lastMessageDate < 10000000000 ? conv.lastMessageDate * 1000 : conv.lastMessageDate) : new Date(),
            lastMessageType: conv.lastMessageType || conv.type,
            unreadCount: conv.unreadCount || 0,
            status: conv.status || 'open'
        },
        create: {
            ghlConversationId: conv.id,
            locationId: internalLocationId,
            contactId: contact.id,
            lastMessageBody: conv.lastMessageBody,
            lastMessageAt: conv.lastMessageDate ? new Date(conv.lastMessageDate < 10000000000 ? conv.lastMessageDate * 1000 : conv.lastMessageDate) : new Date(),
            lastMessageType: conv.lastMessageType || conv.type,
            unreadCount: conv.unreadCount || 0,
            status: conv.status || 'open'
        }
    });
}
