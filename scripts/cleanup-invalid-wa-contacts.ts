import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

/**
 * Cleanup Invalid WhatsApp Contacts
 * 
 * This script deletes contacts that have invalid phone numbers, specifically:
 * 1. Phone numbers with 15+ digits (likely LIDs or Group JIDs)
 * 2. Phone numbers containing @g.us (WhatsApp Group JIDs)
 * 3. Phone numbers containing @lid (WhatsApp Privacy LIDs)
 * 4. Phone numbers containing @s.whatsapp.net (should be stripped)
 * 
 * Usage:
 *   npx tsx scripts/cleanup-invalid-wa-contacts.ts [locationId] [--dry-run]
 * 
 * Examples:
 *   npx tsx scripts/cleanup-invalid-wa-contacts.ts                     # Cleanup ALL locations (dangerous!)
 *   npx tsx scripts/cleanup-invalid-wa-contacts.ts cmingx6b10008rdycg7hwesyn            # Cleanup specific location
 *   npx tsx scripts/cleanup-invalid-wa-contacts.ts cmingx6b10008rdycg7hwesyn --dry-run  # Preview without deleting
 */

async function main() {
    const locationId = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
    const DRY_RUN = process.argv.includes('--dry-run');

    console.log('='.repeat(60));
    console.log('[Cleanup] Invalid WhatsApp Contacts Cleanup');
    console.log('='.repeat(60));

    if (DRY_RUN) {
        console.log('[Mode] DRY RUN - No changes will be made');
    } else {
        console.log('[Mode] LIVE - Contacts will be DELETED');
    }

    if (locationId) {
        console.log(`[Scope] Location: ${locationId}`);
    } else {
        console.log('[Scope] ALL LOCATIONS (be careful!)');
    }
    console.log('');

    // Build the where clause
    const whereClause: any = {
        OR: [
            // Pattern 1: Contains WhatsApp suffixes
            { phone: { contains: '@g.us' } },
            { phone: { contains: '@lid' } },
            { phone: { contains: '@s.whatsapp.net' } },
            { phone: { contains: '@c.us' } },
        ]
    };

    if (locationId) {
        whereClause.locationId = locationId;
    }

    // First find all matching contacts
    const invalidContacts = await db.contact.findMany({
        where: whereClause,
        select: {
            id: true,
            name: true,
            phone: true,
            locationId: true,
            createdAt: true,
            contactType: true,
            _count: {
                select: {
                    conversations: true
                }
            }
        }
    });

    // Also find contacts with very long phone numbers (15+ digits)
    const allContacts = await db.contact.findMany({
        where: locationId ? { locationId } : {},
        select: {
            id: true,
            name: true,
            phone: true,
            locationId: true,
            createdAt: true,
            contactType: true,
            _count: {
                select: {
                    conversations: true
                }
            }
        }
    });

    // Filter for long phone numbers
    const longNumberContacts = allContacts.filter(c => {
        if (!c.phone) return false;
        const digitsOnly = c.phone.replace(/\D/g, '');
        return digitsOnly.length >= 15;
    });

    // Combine and deduplicate
    const allInvalidIds = new Set<string>();
    const toDelete: typeof invalidContacts = [];

    for (const c of invalidContacts) {
        if (!allInvalidIds.has(c.id)) {
            allInvalidIds.add(c.id);
            toDelete.push(c);
        }
    }

    for (const c of longNumberContacts) {
        if (!allInvalidIds.has(c.id)) {
            allInvalidIds.add(c.id);
            toDelete.push(c);
        }
    }

    console.log(`[Found] ${toDelete.length} invalid contacts to delete\n`);

    if (toDelete.length === 0) {
        console.log('✅ No invalid contacts found. Database is clean!');
        return;
    }

    // List them
    console.log('Invalid Contacts:');
    console.log('-'.repeat(80));

    for (const contact of toDelete) {
        const phoneDigits = contact.phone?.replace(/\D/g, '') || '';
        const reason = contact.phone?.includes('@')
            ? `Contains WhatsApp suffix`
            : `Too long (${phoneDigits.length} digits)`;

        console.log(`  ID: ${contact.id}`);
        console.log(`  Name: ${contact.name || '(no name)'}`);
        console.log(`  Phone: ${contact.phone}`);
        console.log(`  Type: ${contact.contactType || 'unknown'}`);
        console.log(`  Reason: ${reason}`);
        console.log(`  Related: ${contact._count.conversations} conversations`);
        console.log('');
    }

    if (DRY_RUN) {
        console.log('='.repeat(60));
        console.log('[Dry Run] Would delete the above contacts.');
        console.log('[Dry Run] Run without --dry-run to actually delete.');
        return;
    }

    // Actually delete
    console.log('='.repeat(60));
    console.log('[Deleting] Starting deletion...\n');

    let deleted = 0;
    let failed = 0;

    for (const contact of toDelete) {
        try {
            // First delete related conversations (cascade should handle messages)
            await db.conversation.deleteMany({
                where: { contactId: contact.id }
            });

            // Then delete the contact
            await db.contact.delete({
                where: { id: contact.id }
            });

            console.log(`  ✅ Deleted: ${contact.name || contact.phone}`);
            deleted++;
        } catch (e: any) {
            console.error(`  ❌ Failed to delete ${contact.id}: ${e.message}`);
            failed++;
        }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log(`[Summary] Deleted: ${deleted}, Failed: ${failed}`);
}

main()
    .catch((e) => console.error('Script error:', e))
    .finally(async () => await db.$disconnect());
