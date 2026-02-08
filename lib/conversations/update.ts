import db from "@/lib/db";

export interface UpdateConversationParams {
    conversationId: string;
    messageBody: string;
    messageType: string;
    messageDate: Date;
    direction: 'inbound' | 'outbound';
    status?: string;
    unreadCountIncrement?: number;
}

/**
 * Unified logic to update conversation last message and timestamp.
 * Enforces:
 * 1. Future Date Protection (Max 24h into future)
 * 2. Ordering Rule (Only update if new date > existing date)
 * 3. Unread Count Management
 */
export async function updateConversationLastMessage(params: UpdateConversationParams) {
    const { conversationId, messageBody, messageType, messageDate, direction, unreadCountIncrement } = params;

    // 1. Sanity Check: Future Dates
    // Allow small clock drift, but reject dates > 24 hours in future
    const now = new Date();
    const maxFuture = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    if (messageDate > maxFuture) {
        console.warn(`[Conversation Update] REJECTED: Message date ${messageDate} is too far in future.`);
        return;
    }

    // 2. Fetch Existing Conversation
    const conversation = await db.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, lastMessageAt: true, unreadCount: true }
    });

    if (!conversation) {
        console.warn(`[Conversation Update] Conversation ${conversationId} not found.`);
        return;
    }

    // 3. Determine if we should update timestamp
    // Rule: Update if new date is newer than stored date
    // OR if stored date is "Epoch" (fallback)
    const storedDate = conversation.lastMessageAt;
    const isStoredEpoch = storedDate.getTime() === 0 || storedDate.getFullYear() === 1970;

    const shouldUpdateTimestamp = isStoredEpoch || messageDate > storedDate;

    // 4. Prepare Update Data
    const updateData: any = {};

    if (shouldUpdateTimestamp) {
        updateData.lastMessageBody = messageBody;
        updateData.lastMessageAt = messageDate;
        updateData.lastMessageType = messageType;
    }

    // 5. Handle Unread Count
    // If explicit increment provided, use it.
    // Otherwise, increment for inbound, reset/zero for outbound (usually read by user)
    // Wait, outbound usually means WE sent it, so it shouldn't increment unread.
    // Unread count is for the USER (Admin).

    if (unreadCountIncrement !== undefined) {
        updateData.unreadCount = { increment: unreadCountIncrement };
    } else {
        if (direction === 'inbound') {
            updateData.unreadCount = { increment: 1 };
        } else {
            // If outbound, we don't necessarily reset unread count?
            // Usually if we reply, we have "read" the conversation.
            // But maybe we just leave it?
            // Let's stick to incrementing for inbound only for now.
        }
    }

    // 6. Update DB
    if (Object.keys(updateData).length > 0) {
        // Always bump updatedAt
        updateData.updatedAt = new Date();
        updateData.status = 'open'; // Re-open on new message? Usually yes.

        await db.conversation.update({
            where: { id: conversationId },
            data: updateData
        });

        console.log(`[Conversation Update] Updated ${conversationId}. Timestamp updated: ${shouldUpdateTimestamp}`);
    }
}
