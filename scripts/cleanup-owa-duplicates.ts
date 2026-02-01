/**
 * Cleanup Script: Remove duplicate contacts and conversations
 * 
 * Run with: npx tsx scripts/cleanup-owa-duplicates.ts
 */

import db from '../lib/db';

async function cleanupDuplicates() {
    console.log('Starting duplicate cleanup...\n');

    // 1. Find duplicate contacts (same email + locationId)
    console.log('=== Finding Duplicate Contacts ===');

    const duplicateEmails = await db.$queryRaw<Array<{ email: string; locationId: string; count: bigint }>>`
        SELECT email, "locationId", COUNT(*) as count
        FROM "Contact"
        WHERE email IS NOT NULL
        GROUP BY email, "locationId"
        HAVING COUNT(*) > 1
    `;

    console.log(`Found ${duplicateEmails.length} emails with duplicates\n`);

    let contactsDeleted = 0;
    let conversationsDeleted = 0;
    let messagesReassigned = 0;

    for (const dup of duplicateEmails) {
        console.log(`Processing: ${dup.email} (${dup.count} duplicates)`);

        // Get all contacts with this email
        const contacts = await db.contact.findMany({
            where: {
                email: dup.email,
                locationId: dup.locationId
            },
            orderBy: { createdAt: 'asc' }, // Keep the oldest one
            include: {
                conversations: {
                    include: {
                        messages: true
                    }
                }
            }
        });

        if (contacts.length <= 1) continue;

        // Keep the first (oldest) contact
        const [keepContact, ...duplicateContacts] = contacts;
        console.log(`  Keeping contact: ${keepContact.id} (created ${keepContact.createdAt})`);

        // Find or create the main conversation to keep
        let mainConversation = await db.conversation.findFirst({
            where: { contactId: keepContact.id }
        });

        // Merge conversations from duplicates into the main contact
        for (const dupContact of duplicateContacts) {
            console.log(`  Merging from duplicate contact: ${dupContact.id}`);

            for (const conv of dupContact.conversations) {
                // Reassign messages to main conversation
                if (mainConversation) {
                    const updateResult = await db.message.updateMany({
                        where: { conversationId: conv.id },
                        data: { conversationId: mainConversation.id }
                    });
                    messagesReassigned += updateResult.count;
                    console.log(`    Reassigned ${updateResult.count} messages from conversation ${conv.id}`);
                }

                // Delete the duplicate conversation
                await db.conversation.delete({
                    where: { id: conv.id }
                }).catch(() => { }); // Ignore if already deleted
                conversationsDeleted++;
            }

            // Delete the duplicate contact
            await db.contact.delete({
                where: { id: dupContact.id }
            }).catch(() => { }); // Ignore if already deleted
            contactsDeleted++;
        }
    }

    // 2. Find orphaned conversations (multiple conversations for same contact)
    console.log('\n=== Finding Duplicate Conversations ===');

    const duplicateConversations = await db.$queryRaw<Array<{ contactId: string; count: bigint }>>`
        SELECT "contactId", COUNT(*) as count
        FROM "Conversation"
        GROUP BY "contactId"
        HAVING COUNT(*) > 1
    `;

    console.log(`Found ${duplicateConversations.length} contacts with multiple conversations\n`);

    for (const dup of duplicateConversations) {
        const conversations = await db.conversation.findMany({
            where: { contactId: dup.contactId },
            orderBy: { createdAt: 'asc' },
            include: { messages: true }
        });

        if (conversations.length <= 1) continue;

        const [keepConv, ...duplicateConvs] = conversations;
        console.log(`Contact ${dup.contactId}: Keeping conversation ${keepConv.id}`);

        for (const conv of duplicateConvs) {
            // Reassign messages
            const updateResult = await db.message.updateMany({
                where: { conversationId: conv.id },
                data: { conversationId: keepConv.id }
            });
            messagesReassigned += updateResult.count;

            // Delete duplicate conversation
            await db.conversation.delete({
                where: { id: conv.id }
            }).catch(() => { });
            conversationsDeleted++;
            console.log(`  Deleted conversation ${conv.id}, moved ${updateResult.count} messages`);
        }
    }

    console.log('\n=== Cleanup Summary ===');
    console.log(`Contacts deleted: ${contactsDeleted}`);
    console.log(`Conversations deleted: ${conversationsDeleted}`);
    console.log(`Messages reassigned: ${messagesReassigned}`);
    console.log('\nDone!');
}

cleanupDuplicates()
    .catch(console.error)
    .finally(() => db.$disconnect());
