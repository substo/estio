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

    // Find Contact
    let contact = await db.contact.findFirst({
        where: {
            locationId,
            OR: [
                { phone: contactPhone },
                { phone: contactPhone.replace('+', '') },
            ]
        }
    });

    if (!contact) {
        // Create new contact (Only logic for inbound usually, but safe to allow outbound to create ghost contact if needed)
        // Usually outbound messages from App imply we are talking to someone new.
        contact = await db.contact.create({
            data: {
                locationId,
                phone: contactPhone,
                name: contactName || `WhatsApp User ${contactPhone}`,
                status: "New",
                contactType: "Lead"
            }
        });
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
}

export async function processStatusUpdate(wamId: string, newStatus: string) {
    await db.message.updateMany({
        where: { wamId },
        data: { status: newStatus }
    });
}

