
/**
 * Cleanup Script V2: Remove duplicates and invalid emails from Outlook Sync
 * 
 * Run with: npx tsx scripts/cleanup-owa-duplicates-v2.ts
 */

import db from '../lib/db';

async function cleanupDuplicates() {
    console.log('Starting enhanced duplicate cleanup...\n');

    /**
     * Helper to extract clean email
     */
    function extractEmailHelper(text: string): string | null {
        if (!text) return null;
        // Try to extract from "Name <email>" format
        const match = text.match(/<([^>]+@[^>]+)>/);
        if (match) return match[1].toLowerCase().trim();
        // If it looks like a plain email, return it
        if (text.includes('@')) return text.toLowerCase().trim();
        return null;
    }

    // 1. Find and Clean Invalid Email Contacts (no @ or just names)
    console.log('=== 1. Cleaning Invalid Email Contacts ===');

    // We fetch contacts with non-null emails first, then filter in JS to be safe with prisma
    const allContacts = await db.contact.findMany({
        where: {
            email: { not: null },
            // Optional: Limit to recent contacts to be safe? Or all time.
            // Let's do all time but check for source/type if possible
        },
        select: { id: true, email: true, name: true, locationId: true, createdAt: true },
        orderBy: { createdAt: 'desc' }
    });

    let invalidCount = 0;

    for (const c of allContacts) {
        if (!c.email) continue;

        // Check if email is valid (contains @)
        if (!c.email.includes('@')) {
            console.log(`Found invalid email contact: ${c.name} (${c.email}) - ID: ${c.id}`);

            // Delete it (cascades to conversations/messages usually, or we delete manually)
            // But wait, what if it has meaningful messages?
            // If it came from OWA sync with a garbage name as email, it likely has messages attached.
            // We should TRY to extract a real email from the messages if possible? 
            // Too complex for now. Delete is safer for garbage data like "Martin Jarzyna" as email.

            await db.conversation.deleteMany({ where: { contactId: c.id } });
            await db.contact.delete({ where: { id: c.id } });
            invalidCount++;
        }
    }
    console.log(`Deleted ${invalidCount} invalid contacts.\n`);

    // 2. Find and Merge Duplicates (same normalized email)
    console.log('=== 2. Merging Duplicate Contacts ===');

    // Re-fetch active contacts
    const validContacts = await db.contact.findMany({
        where: { email: { not: null } },
        include: {
            conversations: {
                include: { messages: true }
            }
        },
        orderBy: { createdAt: 'asc' } // Oldest first
    });

    // Group by NORMALIZED email + locationId
    const groups = new Map<string, typeof validContacts>();

    for (const c of validContacts) {
        if (!c.email) continue;
        const normalized = extractEmailHelper(c.email);
        if (!normalized) continue;

        const key = `${c.locationId}:${normalized}`;
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)?.push(c);
    }

    let mergedCount = 0;

    for (const [key, contacts] of groups) {
        if (contacts.length <= 1) continue;

        const [email] = key.split(':').slice(1);
        console.log(`Processing duplicates for: ${email} (${contacts.length} found)`);

        // Keep the oldest one (first in array), OR better yet, keep the one with the MOST clean email format?
        // Actually oldest is usually best ID stability.
        // But if one has specific Google Contact ID or GHL ID, prefer that one.

        // Simple strategy: Keep the first one (oldest)
        const [keepContact, ...duplicates] = contacts;

        console.log(`  Keeping Main Contact: ${keepContact.id} (${keepContact.email})`);

        // Find or create main conversation
        let mainConversation = await db.conversation.findFirst({
            where: { contactId: keepContact.id }
        });

        // If main doesn't have query, maybe one of duplicates has?
        // If not, we might create one later or when messages move.
        // Actually we need a target conversation ID to move messages TO.
        if (!mainConversation) {
            // Create one if needed or hijack one from duplicates?
            // Let's create one if missing
            mainConversation = await db.conversation.create({
                data: {
                    contactId: keepContact.id,
                    locationId: keepContact.locationId,
                    ghlConversationId: `merged_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    status: 'open'
                }
            });
        }

        for (const dup of duplicates) {
            console.log(`  Merging duplicate: ${dup.id} (${dup.email})`);

            // Move messages
            for (const conv of dup.conversations) {
                const count = await db.message.updateMany({
                    where: { conversationId: conv.id },
                    data: { conversationId: mainConversation.id }
                });
                console.log(`    Moved ${count.count} messages`);

                // Delete duplicate conversation
                await db.conversation.delete({ where: { id: conv.id } }).catch(() => { });
            }

            // Cleanup duplicate contact
            await db.contact.delete({ where: { id: dup.id } }).catch(() => { });
            mergedCount++;
        }

        // Update main contact email to normalized version if needed?
        if (keepContact.email !== email) {
            await db.contact.update({
                where: { id: keepContact.id },
                data: { email: email }
            });
            console.log(`  Updated main contact email to normalized: ${email}`);
        }
    }

    console.log(`\nMerged ${mergedCount} duplicate contacts.`);
    console.log('Cleanup V2 Complete!');
}

cleanupDuplicates()
    .catch(console.error)
    .finally(() => db.$disconnect());
