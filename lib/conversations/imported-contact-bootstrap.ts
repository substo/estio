import db from "@/lib/db";
import { seedConversationFromContactLeadText } from "@/lib/conversations/bootstrap";
import { resolveContactConversationStartMessageType } from "@/lib/contacts/conversation-start";

async function resolvePreferredChannelTypeForImportedContactPhone(phone: string | null | undefined): Promise<'TYPE_WHATSAPP' | 'TYPE_SMS'> {
    const rawDigits = String(phone || '').replace(/\D/g, '');
    return rawDigits.length >= 7 ? 'TYPE_WHATSAPP' : 'TYPE_SMS';
}

export async function ensureConversationForImportedContact(args: {
    contactId: string;
    locationId: string;
    source: string;
}) {
    const contact = await db.contact.findFirst({
        where: { id: args.contactId, locationId: args.locationId },
        select: { id: true, phone: true, email: true, name: true, message: true },
    });
    if (!contact) throw new Error('Imported contact not found');

    const preferredChannelType = await resolveContactConversationStartMessageType(
        contact,
        resolvePreferredChannelTypeForImportedContactPhone
    ) || 'TYPE_SMS';

    const existing = await db.conversation.findFirst({
        where: { locationId: args.locationId, contactId: args.contactId },
        select: { id: true, lastMessageType: true, createdAt: true },
    });

    if (existing) {
        await seedConversationFromContactLeadText({
            conversationId: existing.id,
            contact,
            messageType: existing.lastMessageType || preferredChannelType,
            messageDate: existing.createdAt,
            source: args.source,
        });
        return { conversationId: existing.id, created: false };
    }

    try {
        const conversation = await db.conversation.create({
            data: {
                locationId: args.locationId,
                contactId: args.contactId,
                ghlConversationId: null,
                lastMessageBody: null,
                lastMessageAt: new Date(0),
                lastMessageType: preferredChannelType,
                unreadCount: 0,
                status: 'open',
            },
            select: { id: true, lastMessageType: true, createdAt: true },
        });

        await seedConversationFromContactLeadText({
            conversationId: conversation.id,
            contact,
            messageType: conversation.lastMessageType || preferredChannelType,
            messageDate: conversation.createdAt,
            source: args.source,
        });
        return { conversationId: conversation.id, created: true };
    } catch (error: any) {
        if (String(error?.code) === 'P2002') {
            const raced = await db.conversation.findFirst({
                where: { locationId: args.locationId, contactId: args.contactId },
                select: { id: true },
            });
            if (raced?.id) return { conversationId: raced.id, created: false };
        }
        throw error;
    }
}

