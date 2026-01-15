import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DIRECT_URL || process.env.DATABASE_URL
        }
    }
});

async function main() {
    console.log("Starting Same-Contact Conversation Merge...");

    // 1. Find all contacts that have > 1 conversation
    const contactsWithMultiple = await db.contact.findMany({
        where: {
            // Prisma doesn't support "having count > 1" easily in findMany
            // We have to fetch or use groupBy.
            // Let's use groupBy to find the IDs first.
        },
        include: {
            conversations: {
                orderBy: { createdAt: 'desc' }, // Latest first
                include: { messages: true }
            }
        }
    });

    // Filtering in memory (not efficient for 1M records, but fine for now)
    const targets = contactsWithMultiple.filter(c => c.conversations.length > 1);

    console.log(`Found ${targets.length} contacts with multiple conversations.`);

    let mergedCount = 0;

    for (const contact of targets) {
        if (contact.conversations.length <= 1) continue;

        console.log(`\nMerging conversations for ${contact.name || contact.phone || contact.id}...`);

        // Strategy: Keep the one with the MOST messages, or if equal, the OLDest (stable ID)?
        // Or keep the NEWest? 
        // User wants "one conversation". Usually the one that is "open" and most active.

        // Let's sort by message count descending
        const sorted = [...contact.conversations].sort((a, b) => b.messages.length - a.messages.length);

        const master = sorted[0];
        const duplicates = sorted.slice(1);

        console.log(`  Master: ${master.id} (${master.messages.length} msgs)`);

        for (const dup of duplicates) {
            console.log(`  Merging Dup: ${dup.id} (${dup.messages.length} msgs)`);

            // Move messages
            if (dup.messages.length > 0) {
                await db.message.updateMany({
                    where: { conversationId: dup.id },
                    data: { conversationId: master.id }
                });
            }

            // Sync last message info if Dup was newer
            if (dup.lastMessageAt > master.lastMessageAt) {
                await db.conversation.update({
                    where: { id: master.id },
                    data: {
                        lastMessageAt: dup.lastMessageAt,
                        lastMessageBody: dup.lastMessageBody,
                        lastMessageType: dup.lastMessageType,
                    }
                });
            }

            // Delete Dup
            await db.conversation.delete({ where: { id: dup.id } });
        }
        mergedCount++;
    }

    console.log(`\nDone. Merged conversations for ${mergedCount} contacts.`);
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
