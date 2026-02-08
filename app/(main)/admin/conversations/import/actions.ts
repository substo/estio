'use server';

import { redirect } from 'next/navigation';
import db from '@/lib/db';
import { getLocationContext } from '@/lib/auth/location-context';
import { parseWhatsAppExport, ParsedMessage } from '@/lib/whatsapp/import-parser';

// Helper to get location
async function getLocation() {
    const location = await getLocationContext();
    if (!location) {
        throw new Error("Unauthorized");
    }
    return location;
}

/**
 * Create a new import session from uploaded file content
 */
export async function createImportSession(fileName: string, fileContent: string) {
    const location = await getLocation();

    // Parse the content
    const parseResult = await parseWhatsAppExport(fileContent);

    if (parseResult.errors.length > 0 && parseResult.messageCount === 0) {
        return {
            success: false,
            error: parseResult.errors.join(', ')
        };
    }

    // Create session
    const session = await db.whatsAppImportSession.create({
        data: {
            locationId: location.id,
            fileName,
            status: 'mapping',
            rawContent: fileContent,
            parsedData: parseResult.messages as any,
            uniqueAuthors: parseResult.uniqueAuthors,
            messageCount: parseResult.messageCount,
        }
    });

    return {
        success: true,
        sessionId: session.id,
        uniqueAuthors: parseResult.uniqueAuthors,
        messageCount: parseResult.messageCount,
        preview: parseResult.messages.slice(0, 10)
    };
}

/**
 * Get an import session by ID
 */
export async function getImportSession(sessionId: string) {
    const location = await getLocation();

    const session = await db.whatsAppImportSession.findFirst({
        where: {
            id: sessionId,
            locationId: location.id
        }
    });

    if (!session) {
        return null;
    }

    return session;
}

/**
 * Get contacts for mapping dropdown
 */
export async function getContactsForMapping() {
    const location = await getLocation();

    const contacts = await db.contact.findMany({
        where: { locationId: location.id },
        select: {
            id: true,
            name: true,
            phone: true,
            email: true,
        },
        orderBy: { name: 'asc' }
    });

    return contacts;
}

/**
 * Save contact mappings for a session
 */
export async function saveContactMappings(
    sessionId: string,
    mappings: Record<string, string | null>, // { "Display Name": "contactId" or null to skip }
    ownerAuthor: string | null // Which author is "me" (outbound messages)
) {
    const location = await getLocation();

    const session = await db.whatsAppImportSession.findFirst({
        where: {
            id: sessionId,
            locationId: location.id
        }
    });

    if (!session) {
        return { success: false, error: 'Session not found' };
    }

    await db.whatsAppImportSession.update({
        where: { id: sessionId },
        data: {
            contactMappings: { ...mappings, __owner__: ownerAuthor },
            status: 'ready'
        }
    });

    return { success: true };
}

/**
 * Execute the import - create conversations and messages
 */
export async function executeImport(sessionId: string) {
    const location = await getLocation();

    const session = await db.whatsAppImportSession.findFirst({
        where: {
            id: sessionId,
            locationId: location.id
        }
    });

    if (!session) {
        return { success: false, error: 'Session not found' };
    }

    if (!session.contactMappings) {
        return { success: false, error: 'No contact mappings found' };
    }

    const allMappings = session.contactMappings as Record<string, string | null>;
    const ownerAuthor = allMappings.__owner__ || null;

    // Remove __owner__ from mappings for contact lookup
    const mappings = { ...allMappings };
    delete mappings.__owner__;

    const messages = session.parsedData as unknown as ParsedMessage[];

    try {
        await db.whatsAppImportSession.update({
            where: { id: sessionId },
            data: { status: 'importing' }
        });

        // Group messages by contact (excluding owner's messages for now - we'll add those to each contact's conversation)
        const messagesByContact: Record<string, Array<ParsedMessage & { isOwner: boolean }>> = {};

        for (const msg of messages) {
            if (!msg.author) continue;

            const isOwner = msg.author === ownerAuthor;

            if (isOwner) {
                // Owner messages: add to ALL mapped contacts' conversations
                // (since this is a 1:1 chat export, owner messages go to the contact they were chatting with)
                for (const [author, contactId] of Object.entries(mappings)) {
                    if (contactId && author !== ownerAuthor) {
                        if (!messagesByContact[contactId]) {
                            messagesByContact[contactId] = [];
                        }
                        messagesByContact[contactId].push({ ...msg, isOwner: true });
                    }
                }
            } else {
                // Contact messages: add to that contact's conversation
                const contactId = mappings[msg.author];
                if (!contactId) continue;

                if (!messagesByContact[contactId]) {
                    messagesByContact[contactId] = [];
                }
                messagesByContact[contactId].push({ ...msg, isOwner: false });
            }
        }

        let importedCount = 0;
        let conversationsCreated = 0;

        // For each contact, find or create conversation and add messages
        for (const [contactId, contactMessages] of Object.entries(messagesByContact)) {
            // Find or create conversation
            let conversation = await db.conversation.findFirst({
                where: {
                    locationId: location.id,
                    contactId: contactId
                }
            });

            if (!conversation) {
                // Create a new conversation with a generated ghlConversationId for imported chats
                conversation = await db.conversation.create({
                    data: {
                        locationId: location.id,
                        contactId: contactId,
                        ghlConversationId: `wa_import_${sessionId}_${contactId}`,
                        status: 'open',
                        lastMessageType: 'TYPE_WHATSAPP'
                    }
                });
                conversationsCreated++;
            }

            // Insert messages (sorted by date)
            const sortedMessages = contactMessages.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

            for (const msg of sortedMessages) {
                const existingMessage = await db.message.findFirst({
                    where: {
                        conversationId: conversation.id,
                        createdAt: msg.date,
                        body: msg.message
                    }
                });

                if (existingMessage) continue; // Skip duplicates

                await db.message.create({
                    data: {
                        conversationId: conversation.id,
                        ghlMessageId: `wa_import_${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                        type: 'TYPE_WHATSAPP',
                        direction: msg.isOwner ? 'outbound' : 'inbound',
                        status: 'delivered',
                        body: msg.message,
                        createdAt: msg.date
                    }
                });
                importedCount++;
            }

            // Update conversation last message
            const lastMsg = contactMessages[contactMessages.length - 1];
            await db.conversation.update({
                where: { id: conversation.id },
                data: {
                    lastMessageBody: lastMsg.message,
                    lastMessageAt: lastMsg.date
                }
            });
        }

        // Mark session complete
        await db.whatsAppImportSession.update({
            where: { id: sessionId },
            data: { status: 'complete' }
        });

        return {
            success: true,
            importedCount,
            conversationsCreated
        };

    } catch (error: any) {
        await db.whatsAppImportSession.update({
            where: { id: sessionId },
            data: {
                status: 'failed',
                errorMessage: error.message
            }
        });

        return { success: false, error: error.message };
    }
}

/**
 * Get all import sessions for the current location
 */
export async function getImportSessions() {
    const location = await getLocation();

    const sessions = await db.whatsAppImportSession.findMany({
        where: { locationId: location.id },
        orderBy: { createdAt: 'desc' },
        take: 20
    });

    return sessions;
}

/**
 * Execute a direct import into a specific conversation (for modal-based import)
 * 
 * @param conversationId - The GHL conversation ID to import into
 * @param fileContent - The raw .txt file content
 * @param ownerAuthor - Which author in the file is "me" (outbound messages)
 */
export async function executeDirectImport(
    conversationId: string,
    fileContent: string,
    ownerAuthor: string
) {
    const location = await getLocation();

    // 1. Find the conversation and its contact
    const conversation = await db.conversation.findFirst({
        where: {
            ghlConversationId: conversationId,
            locationId: location.id
        },
        include: {
            contact: true
        }
    });

    if (!conversation) {
        return { success: false, error: 'Conversation not found' };
    }

    if (!conversation.contact) {
        return { success: false, error: 'Conversation has no linked contact' };
    }

    // 2. Parse the file
    const parseResult = await parseWhatsAppExport(fileContent);

    if (parseResult.errors.length > 0 && parseResult.messageCount === 0) {
        return {
            success: false,
            error: parseResult.errors.join(', ')
        };
    }

    if (parseResult.messageCount === 0) {
        return { success: false, error: 'No messages found in the file' };
    }

    // 3. Validate ownerAuthor exists in the file
    if (!parseResult.uniqueAuthors.includes(ownerAuthor)) {
        return { success: false, error: `Author "${ownerAuthor}" not found in the file` };
    }

    // 4. Import messages
    const messages = parseResult.messages;
    let importedCount = 0;
    let skippedCount = 0;

    // Sort by date
    const sortedMessages = messages.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    for (const msg of sortedMessages) {
        if (!msg.author) continue;

        const isOwner = msg.author === ownerAuthor;

        // Check for duplicate
        const existingMessage = await db.message.findFirst({
            where: {
                conversationId: conversation.id,
                createdAt: msg.date,
                body: msg.message
            }
        });

        if (existingMessage) {
            skippedCount++;
            continue;
        }

        // Create message
        await db.message.create({
            data: {
                conversationId: conversation.id,
                ghlMessageId: `wa_import_direct_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                type: 'TYPE_WHATSAPP',
                direction: isOwner ? 'outbound' : 'inbound',
                status: 'delivered',
                body: msg.message,
                createdAt: msg.date
            }
        });
        importedCount++;
    }

    // 5. Update conversation's lastMessageAt if we imported anything
    if (importedCount > 0) {
        const lastMsg = sortedMessages[sortedMessages.length - 1];

        // Only update if the imported message is more recent
        const shouldUpdate = !conversation.lastMessageAt || new Date(lastMsg.date) > conversation.lastMessageAt;

        if (shouldUpdate) {
            await db.conversation.update({
                where: { id: conversation.id },
                data: {
                    lastMessageBody: lastMsg.message,
                    lastMessageAt: lastMsg.date
                }
            });
        }
    }

    return {
        success: true,
        importedCount,
        skippedCount,
        totalParsed: parseResult.messageCount,
        authors: parseResult.uniqueAuthors
    };
}

/**
 * Parse a WhatsApp export file and return metadata (for modal preview)
 */
export async function parseWhatsAppFile(fileContent: string) {
    const parseResult = await parseWhatsAppExport(fileContent);

    if (parseResult.errors.length > 0 && parseResult.messageCount === 0) {
        return {
            success: false,
            error: parseResult.errors.join(', ')
        };
    }

    return {
        success: true,
        messageCount: parseResult.messageCount,
        uniqueAuthors: parseResult.uniqueAuthors,
        preview: parseResult.messages.slice(0, 5)
    };
}
