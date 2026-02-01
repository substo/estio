/**
 * Test Script: Trigger OWA Email Sync
 * 
 * Run with: npx tsx scripts/test-owa-sync.ts
 */

import db from '../lib/db';
import { syncEmailsFromOWA } from '../lib/microsoft/owa-email-sync';

async function testSync() {
    console.log('=== Testing OWA Email Sync ===\n');

    // Find a user with Puppeteer auth enabled
    const user = await db.user.findFirst({
        where: {
            outlookAuthMethod: 'puppeteer',
            outlookSyncEnabled: true
        },
        select: {
            id: true,
            email: true,
            outlookEmail: true
        }
    });

    if (!user) {
        console.log('No user found with Puppeteer auth enabled.');
        console.log('Please connect via Browser Login first.');
        return;
    }

    console.log(`Found user: ${user.email}`);
    console.log(`Outlook account: ${user.outlookEmail}\n`);

    // Count contacts and conversations before sync
    const beforeStats = await getStats(user.id);
    console.log('Before sync:');
    console.log(`  Contacts: ${beforeStats.contacts}`);
    console.log(`  Conversations: ${beforeStats.conversations}`);
    console.log(`  Messages: ${beforeStats.messages}\n`);

    // Run sync
    console.log('Starting sync...\n');
    try {
        const emailCount = await syncEmailsFromOWA(user.id, 'inbox');
        console.log(`\nSync complete! Processed ${emailCount} emails.\n`);
    } catch (error: any) {
        console.error('Sync failed:', error.message);
        return;
    }

    // Count after sync
    const afterStats = await getStats(user.id);
    console.log('After sync:');
    console.log(`  Contacts: ${afterStats.contacts} (${afterStats.contacts - beforeStats.contacts > 0 ? '+' : ''}${afterStats.contacts - beforeStats.contacts})`);
    console.log(`  Conversations: ${afterStats.conversations} (${afterStats.conversations - beforeStats.conversations > 0 ? '+' : ''}${afterStats.conversations - beforeStats.conversations})`);
    console.log(`  Messages: ${afterStats.messages} (${afterStats.messages - beforeStats.messages > 0 ? '+' : ''}${afterStats.messages - beforeStats.messages})`);

    // Check for duplicates
    console.log('\n=== Checking for Duplicates ===');
    const duplicates = await db.$queryRaw<Array<{ email: string; count: bigint }>>`
        SELECT email, COUNT(*) as count
        FROM "Contact"
        WHERE email IS NOT NULL
        GROUP BY email
        HAVING COUNT(*) > 1
    `;

    if (duplicates.length === 0) {
        console.log('✅ No duplicate contacts found!');
    } else {
        console.log('⚠️  Found duplicate contacts:');
        for (const dup of duplicates) {
            console.log(`  ${dup.email}: ${dup.count} duplicates`);
        }
    }
}

async function getStats(userId: string) {
    const user = await db.user.findUnique({
        where: { id: userId },
        include: { locations: { take: 1 } }
    });

    if (!user?.locations?.[0]) {
        return { contacts: 0, conversations: 0, messages: 0 };
    }

    const locationId = user.locations[0].id;

    const contacts = await db.contact.count({ where: { locationId } });
    const conversations = await db.conversation.count({ where: { locationId } });
    const messages = await db.message.count({
        where: { conversation: { locationId } }
    });

    return { contacts, conversations, messages };
}

testSync()
    .catch(console.error)
    .finally(() => db.$disconnect());
