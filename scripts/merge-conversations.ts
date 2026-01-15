import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DIRECT_URL || process.env.DATABASE_URL
        }
    }
});

async function main() {
    console.log("Starting duplicate merge...");

    // 1. Fetch all contacts with GHL IDs (The "Golden Records")
    const masterContacts = await db.contact.findMany({
        where: {
            ghlContactId: { not: null },
            phone: { not: null }
        },
        include: {
            conversations: true
        }
    });

    console.log(`Found ${masterContacts.length} master contacts.`);

    let mergedCount = 0;

    for (const master of masterContacts) {
        if (!master.phone) continue;

        // Clean phone for matching
        const rawMasterPhone = master.phone.replace(/\D/g, '');
        // Use 2 digits for broad availability (handles "XX XX" formats in DB)
        const searchSuffix = rawMasterPhone.length > 2 ? rawMasterPhone.slice(-2) : rawMasterPhone;

        // 2. Find "Ghost" contacts (No GHL ID) that match this phone
        const ghosts = await db.contact.findMany({
            where: {
                ghlContactId: null, // Only target locally created duplicates
                id: { not: master.id },
                phone: { contains: searchSuffix }
            },
            include: {
                conversations: {
                    include: { messages: true }
                }
            }
        });

        // Refine matches strictly in JS
        const trueDuplicates = ghosts.filter(g => {
            if (!g.phone) return false;
            const rawGhost = g.phone.replace(/\D/g, '');
            return rawGhost === rawMasterPhone || rawGhost.endsWith(rawMasterPhone) || rawMasterPhone.endsWith(rawGhost);
        });

        console.log(`\nFound ${trueDuplicates.length} duplicates for ${master.name} (${master.phone})`);

        // Ensure Master has a conversation
        let masterConversation = master.conversations[0];
        if (!masterConversation) {
            console.log(`Creating master conversation for ${master.name}...`);
            masterConversation = await db.conversation.create({
                data: {
                    contactId: master.id,
                    locationId: master.locationId,
                    ghlConversationId: `merged_${master.id}_${Date.now()}`, // Placeholder
                    status: 'open'
                }
            });
        }

        // 3. MERGE
        for (const duplicate of trueDuplicates) {
            console.log(`  Merging duplicate: ${duplicate.name} (${duplicate.phone}) - ${duplicate.conversations.length} conversations`);

            // --- REASSIGN RELATED ENTITIES ---
            // 1. ContactPropertyRole
            const ghostRoles = await db.contactPropertyRole.findMany({ where: { contactId: duplicate.id } });
            for (const role of ghostRoles) {
                // Check if Master already has this role
                const exists = await db.contactPropertyRole.findUnique({
                    where: { contactId_propertyId_role: { contactId: master.id, propertyId: role.propertyId, role: role.role } }
                });

                if (exists) {
                    // Collision: Delete duplicate's role
                    await db.contactPropertyRole.delete({ where: { id: role.id } });
                } else {
                    // Move to Master
                    await db.contactPropertyRole.update({ where: { id: role.id }, data: { contactId: master.id } });
                }
            }

            // 2. Viewings
            const viewings = await db.viewing.findMany({ where: { contactId: duplicate.id } });
            for (const v of viewings) {
                await db.viewing.update({ where: { id: v.id }, data: { contactId: master.id } });
            }

            // 3. Swipes & Sessions
            // Sessions first
            const sessions = await db.swipeSession.findMany({ where: { contactId: duplicate.id } });
            for (const s of sessions) {
                await db.swipeSession.update({ where: { id: s.id }, data: { contactId: master.id } });
            }
            // Individual swipes usually linked to contactId too?
            const swipes = await db.propertySwipe.findMany({ where: { contactId: duplicate.id } });
            for (const s of swipes) {
                await db.propertySwipe.update({ where: { id: s.id }, data: { contactId: master.id } });
            }

            // 4. ContactHistory
            await db.contactHistory.updateMany({
                where: { contactId: duplicate.id },
                data: { contactId: master.id }
            });

            // 5. ContactCompanyRoles
            const companyRoles = await db.contactCompanyRole.findMany({ where: { contactId: duplicate.id } });
            for (const role of companyRoles) {
                const exists = await db.contactCompanyRole.findUnique({
                    where: { contactId_companyId_role: { contactId: master.id, companyId: role.companyId, role: role.role } }
                });
                if (exists) {
                    await db.contactCompanyRole.delete({ where: { id: role.id } });
                } else {
                    await db.contactCompanyRole.update({ where: { id: role.id }, data: { contactId: master.id } });
                }
            }

            for (const ghostConv of duplicate.conversations) {
                // Move messages
                if (ghostConv.messages.length > 0) {
                    console.log(`    Moving ${ghostConv.messages.length} messages...`);
                    await db.message.updateMany({
                        where: { conversationId: ghostConv.id }, // Note: Verify field name, typically 'conversationId'
                        data: { conversationId: masterConversation.id }
                    });
                }

                // Update master lastMessage if ghost was newer
                if (ghostConv.lastMessageAt > masterConversation.lastMessageAt) {
                    await db.conversation.update({
                        where: { id: masterConversation.id },
                        data: {
                            lastMessageAt: ghostConv.lastMessageAt,
                            lastMessageBody: ghostConv.lastMessageBody,
                            lastMessageType: ghostConv.lastMessageType,
                        }
                    });
                }

                // Delete Ghost Conversation
                await db.conversation.delete({ where: { id: ghostConv.id } });
            }

            // Delete Ghost Contact
            await db.contact.delete({ where: { id: duplicate.id } });
            mergedCount++;
        }
    }

    console.log(`\nMerge complete. Merged ${mergedCount} duplicate contacts.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await db.$disconnect();
    });
