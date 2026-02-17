/**
 * One-time script: Merge a placeholder LID contact into the real contact.
 * 
 * Usage: npx tsx scripts/merge-lid-contact.ts
 * 
 * This script:
 * 1. Finds the placeholder contact created for the unresolved LID
 * 2. Moves its conversations/messages to the real contact
 * 3. Sets the LID on the real contact so future messages auto-resolve
 * 4. Deletes the placeholder contact
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const LOCATION_ID = 'cmingx6b10008rdycg7hwesyn';
const LID_JID = '155731873509555@lid';
const REAL_CONTACT_PHONE = '+35796407286';

async function main() {
    console.log('=== LID Contact Merge Script ===\n');

    // 1. Find the placeholder contact by LID
    const placeholder = await prisma.contact.findFirst({
        where: {
            locationId: LOCATION_ID,
            lid: { contains: LID_JID.replace('@lid', '') }
        }
    });

    if (!placeholder) {
        console.log('No placeholder contact found for LID:', LID_JID);

        // Maybe it was already merged. Just ensure the real contact has the LID.
        const realContact = await prisma.contact.findFirst({
            where: { locationId: LOCATION_ID, phone: { contains: REAL_CONTACT_PHONE.replace(/\D/g, '').slice(-7) } }
        });

        if (realContact) {
            if (!realContact.lid) {
                await prisma.contact.update({
                    where: { id: realContact.id },
                    data: { lid: LID_JID }
                });
                console.log(`Set LID ${LID_JID} on real contact ${realContact.name} (${realContact.phone})`);
            } else {
                console.log(`Real contact already has LID: ${realContact.lid}`);
            }
        }
        return;
    }

    console.log(`Found placeholder: ${placeholder.name} (ID: ${placeholder.id})`);

    // 2. Find the real contact by phone
    const phoneDigits = REAL_CONTACT_PHONE.replace(/\D/g, '');
    const candidates = await prisma.contact.findMany({
        where: {
            locationId: LOCATION_ID,
            phone: { contains: phoneDigits.slice(-7) },
            id: { not: placeholder.id }
        }
    });

    const realContact = candidates.find(c => {
        const cDigits = (c.phone || '').replace(/\D/g, '');
        return cDigits === phoneDigits || cDigits.endsWith(phoneDigits) || phoneDigits.endsWith(cDigits);
    });

    if (!realContact) {
        console.log(`No real contact found for phone: ${REAL_CONTACT_PHONE}`);
        console.log('Available contacts for this location:');
        const allContacts = await prisma.contact.findMany({
            where: { locationId: LOCATION_ID },
            select: { id: true, name: true, phone: true, lid: true }
        });
        allContacts.forEach(c => console.log(`  - ${c.name} | ${c.phone} | LID: ${c.lid || 'none'}`));
        return;
    }

    console.log(`Found real contact: ${realContact.name} (ID: ${realContact.id}, Phone: ${realContact.phone})\n`);

    // 3. Move conversations from placeholder to real contact
    const placeholderConvos = await prisma.conversation.findMany({
        where: { contactId: placeholder.id }
    });

    console.log(`Placeholder has ${placeholderConvos.length} conversation(s) to migrate.`);

    for (const convo of placeholderConvos) {
        // Check if real contact already has a conversation for this location
        const existingConvo = await prisma.conversation.findFirst({
            where: { contactId: realContact.id, locationId: convo.locationId }
        });

        if (existingConvo) {
            // Move messages from placeholder convo to existing convo
            const moved = await prisma.message.updateMany({
                where: { conversationId: convo.id },
                data: { conversationId: existingConvo.id }
            });
            console.log(`  Moved ${moved.count} message(s) from convo ${convo.id} → ${existingConvo.id}`);

            // Delete the now-empty placeholder conversation
            await prisma.conversation.delete({ where: { id: convo.id } });
            console.log(`  Deleted empty placeholder conversation ${convo.id}`);

            // Update last message info on the target conversation
            const latestMsg = await prisma.message.findFirst({
                where: { conversationId: existingConvo.id },
                orderBy: { createdAt: 'desc' }
            });
            if (latestMsg) {
                await prisma.conversation.update({
                    where: { id: existingConvo.id },
                    data: {
                        lastMessageBody: latestMsg.body,
                        lastMessageAt: latestMsg.createdAt,
                    }
                });
            }
        } else {
            // Reassign the whole conversation to the real contact
            await prisma.conversation.update({
                where: { id: convo.id },
                data: { contactId: realContact.id }
            });
            console.log(`  Reassigned conversation ${convo.id} to real contact`);
        }
    }

    // 4. Set LID on real contact
    await prisma.contact.update({
        where: { id: realContact.id },
        data: { lid: LID_JID }
    });
    console.log(`\nSet LID ${LID_JID} on real contact ${realContact.name}`);

    // 5. Delete placeholder contact
    await prisma.contact.delete({ where: { id: placeholder.id } });
    console.log(`Deleted placeholder contact ${placeholder.id}`);

    console.log('\n✅ Merge complete! Future messages from this LID will auto-resolve to the real contact.');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
