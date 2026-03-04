import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("Checking recent Conversations...");
    const convs = await prisma.conversation.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
            id: true,
            ghlConversationId: true,
            contactId: true,
            updatedAt: true,
            contact: {
                select: {
                    id: true,
                    ghlContactId: true,
                    name: true
                }
            }
        }
    });

    console.log(JSON.stringify(convs, null, 2));

    // Are there any viewings that recently failed? We can't query that directly,
    // but we can query contacts.
    const suspiciousContacts = await prisma.contact.findMany({
        where: {
            id: { not: { startsWith: 'c' } } // cuids start with 'c'
        },
        take: 5
    });
    console.log("Contacts with non-cuid IDs:", suspiciousContacts.map(c => c.id));
}

main().catch(console.error).finally(() => prisma.$disconnect());
