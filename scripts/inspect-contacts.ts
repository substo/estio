
import db from '../lib/db';

async function inspectContacts() {
    console.log('Inspecting contacts for potential duplicates...');

    // 1. Get all contacts created recently (likely from OWA sync)
    // Assuming OWA sync happened recently
    const contacts = await db.contact.findMany({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }, // Last 24h
        select: { id: true, email: true, name: true, locationId: true, createdAt: true }
    });

    console.log(`Found ${contacts.length} contacts created in last 24h.`);
    console.table(contacts.map(c => ({
        id: c.id,
        email: c.email,
        name: c.name,
        created: c.createdAt.toISOString()
    })));

    // 2. Check for "invalid" emails (no @)
    const invalidEmails = contacts.filter(c => !c.email?.includes('@'));
    if (invalidEmails.length > 0) {
        console.log(`\nFound ${invalidEmails.length} contacts with invalid emails (possible bad sync):`);
        console.table(invalidEmails);
    }
}

inspectContacts()
    .catch(console.error)
    .finally(() => db.$disconnect());
