import db from "@/lib/db";
import { updateConversationLastMessage } from "@/lib/conversations/update";

type BootstrapContact = {
    id: string;
    message?: string | null;
};

export interface SeedConversationFromContactLeadTextParams {
    conversationId: string;
    contact: BootstrapContact;
    messageType?: string | null;
    messageDate?: Date;
    source?: string;
}

export interface SeedConversationFromContactLeadTextResult {
    seeded: boolean;
    reason?: "no_lead_text" | "already_seeded" | "conversation_already_has_messages";
    messageId?: string;
}

/**
 * Seeds a brand-new local conversation with the contact's captured lead inquiry text
 * so AI/tools have at least one real inbound message to work with.
 */
export async function seedConversationFromContactLeadText(
    params: SeedConversationFromContactLeadTextParams
): Promise<SeedConversationFromContactLeadTextResult> {
    const body = String(params.contact.message || "").trim();
    if (!body) {
        return { seeded: false, reason: "no_lead_text" };
    }

    const existingSeed = await db.message.findFirst({
        where: {
            conversationId: params.conversationId,
            direction: "inbound",
            source: params.source || "contact_bootstrap",
            body,
        },
        select: { id: true },
    });

    if (existingSeed) {
        return { seeded: false, reason: "already_seeded", messageId: existingSeed.id };
    }

    const existingRealMessageCount = await db.message.count({
        where: {
            conversationId: params.conversationId,
            direction: { in: ["inbound", "outbound"] },
        },
    });

    if (existingRealMessageCount > 0) {
        return { seeded: false, reason: "conversation_already_has_messages" };
    }

    const createdAt = params.messageDate ?? new Date();
    const type = String(params.messageType || "TYPE_SMS");
    const source = params.source || "contact_bootstrap";

    const message = await db.message.create({
        data: {
            conversationId: params.conversationId,
            type,
            direction: "inbound",
            status: "received",
            body,
            source,
            createdAt,
        },
        select: { id: true },
    });

    await updateConversationLastMessage({
        conversationId: params.conversationId,
        messageBody: body,
        messageType: type,
        messageDate: createdAt,
        direction: "inbound",
        // Imported lead text should not create a fake unread badge for the team.
        unreadCountIncrement: 0,
    });

    return { seeded: true, messageId: message.id };
}
