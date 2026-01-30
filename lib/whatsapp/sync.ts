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

    console.log(`[WhatsApp Sync] Processing message ${wamId} from ${contactPhone}. Suffix: ${searchSuffix}`);

    const candidates = await db.contact.findMany({
        where: {
            locationId,
            phone: { contains: searchSuffix }
        }
    });

    // 3. Find the best match by comparing stripped digits
    let contact = candidates.find(c => {
        if (!c.phone) return false;
        const rawDbPhone = c.phone.replace(/\D/g, '');

        return (
            rawDbPhone === rawInputPhone ||
            (rawDbPhone.endsWith(rawInputPhone) && rawInputPhone.length >= 7) ||
            (rawInputPhone.endsWith(rawDbPhone) && rawDbPhone.length >= 7)
        );
    });

    if (!contact) {
        console.log(`[WhatsApp Sync] Contact not found for ${contactPhone}. Creating new.`);
        // Create new contact
        contact = await db.contact.create({
            data: {
                locationId,
                phone: contactPhone,
                name: nameToUse || `WhatsApp User ${contactPhone}`,
                status: "New",
                contactType: contactType
            }
        });
    } else {
        console.log(`[WhatsApp Sync] Matched existing contact: ${contact.name} (${contact.id})`);

        // Optional: Update name if available and not set? 
        if (isGroup && nameToUse && contact.name !== nameToUse) {
            await db.contact.update({ where: { id: contact.id }, data: { name: nameToUse } });
        }
    }

    // --- Check Participant (Sender) for Groups ---
    if (isGroup && participant && direction === 'inbound') {
        const pPhone = participant.startsWith('+') ? participant : `+${participant}`;
        const pRaw = pPhone.replace(/\D/g, '');
        const pSuffix = pRaw.length > 2 ? pRaw.slice(-2) : pRaw;

        // Find existing contact for participant
        const pCandidates = await db.contact.findMany({
            where: { locationId, phone: { contains: pSuffix } }
        });

        let pContact = pCandidates.find(c => {
            if (!c.phone) return false;
            const r = c.phone.replace(/\D/g, '');
            return (r === pRaw || r.endsWith(pRaw) || pRaw.endsWith(r));
        });

        if (!pContact) {
            console.log(`[WhatsApp Sync] Creating new contact for Group Participant: ${pPhone}`);
            await db.contact.create({
                data: {
                    locationId,
                    phone: pPhone,
                    name: `Group Member ${pPhone}`,
                    status: "New",
                    contactType: "Ref-GroupMember"
                }
            }).catch(e => console.error("Participant create error", e));
        }
    }

    // Find or Create Conversation
    let conversation = await db.conversation.findFirst({
        where: { contactId: contact.id, locationId },
    });

    if (!conversation) {
        conversation = await db.conversation.create({
            data: {
                locationId,
                contactId: contact.id,
                status: "open",
                ghlConversationId: `wa_${Date.now()}_${contact.id}`, // Synthetic ID
                lastMessageType: "TYPE_WHATSAPP"
            }
        });
    }

    // Create Message
    await db.message.create({
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

    // Update Conversation
    await db.conversation.update({
        where: { id: conversation.id },
        data: {
            lastMessageBody: body,
            lastMessageAt: timestamp,
            lastMessageType: "TYPE_WHATSAPP",
            unreadCount: direction === "inbound" ? { increment: 1 } : undefined // Only increment unread for inbound
        }
    });

    // --- GHL 2-Way Sync ---
    try {
        // We need to fetch the full location to get the access token
        const locationDef = await db.location.findUnique({
            where: { id: locationId },
            select: { id: true, ghlLocationId: true, ghlAccessToken: true }
        });

        if (locationDef?.ghlAccessToken && locationDef?.ghlLocationId) {
            const { ensureRemoteContact } = await import("@/lib/crm/contact-sync");
            const { sendMessage } = await import("@/lib/ghl/conversations");
            const { syncContactToGoogle } = await import("@/lib/google/people");

            // 1. Ensure Contact Exists in GHL (JIT)
            const remoteCid = await ensureRemoteContact(contact.id, locationDef.ghlLocationId, locationDef.ghlAccessToken);

            // 2. Google Contact Sync (Opportunistic)
            // find a user in this location who has google sync enabled
            const googleUser = await db.user.findFirst({
                where: {
                    locations: { some: { id: locationId } },
                    googleSyncEnabled: true
                }
            });

            if (googleUser) {
                console.log(`[WhatsApp Sync] Syncing contact ${contact.id} to Google User ${googleUser.email}...`);
                syncContactToGoogle(googleUser.id, contact.id).catch(e => console.error("Google Sync bg error", e));
            }

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
