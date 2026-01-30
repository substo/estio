import { ghlFetch } from "./client";

export interface Conversation {
    id: string;
    contactId: string;
    locationId: string;
    lastMessageBody: string;
    lastMessageDate: number;
    lastMessageType?: string; // e.g. "TYPE_SMS", "TYPE_EMAIL"
    unreadCount: number;
    status: 'open' | 'closed' | 'all' | 'starred';
    assignedTo?: string;
    type: string; // "TYPE_PHONE", "TYPE_EMAIL", "TYPE_WHATSAPP", etc.
    contactName?: string; // Often enriched or separate
    contactPhone?: string; // For SMS/WhatsApp display
    contactEmail?: string; // For Email display
    lastMessageDirection?: 'inbound' | 'outbound';
    lastMessageId?: string;
    suggestedActions?: string[];
}

export interface Message {
    id: string;
    conversationId: string;
    contactId: string;
    contactName?: string;
    body: string;
    source?: string; // e.g. "app", "workflow", "email"
    userId?: string;
    type: string; // "TYPE_SMS", "TYPE_EMAIL", etc.
    direction: 'inbound' | 'outbound';
    status: string;
    dateAdded: string; // ISO or timestamp
    attachments?: string[];
    html?: string; // For Email content
    subject?: string; // For Email
    emailFrom?: string;
    emailTo?: string;
    emailCc?: string[];
    emailBcc?: string[]; // Although BCC usually hidden, API might return it for sender
    messageType?: string; // e.g. "TYPE_EMAIL"
    meta?: any; // e.g. { email: { messageIds: [...] } }
}

interface GetConversationsParams {
    status?: 'open' | 'closed' | 'all' | 'starred';
    limit?: number;
    offset?: number;
    sortBy?: 'last_message_date' | 'last_manual_message_date';
    sortDirection?: 'asc' | 'desc';
    locationId: string;
}

interface SendMessagePayload {
    type: 'SMS' | 'Email' | 'WhatsApp' | 'Custom';
    contactId: string;
    message?: string;
    subject?: string; // For Email
    html?: string; // For Email
    emailFrom?: string; // Custom sender email address
    emailFromName?: string; // Custom sender display name
    attachments?: string[];
    replyMessageId?: string; // For threading
    conversationProviderId?: string; // For Custom Channels
}

export async function getConversations(accessToken: string, params: GetConversationsParams) {
    const query = new URLSearchParams();
    if (params.status) query.append('status', params.status);
    if (params.limit) query.append('limit', params.limit.toString());
    if (params.offset) query.append('offset', params.offset.toString());
    if (params.sortBy) query.append('sortBy', params.sortBy);
    if (params.sortDirection) query.append('sortDirection', params.sortDirection);
    query.append('locationId', params.locationId);

    const res = await ghlFetch<{ conversations: Conversation[], total: number }>(
        `/conversations/search?${query.toString()}`,
        accessToken
    );

    // Debug: Log first conversation to see all fields
    if (res.conversations && res.conversations.length > 0) {
        console.log('[GHL DEBUG] First conversation raw data:', JSON.stringify(res.conversations[0], null, 2));
    }

    return res;
}

interface MessagesResponse {
    messages: {
        lastMessageId?: string;
        nextPage?: boolean;
        messages: Message[];
    };
}

export async function getMessages(accessToken: string, conversationId: string) {
    // NOTE: Check if it's /conversations/{id}/messages or just /conversations/{id}
    // Search results suggested: get messages by conversation ID.
    // Common pattern is /conversations/{id}/messages
    return ghlFetch<MessagesResponse>(
        `/conversations/${conversationId}/messages`,
        accessToken
    );
}

export async function getConversation(accessToken: string, conversationId: string) {
    const res = await ghlFetch<any>(
        `/conversations/${conversationId}`,
        accessToken
    );

    // API V2 get conversation often returns the object directly, not wrapped in 'conversation'
    if (res?.conversation) {
        return res as { conversation: Conversation };
    }

    // If it looks like a conversation (has id), wrap it
    if (res?.id) {
        return { conversation: res as Conversation };
    }

    // Return as-is or empty if structure is unknown
    return { conversation: res as Conversation };
}

export async function sendMessage(accessToken: string, payload: SendMessagePayload) {
    return ghlFetch<any>(
        `/conversations/messages`,
        accessToken,
        {
            method: 'POST',
            body: JSON.stringify(payload)
        }
    );
}

export async function getMessage(accessToken: string, messageId: string) {
    return ghlFetch<{ message: Message }>(
        `/conversations/messages/${messageId}`,
        accessToken
    );
}

/**
 * Injects an external message (e.g. from Gmail) into GHL conversation stream.
 * This effectively logs the email without triggering a send from GHL side
 * if correct parameters are used.
 */
export async function createInboundMessage(accessToken: string, payload: {
    type: 'Email' | 'SMS';
    contactId: string;
    direction: 'inbound' | 'outbound';
    status: 'delivered' | 'read' | 'received';
    body?: string;
    subject?: string;
    html?: string;
    emailFrom?: string;
    emailTo?: string;
    dateAdded?: number; // timestamp in ms
    threadId?: string;  // To group in same conversation
}) {
    // The endpoint is the same as send, but we use specific flags to indicate
    // it's an external message being logged.
    // Note: Official documentation on this is sparse, but 'direction' and 'status'
    // are key.
    return ghlFetch<{ messageId: string; conversationId: string; msg: any }>(
        `/conversations/messages/inbound`, // Using the inbound webhook endpoint pattern if available, or fallback to standard
        accessToken,
        {
            method: 'POST',
            body: JSON.stringify({
                ...payload,
                // Ensure we don't accidentally send
                status: payload.status || 'delivered',
            })
        }
    ).catch(async (err) => {
        // Fallback: If specific inbound endpoint fails, try standard with "InboundMessage" type if strictly inbound
        // or just standard message with status=delivered for outbound logging.
        console.warn("[GHL Inbound] Failed to inject via /inbound, trying standard /messages", err);

        const standardPayload = {
            ...payload,
            // type: 'InboundMessage' is sometimes valid for strictly incoming logic
            // but 'Email' with direction 'inbound' is safer.
        };

        return ghlFetch<any>(
            `/conversations/messages`,
            accessToken,
            {
                method: 'POST',
                body: JSON.stringify(standardPayload)
            }
        );
    });
}
