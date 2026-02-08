import db from "@/lib/db";
import { generateSmartReplies } from "@/lib/ai/smart-replies";

export interface NormalizedMessage {
    locationId: string;
    from: string; // E.164 phone number (Sender)
    to: string;   // E.164 phone number (Recipient)
    type: "text" | "image" | "document" | "audio" | "video" | "other";
    body: string;
    wamId: string; // Unique Message ID
    timestamp: Date;
    mediaUrl?: string; // For improved media handling
    contactName?: string;
    source: "whatsapp_native" | "whatsapp_twilio" | "whatsapp_evolution";
    direction?: "inbound" | "outbound";
    isGroup?: boolean;
    participant?: string; // Real sender phone in group chat
    lid?: string; // WhatsApp Lightweight ID
}

// ... handleWhatsAppMessage ...

export async function processNormalizedMessage(msg: NormalizedMessage) {
    console.log(`[WhatsApp Sync] processNormalizedMessage Called for ${msg.wamId} (${msg.direction})`);
    const { locationId, from, to, body, type, wamId, timestamp, contactName, source, isGroup, participant } = msg;
    const direction = msg.direction || "inbound";

    const existing = await db.message.findUnique({ where: { wamId } });
    if (existing) {
        console.log(`[WhatsApp Sync] Skipped existing message: ${wamId}`);
        return { status: 'skipped', id: existing.id };
    }

    // Fetch Location for Access Token
    const locationDef = await db.location.findUnique({
        where: { id: locationId },
        select: { id: true, ghlLocationId: true, ghlAccessToken: true }
    });
    if (!locationDef) {
        console.error(`[WhatsApp Sync] Location ${locationId} not found`);
        return { status: 'error', reason: 'location_not_found' };
    }

    // Normalize Phones
    const normalizedFrom = from.startsWith('+') ? from : `+${from}`;
    const normalizedTo = to.startsWith('+') ? to : `+${to}`;

    // Determine the "Contact" phone number (The external party)
    // If inbound, Contact is "from". If outbound, Contact is "to".
    const contactPhone = direction === "inbound" ? normalizedFrom : normalizedTo;

    // --- Enhanced Contact Lookup ---
    // 1. Clean the input phone to raw digits
    const rawInputPhone = contactPhone.replace(/\D/g, '');
    const searchSuffix = rawInputPhone.length > 2 ? rawInputPhone.slice(-2) : rawInputPhone;

    // --- Group Chat Handling ---
    let contactType = "Lead";
    let nameToUse = contactName;

    if (isGroup) {
        contactType = "WhatsAppGroup";
        // If we don't have a specific group name, use a default.
        if (!nameToUse) nameToUse = `WhatsApp Group ${contactPhone}`;
    } else {
        // 1:1 Chat Logic
        // Fix for "Self-Naming" bug on outbound messages
        // If outbound, the "contactName" (pushName) is the Sender/User, NOT the contact.
        // We should Ignore it for outbound.
        if (direction === "outbound") {
            nameToUse = undefined;
        }
    }

    // 2. Find Existing Contact (Lookup by Phone OR LID)
    const candidates = await db.contact.findMany({
        where: {
            locationId,
            OR: [
                { phone: { contains: searchSuffix } },
                ...(msg.lid ? [{ lid: msg.lid }] : [])
            ]
        } as any
    });

    // Strategy: Prefer LID match -> Then Phone Match
    let contact = candidates.find((c: any) => msg.lid && c.lid === msg.lid);

    if (!contact) {
        contact = candidates.find(c => {
            if (!c.phone) return false;
            const rawDbPhone = c.phone.replace(/\D/g, '');
            return (
                rawDbPhone === rawInputPhone ||
                (rawDbPhone.endsWith(rawInputPhone) && rawInputPhone.length >= 7) ||
                (rawInputPhone.endsWith(rawDbPhone) && rawDbPhone.length >= 7)
            );
        });
    }

    // Link LID if found by phone but missing LID
    if (contact && msg.lid && contact.lid !== msg.lid) {
        await db.contact.update({
            where: { id: contact.id },
            data: { lid: msg.lid } as any
        }).catch(err => console.error("Failed to link LID:", err));
        console.log(`[WhatsApp Sync] Linked LID ${msg.lid} to contact ${contact.phone}`);
    }

    if (!contact) {
        // --- VALIDATION: Prevent creation of invalid contacts (e.g. unresolved LIDs) ---
        const cleanForCheck = contactPhone.replace(/\D/g, '');
        const isInvalidUS = contactPhone.startsWith('+1') && (cleanForCheck.substring(1, 2) === '0' || cleanForCheck.substring(1, 2) === '1');

        if (cleanForCheck.length >= 16 || isInvalidUS) {
            console.warn(`[WhatsApp Sync] BLOCKED (Strict): ${contactPhone}`);
            return { status: 'skipped', reason: 'invalid_number_strict' };
        }

        // --- SOURCE OF TRUTH CHECK (Google > GHL) ---
        let finalName = nameToUse || `WhatsApp User ${contactPhone}`;
        let foundGhlId: string | undefined;
        let foundGoogleId: string | undefined;
        let foundEmail: string | undefined;
        let foundTags: string[] = [];
        let foundAddress: any = {};

        // 1. Check Google Contacts (Primary Source of Truth for Name)
        try {
            // Find a user with Google Sync enabled for this location
            // Webhook context: We find the first user who has enabled sync for this location.
            const googleUser = await db.user.findFirst({
                where: {
                    locations: { some: { id: locationId } },
                    googleSyncEnabled: true
                },
                select: { id: true }
            });

            if (googleUser) {
                const { searchGoogleContacts } = await import("@/lib/google/people");
                const gContacts = await searchGoogleContacts(googleUser.id, contactPhone);

                if (gContacts.length > 0) {
                    const gMatch = gContacts[0];
                    // Ensure gMatch is not null (filter(Boolean) removes nulls but TS doesn't infer)
                    if (gMatch) {
                        console.log(`[WhatsApp Sync] Found existing Google Contact: ${gMatch.resourceName} (${gMatch.name})`);

                        foundGoogleId = gMatch.resourceName || undefined;
                        finalName = gMatch.name || finalName; // Google Name Wins
                        foundEmail = gMatch.email || foundEmail;
                    }
                }
            }
        } catch (err) {
            console.error("[WhatsApp Sync] Failed to check Google:", err);
        }

        // 2. Check GHL (Secondary / Back Layer)
        // We still check GHL to link the ID and prevent duplicates in CRM
        if (locationDef.ghlAccessToken && locationDef.ghlLocationId) {
            try {
                const { ghlFetch } = await import("@/lib/ghl/client");
                const cleanPhone = contactPhone.replace(/\D/g, '');
                // Search by Phone
                const searchRes = await ghlFetch<{ contacts: any[] }>(`/contacts/?locationId=${locationDef.ghlLocationId}&query=${cleanPhone}`, locationDef.ghlAccessToken);

                if (searchRes.contacts && searchRes.contacts.length > 0) {
                    const match = searchRes.contacts.find((c: any) => {
                        const cPhone = c.phone?.replace(/\D/g, '');
                        return cPhone && (cPhone === cleanPhone || cPhone.endsWith(cleanPhone) || cleanPhone.endsWith(cPhone));
                    });

                    if (match) {
                        console.log(`[WhatsApp Sync] Found existing GHL Contact: ${match.id} (${match.name})`);
                        foundGhlId = match.id;

                        // Only use GHL data if we didn't find it in Google (Google Priority)
                        if (!foundGoogleId) {
                            finalName = match.name || finalName;
                            foundEmail = match.email || foundEmail;
                        }

                        // Always merge tags/address from GHL as Google might not have them
                        foundTags = match.tags || [];
                        foundAddress = {
                            city: match.city || foundAddress.city,
                            state: match.state || foundAddress.state,
                            country: match.country || foundAddress.country,
                            postalCode: match.postalCode || foundAddress.postalCode,
                            address1: match.address1 || foundAddress.address1
                        };
                    }
                }
            } catch (err) {
                console.error("[WhatsApp Sync] Failed to check GHL:", err);
            }
        }

        console.log(`[WhatsApp Sync] Creating new contact. Name: ${finalName}, GHL: ${foundGhlId}, Google: ${foundGoogleId}`);

        // Create new contact
        contact = await db.contact.create({
            data: {
                locationId,
                phone: contactPhone,
                name: finalName,
                email: foundEmail,
                status: "New",
                contactType: contactType,
                lid: msg.lid,
                ghlContactId: foundGhlId,
                googleContactId: foundGoogleId,
                tags: foundTags.length > 0 ? foundTags : undefined,
                ...foundAddress
            } as any
        });
    } else {
        console.log(`[WhatsApp Sync] Matched existing contact: ${contact.name} (${contact.id})`);

        // Optional: Update name if available and not set? 
        if (isGroup && nameToUse && contact.name !== nameToUse) {
            await db.contact.update({ where: { id: contact.id }, data: { name: nameToUse } });
        }
    }

    // --- Check Participant (Sender) for Groups ---
    let pContact: any = null; // Hoisted for later use

    if (isGroup && participant && direction === 'inbound') {
        const pPhone = participant.startsWith('+') ? participant : `+${participant}`;
        const pRaw = pPhone.replace(/\D/g, '');
        const pSuffix = pRaw.length > 2 ? pRaw.slice(-2) : pRaw;

        // Find existing contact for participant
        const pCandidates = await db.contact.findMany({
            where: { locationId, phone: { contains: pSuffix } }
        });

        pContact = pCandidates.find(c => {
            if (!c.phone) return false;
            const r = c.phone.replace(/\D/g, '');
            return (r === pRaw || r.endsWith(pRaw) || pRaw.endsWith(r));
        });

        if (!pContact) {
            console.log(`[WhatsApp Sync] Creating new contact for Group Participant: ${pPhone}`);
            pContact = await db.contact.create({
                data: {
                    locationId,
                    phone: pPhone,
                    name: `Group Member ${pPhone}`,
                    status: "New",
                    contactType: "Ref-GroupMember"
                }
            }).catch(e => {
                console.error("Participant create error", e);
                return null; // Ensure pContact is null on error
            });
        }
    }

    // 4. Create/Get Conversation (GHL Style)
    // We use a synthetic GHL ID for WhatsApp native chats if not provided
    const ghlId = msg.source === 'whatsapp_evolution' && !contact.ghlContactId
        ? `wa_${Date.now()}_${contact.id}`
        : contact.ghlContactId;

    // Ensure conversation exists
    // Note: upsertConversationFromGHL handles creating the Conversation record
    const { upsertConversationFromGHL } = await import("@/lib/ghl/sync");

    // Create a mock conversation object for the syncer
    const mockConv = {
        id: `wa_${Date.now()}_${contact.id}`, // We might need a consistent ID here if we want to update
        contactId: contact.ghlContactId || contact.id, // Use our internal ID if GHL ID missing
        locationId: locationId,
        lastMessageBody: body,
        lastMessageType: 'TYPE_WHATSAPP',
        unreadCount: 1,
        status: 'open',
        type: 'WhatsApp'
    };

    // We use the "Contact" (Group or Individual) to anchor the conversation.
    const conversation = await upsertConversationFromGHL({
        ...mockConv,
        contactId: contact.id
    }, locationId, locationDef.ghlAccessToken || '');

    if (!conversation) {
        console.error("[WhatsApp Sync] Failed to upsert conversation");
        return { status: 'error', reason: 'conversation_creation_failed' };
    }

    // 5. Group Participant Sync (New Architecture)
    if (isGroup && participant && conversation && pContact) { // Ensure pContact is resolved
        try {
            await db.conversationParticipant.upsert({
                where: {
                    conversationId_contactId: {
                        conversationId: conversation.id,
                        contactId: pContact.id
                    }
                },
                create: {
                    conversationId: conversation.id,
                    contactId: pContact.id,
                    role: 'member',
                    joinedAt: new Date()
                },
                update: {
                    // Update joinedAt or lastActive?
                }
            });
            console.log(`[WhatsApp Sync] Linked Participant ${pContact.name} to Group Conversation ${conversation.id}`);
        } catch (err) {
            console.error("[WhatsApp Sync] Failed to link group participant:", err);
        }
    }

    // 6. Create Message
    const newMessage = await db.message.create({
        data: {
            conversationId: conversation.id,
            ghlMessageId: `wa_${wamId}`,
            wamId: wamId,
            type: "WhatsApp",
            direction: direction,
            status: direction === "inbound" ? "received" : "sent",
            body: body,
            source: source,
            createdAt: timestamp,
            updatedAt: new Date(),
        }
    });

    console.log(`[WhatsApp Sync] Created message ${wamId} for conversation ${conversation.id}`);

    // Unified Update Logic
    const { updateConversationLastMessage } = await import('@/lib/conversations/update');
    await updateConversationLastMessage({
        conversationId: conversation.id,
        messageBody: body,
        messageType: 'TYPE_WHATSAPP',
        messageDate: timestamp,
        direction: direction,
        // Helper handles inbound unread increment
    });

    // --- GHL 2-Way Sync ---
    try {
        // Location already fetched as locationDef

        if (locationDef?.ghlAccessToken && locationDef?.ghlLocationId) {
            const { ensureRemoteContact } = await import("@/lib/crm/contact-sync");
            const { sendMessage } = await import("@/lib/ghl/conversations");
            const { syncContactToGoogle } = await import("@/lib/google/people");

            // 1. Ensure Contact Exists in GHL (JIT)
            const remoteCid = await ensureRemoteContact(contact.id, locationDef.ghlLocationId, locationDef.ghlAccessToken);

            // 2. DISABLED: Auto-sync removed. Use Google Sync Manager for manual sync.
            // const googleUser = await db.user.findFirst({
            //     where: {
            //         locations: { some: { id: locationId } },
            //         googleSyncEnabled: true
            //     }
            // });
            // if (googleUser) {
            //     console.log(`[WhatsApp Sync] Syncing contact ${contact.id} to Google User ${googleUser.email}...`);
            //     syncContactToGoogle(googleUser.id, contact.id).catch(e => console.error("Google Sync bg error", e));
            // }

            if (remoteCid) {
                // Dynamically import Queue to avoid circular deps if any
                const { ghlSyncQueue } = await import("@/lib/queue/ghl-sync");

                console.log(`[WhatsApp Sync] Queueing message ${wamId} for GHL Sync (Contact: ${remoteCid})...`);

                const customProviderId = process.env.GHL_CUSTOM_PROVIDER_ID;

                // Add to Queue (Standard BullMQ)
                await ghlSyncQueue.add('sync-message', {
                    contactId: remoteCid,
                    type: customProviderId ? 'Custom' : 'WhatsApp',
                    body: body,
                    conversationProviderId: customProviderId,
                    direction: direction,
                    accessToken: locationDef.ghlAccessToken,
                    wamId: wamId
                });

                console.log(`[WhatsApp Sync] Job added to queue for ${wamId}`);
            } else {
                console.warn(`[WhatsApp Sync] Failed to resolve GHL Contact ID. Message not synced.`);
            }
        }
    } catch (err) {
    }
    // --- Smart Reply Generation (Background) ---
    if (direction === "inbound") {
        generateSmartReplies(conversation.id).catch(e => console.error("Smart Reply bg error", e));
    }

    return { status: 'processed' };
}

export async function processStatusUpdate(wamId: string, rawStatus: string) {
    // Map Evolution/Baileys status to our internal status
    // Evolution: SERVER_ACK, DELIVERY_ACK, READ, PLAYED
    // Internal: sent, delivered, read, failed

    let status = 'sent';
    const s = rawStatus.toUpperCase();

    if (s === 'DELIVERY_ACK' || s === 'DELIVERED') {
        status = 'delivered';
    } else if (s === 'READ' || s === 'PLAYED') {
        status = 'read';
    } else if (s === 'SERVER_ACK') {
        status = 'sent';
    } else if (s === 'ERROR' || s === 'FAILED') {
        status = 'failed';
    } else {
        // Keep original if unknown, or default to sent? 
        // Better to ignore if undefined/pending?
        if (!rawStatus) return;
        // If it's something 'PENDING', we might leave it. 
        // But usually we just update.
        status = rawStatus.toLowerCase();
    }

    console.log(`[WhatsApp Sync] Updating status for ${wamId}: ${rawStatus} -> ${status}`);

    await db.message.updateMany({
        where: { wamId },
        data: { status: status }
    });

    // TODO: Sync Status to GHL if supported
    // GHL API might not support updating status of injected messages easily.
    // But we at least have it locally.
}
