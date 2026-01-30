import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DIRECT_URL || process.env.DATABASE_URL
        }
    }
});

async function main() {
    const phone = '+48502193973';
    console.log(`Inspecting contact with phone: ${phone}`);

    // Clean phone for matching
    const rawInput = phone.replace(/\D/g, '');
    const suffix = rawInput.slice(-3);

    const contacts = await db.contact.findMany({
        where: {
            phone: { contains: suffix }
        },
        include: {
            conversations: {
                include: { messages: true }
            }
        }
    });

    // Strict filter
    const matches = contacts.filter(c => {
        if (!c.phone) return false;
        const rawDb = c.phone.replace(/\D/g, '');
        return rawDb.includes(rawInput) || rawInput.includes(rawDb);
    });

    console.log(`Found ${matches.length} matching contacts.`);

    for (const c of matches) {
        console.log(`\nContact: ${c.name} (${c.phone}) - ID: ${c.id}`);
        console.log(`GHL ID: ${c.ghlContactId}`);
        console.log(`Conversations: ${c.conversations.length}`);

        c.conversations.forEach((conv, i) => {
            console.log(`  ${i + 1}. ID: ${conv.id}`);
            console.log(`     GHL Conv ID: ${conv.ghlConversationId}`);
            console.log(`     Status: ${conv.status}`);
            console.log(`     Messages: ${conv.messages.length}`);
            console.log(`     Last Msg: ${conv.lastMessageAt}`);
        });
    }
}

main()
    .catch(console.error)
    .finally(() => db.$disconnect());
