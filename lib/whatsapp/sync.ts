import db from "@/lib/db";

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
}

// ... handleWhatsAppMessage ...

export async function processNormalizedMessage(msg: NormalizedMessage) {
    const { locationId, from, to, body, type, wamId, timestamp, contactName, source } = msg;
    const direction = msg.direction || "inbound";

    // Check deduplication
    const existing = await db.message.findUnique({ where: { wamId } });
    if (existing) return;

    // Normalize Phones
    const normalizedFrom = from.startsWith('+') ? from : `+${from}`;
    const normalizedTo = to.startsWith('+') ? to : `+${to}`;

    // Determine the "Contact" phone number (The external party)
    // If inbound, Contact is "from". If outbound, Contact is "to".
    const contactPhone = direction === "inbound" ? normalizedFrom : normalizedTo;

    // --- Enhanced Contact Lookup ---
    // 1. Clean the input phone to raw digits
    const rawInputPhone = contactPhone.replace(/\D/g, '');

    // 2. We use the last 2 digits to search candidates efficiently in the DB.
    // Why 2? Because some formats use 2-digit groups (e.g. "XX XX XX").
    // "39 73" does not contain "973", but it contains "73".
    // This returns ~1% of the DB, which is filtered strictly in-memory below.
    const searchSuffix = rawInputPhone.length > 2 ? rawInputPhone.slice(-2) : rawInputPhone;

    const candidates = await db.contact.findMany({
        where: {
            locationId,
            phone: { contains: searchSuffix }
        }
    });

    // 3. Find the best match by comparing stripped digits
    let contact = candidates.find(c => {
        if (!c.phone) return false;
        const rawDbPhone = c.phone.replace(/\D/g, ''); // Strip spaces, +, -, etc. from DB record

        // Exact match of all digits is required
        // We check if:
        // A) The DB number ends with the Input Number (e.g. DB: 48502193973, Input: 502193973 [no country code])
        // B) The Input Number ends with the DB Number (e.g. DB: 502193973, Input: 48502193973)
        // C) Exact match

        // Safety: Ensure we are matching a significant portion (at least 7 digits) to avoid "123" matching "555123"
        // (Though the suffix search helps, we want to be sure).

        return (
            rawDbPhone === rawInputPhone ||
            (rawDbPhone.endsWith(rawInputPhone) && rawInputPhone.length >= 7) ||
            (rawInputPhone.endsWith(rawDbPhone) && rawDbPhone.length >= 7)
        );
    });

    if (!contact) {
        console.log(`[WhatsApp Sync] Contact not found for ${contactPhone} (Raw Input: ${rawInputPhone}, Suffix: ${searchSuffix}). Creating new.`);
        // Create new contact
        contact = await db.contact.create({
            data: {
                locationId,
                phone: contactPhone,
                name: contactName || `WhatsApp User ${contactPhone}`, // Use pushName if available
                status: "New",
                contactType: "Lead"
            }
        });
    } else {
        console.log(`[WhatsApp Sync] Matched existing contact: ${contact.name} (${contact.id})`);
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
            // We use 'contains' because locationIds is an array of strings in DB probably, or related model. 
            // In schema User has 'locations Location[]', so we use 'locations: { some: { id: locationId } }'
            const googleUser = await db.user.findFirst({
                where: {
                    locations: { some: { id: locationId } },
                    googleSyncEnabled: true
                }
            });

            if (googleUser) {
                console.log(`[WhatsApp Sync] Syncing contact ${contact.id} to Google User ${googleUser.email}...`);
                // We don't await this to avoid blocking the message flow? 
                // Actually, let's await safely to catch errors but not fail headers
                syncContactToGoogle(googleUser.id, contact.id).catch(e => console.error("Google Sync bg error", e));
            }

            if (remoteCid) {
                console.log(`[WhatsApp Sync] Syncing ${direction} message to GHL (Contact: ${remoteCid})...`);

                const customProviderId = process.env.GHL_CUSTOM_PROVIDER_ID;
                const ghlPayload: any = {
                    contactId: remoteCid,
                    type: customProviderId ? 'Custom' : 'WhatsApp',
                    message: body,
                    // If inbound, we might need to specify it (depending on API)
                    // For now, passing it in payload if API supports it, or relying on GHL to infer?
                    // Usually GHL assumes outbound for /conversations/messages.
                    // Ideally we should use /conversations/messages/inbound for inbound?
                    // Let's try the standard endpoint with direction param if possible, or context.
                };

                if (customProviderId) {
                    ghlPayload.conversationProviderId = customProviderId;
                }

                // If it's inbound, we attempt to mark it as such (though API support varies)
                // Some GHL endpoints accept `direction` or `status`
                if (direction === 'inbound') {
                    // ghlPayload.direction = 'inbound'; // Speculative
                    // If this fails to show as inbound, we might need to use the specific inbound endpoint.
                }

                await sendMessage(locationDef.ghlAccessToken, ghlPayload);
                console.log(`[WhatsApp Sync] Synced to GHL successfully.`);
            } else {
                console.warn(`[WhatsApp Sync] Failed to resolve GHL Contact ID. Message not synced.`);
            }
        }
    } catch (err) {
        console.error(`[WhatsApp Sync] Failed to sync message to GHL:`, err);
    }
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

