
import db from "@/lib/db";

export async function handleContactSyncEvent(payload: any, locationId?: string) {
    // payload is the whole webhook body
    // expected: payload.event === 'CONTACTS_UPSERT' or 'CONTACTS_UPDATE'
    // payload.data is an array of contacts (or single object?)
    // logs suggest payload.data is the array for upsert? No, typically 'data' is the event data.
    // Let's assume payload.data is an array of ISocketContact or similar.

    // Resolve tenant scope first. Contact sync must always stay inside a single location.
    let resolvedLocationId = locationId;
    if (!resolvedLocationId && payload.instance) {
        const location = await db.location.findFirst({
            where: { evolutionInstanceId: payload.instance },
            select: { id: true }
        });
        resolvedLocationId = location?.id;
    }

    if (!resolvedLocationId) {
        console.warn(`[Contact Sync] Skipping: could not resolve location for instance ${payload.instance || 'unknown'}`);
        return;
    }

    // Safety check
    const contacts = Array.isArray(payload.data) ? payload.data : [payload.data];

    if (!contacts || contacts.length === 0) return;

    console.log(`[Contact Sync] Processing ${contacts.length} contacts from Webhook for location ${resolvedLocationId}...`);

    let updatedCount = 0;

    for (const contact of contacts) {
        // We look for contacts that have BOTH 'id' (phone JID) and 'lid'
        // OR 'id' (LID) and 'phoneNumber'?
        // Baileys typically sends: { id: "123@s.whatsapp.net", lid: "456@lid", ... }

        const id = contact.id || '';
        const lid = contact.lid || '';

        // We fundamentally want to link an LID to a real phone number.

        let phoneJid = '';
        let lidJid = '';

        if (id.endsWith('@s.whatsapp.net')) {
            phoneJid = id;
            if (lid.endsWith('@lid')) lidJid = lid;
        } else if (id.endsWith('@lid')) {
            lidJid = id;
            // Check if phone number is provided elsewhere
            // Some versions might provide 'phoneNumber' or 'mn' (mobile number)?
            if (contact.phoneNumber) {
                phoneJid = contact.phoneNumber + '@s.whatsapp.net'; // simplistic
            }
        }

        if (phoneJid && lidJid) {
            // We have a mapping!
            const rawPhone = phoneJid.replace('@s.whatsapp.net', '');
            const rawLid = lidJid.replace('@lid', ''); // or keep full @lid if we store it that way?
            // In DB we typically store basic strings or E.164. 
            // Our DB `lid` field: check format. Sync.ts uses `msg.lid` (usually full string?)
            // `route.ts` used `remoteJid.replace('@lid', '')` -> so raw number string.
            // Let's stick to raw numbers for matching, but maybe store full JID if needed?
            // Existing DB `lid` column is String?

            // Let's try to update a contact with this phone.
            // Search by phone.

            // normalized phone for DB lookup (suffix match or explicit)
            const phoneDigits = rawPhone.replace(/\D/g, '');
            // We'll use the same robust lookup logic as sync.ts if possible, or simple contains.

            try {
                // Find contact by phone (strictly inside the same location)
                const phoneSuffix = phoneDigits.length > 7 ? phoneDigits.slice(-7) : phoneDigits;
                const candidates = await db.contact.findMany({
                    where: {
                        locationId: resolvedLocationId,
                        phone: { contains: phoneSuffix }
                    },
                    select: { id: true, phone: true, lid: true, name: true, locationId: true }
                });

                const existing = candidates.find((candidate) => {
                    if (!candidate.phone) return false;
                    const candidateDigits = candidate.phone.replace(/\D/g, '');
                    return (
                        candidateDigits === phoneDigits ||
                        (candidateDigits.endsWith(phoneDigits) && phoneDigits.length >= 7) ||
                        (phoneDigits.endsWith(candidateDigits) && candidateDigits.length >= 7)
                    );
                });

                if (existing) {
                    // Normalize LID for comparison (strip @lid if present)
                    const existingLidNorm = (existing.lid || '').replace('@lid', '');
                    const lidRaw = lidJid.replace('@lid', '');
                    if (existingLidNorm !== lidRaw) {
                        // Check if we have a DUPLICATE contact for this LID
                        const duplicateLidContact = await db.contact.findFirst({
                            where: {
                                locationId: resolvedLocationId,
                                lid: { contains: lidRaw },
                                id: { not: existing.id }
                            }
                        });

                        if (duplicateLidContact) {
                            console.log(`[Contact Sync] MERGE DETECTED: Linking LID ${lidJid} (Contact ${duplicateLidContact.id}) to Real Contact ${existing.id}`);

                            // 1. Migrate Conversations & Messages
                            const sourceConvos = await db.conversation.findMany({
                                where: {
                                    contactId: duplicateLidContact.id,
                                    locationId: resolvedLocationId
                                }
                            });

                            for (const sourceConvo of sourceConvos) {
                                const targetConvo = await db.conversation.findUnique({
                                    where: {
                                        locationId_contactId: {
                                            locationId: sourceConvo.locationId,
                                            contactId: existing.id
                                        }
                                    }
                                });

                                if (targetConvo) {
                                    // Merge Messages to Target Convo
                                    console.log(`[Contact Sync] Merging messages from Conversation ${sourceConvo.id} to ${targetConvo.id}`);
                                    await db.message.updateMany({
                                        where: { conversationId: sourceConvo.id },
                                        data: { conversationId: targetConvo.id }
                                    });
                                    // Delete the now-empty source conversation
                                    await db.conversation.delete({ where: { id: sourceConvo.id } });
                                } else {
                                    // Reassign Conversation to Target Contact
                                    console.log(`[Contact Sync] Reassigning Conversation ${sourceConvo.id} to Contact ${existing.id}`);
                                    await db.conversation.update({
                                        where: { id: sourceConvo.id },
                                        data: { contactId: existing.id }
                                    });
                                }
                            }

                            // 2. Delete the Duplicate LID Contact
                            await db.contact.delete({ where: { id: duplicateLidContact.id } });
                            console.log(`[Contact Sync] Deleted duplicate contact ${duplicateLidContact.id}`);
                        }

                        // 3. Update the Real Contact with the LID
                        await db.contact.update({
                            where: { id: existing.id },
                            data: { lid: lidJid }
                        });
                        console.log(`[Contact Sync] Linked LID ${lidJid} to Contact ${existing.name} (Phone: ${existing.phone})`);
                        updatedCount++;
                    }
                } else {
                    // Contact phone doesn't exist locally. 
                    // Check if we have an existing placeholder for this LID
                    const existingLidContact = await db.contact.findFirst({
                        where: {
                            locationId: resolvedLocationId,
                            lid: { contains: lidJid.replace('@lid', '') }
                        }
                    });

                    if (existingLidContact) {
                        // We found the "WhatsApp User ...@lid" contact!
                        // Update its phone number!
                        await db.contact.update({
                            where: { id: existingLidContact.id },
                            data: {
                                phone: `+${rawPhone}`,
                                // Update name if it's the placeholder?
                                name: (existingLidContact.name || '').startsWith('WhatsApp User') ? (contact.name || contact.notify || existingLidContact.name) : existingLidContact.name
                            }
                        });
                        console.log(`[Contact Sync] Resolved Placeholder Contact ${existingLidContact.id}: LID ${lidJid} -> Phone ${rawPhone}`);
                        updatedCount++;
                    }
                }
            } catch (err) {
                console.error(`[Contact Sync] Error processing contact ${id}:`, err);
            }
        }
    }
    console.log(`[Contact Sync] Updated ${updatedCount} contacts.`);
}
