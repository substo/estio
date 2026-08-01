export const CONVERSATION_TEXT_CHANNELS = ["SMS", "Email", "WhatsApp", "SMS_RELAY"] as const;

export type ConversationTextChannel = typeof CONVERSATION_TEXT_CHANNELS[number];

export type SendReplyApiPayload = {
    conversationId: string;
    contactId: string;
    messageBody: string;
    type: ConversationTextChannel;
    clientMessageId: string | null;
    clientSentAt: string | null;
    translationSourceText: string | null;
    translationTargetLanguage: string | null;
    translationDetectedSourceLanguage: string | null;
    agentFeedback: Record<string, unknown> | null;
    retryMessageId: string | null;
    locationId?: string | null;
};

export function buildSendReplyApiPayload(args: {
    conversationId: string;
    contactId: string;
    messageBody: string;
    type: ConversationTextChannel;
    clientMessageId?: string | null;
    clientSentAt?: string | null;
    translationSourceText?: string | null;
    translationTargetLanguage?: string | null;
    translationDetectedSourceLanguage?: string | null;
    agentFeedback?: Record<string, unknown> | null;
    retryMessageId?: string | null;
}): SendReplyApiPayload {
    return {
        conversationId: String(args.conversationId || "").trim(),
        contactId: String(args.contactId || "").trim(),
        messageBody: String(args.messageBody || ""),
        type: args.type,
        clientMessageId: args.clientMessageId ? String(args.clientMessageId) : null,
        clientSentAt: args.clientSentAt ? String(args.clientSentAt) : null,
        translationSourceText: args.translationSourceText ? String(args.translationSourceText) : null,
        translationTargetLanguage: args.translationTargetLanguage ? String(args.translationTargetLanguage) : null,
        translationDetectedSourceLanguage: args.translationDetectedSourceLanguage
            ? String(args.translationDetectedSourceLanguage)
            : null,
        agentFeedback: args.agentFeedback && typeof args.agentFeedback === "object" ? args.agentFeedback : null,
        retryMessageId: args.retryMessageId ? String(args.retryMessageId) : null,
    };
}

export function parseSendReplyApiPayload(body: unknown):
    | { success: true; payload: SendReplyApiPayload }
    | { success: false; error: string } {
    const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const type = String(input.type || "") as ConversationTextChannel;
    if (!CONVERSATION_TEXT_CHANNELS.includes(type)) {
        return { success: false, error: "Unsupported message channel." };
    }

    const payload = buildSendReplyApiPayload({
        conversationId: String(input.conversationId || ""),
        contactId: String(input.contactId || ""),
        messageBody: String(input.messageBody || ""),
        type,
        clientMessageId: input.clientMessageId ? String(input.clientMessageId) : null,
        clientSentAt: input.clientSentAt ? String(input.clientSentAt) : null,
        translationSourceText: input.translationSourceText ? String(input.translationSourceText) : null,
        translationTargetLanguage: input.translationTargetLanguage ? String(input.translationTargetLanguage) : null,
        translationDetectedSourceLanguage: input.translationDetectedSourceLanguage
            ? String(input.translationDetectedSourceLanguage)
            : null,
        agentFeedback: input.agentFeedback && typeof input.agentFeedback === "object"
            ? input.agentFeedback as Record<string, unknown>
            : null,
        retryMessageId: input.retryMessageId ? String(input.retryMessageId) : null,
    });

    if (!payload.conversationId || !payload.contactId || !payload.messageBody.trim()) {
        return { success: false, error: "Missing required send fields." };
    }

    const assertedLocationId = String(input.locationId || "").trim();
    return {
        success: true,
        payload: assertedLocationId ? { ...payload, locationId: assertedLocationId } : payload,
    };
}
