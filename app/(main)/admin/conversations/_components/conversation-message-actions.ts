'use client';

import type { Conversation, Message } from '@/lib/ghl/conversations';
import { matchesByCorrelation } from '@/lib/conversations/outbound-reconciliation';

export type OutboundMessageType = 'SMS' | 'Email' | 'WhatsApp' | 'SMS_RELAY';

type TranslationOptions = {
    translationSourceText?: string | null;
    translationTargetLanguage?: string | null;
    translationDetectedSourceLanguage?: string | null;
};

type SendAck = {
    messageId?: unknown;
    clientMessageId?: unknown;
    outboxJobId?: unknown;
    queued?: unknown;
    queueAccepted?: unknown;
    dispatchMode?: unknown;
    warning?: unknown;
};

export function createOutboundClientMessageId(): string {
    return (
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? `cmid_${crypto.randomUUID()}`
            : `cmid_${Date.now()}_${Math.random().toString(36).slice(2)}`
    );
}

export function buildOptimisticTextMessage(args: {
    clientMessageId: string;
    conversation: Conversation;
    text: string;
    type: OutboundMessageType;
    options?: TranslationOptions;
}): Message {
    const translationSourceText = String(args.options?.translationSourceText || "").trim();
    const targetLanguage = args.options?.translationTargetLanguage
        || args.conversation.replyLanguageOverride
        || args.conversation.locationDefaultReplyLanguage
        || "en";

    return {
        id: `opt-${args.clientMessageId}`,
        clientMessageId: args.clientMessageId,
        conversationId: args.conversation.id,
        contactId: args.conversation.contactId,
        body: args.text,
        type: args.type,
        direction: 'outbound',
        status: 'sending',
        sendState: 'queued',
        outboxState: { id: null, status: 'pending' },
        dateAdded: new Date().toISOString(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...(translationSourceText ? {
            translation: {
                active: {
                    targetLanguage,
                    sourceLanguage: args.options?.translationDetectedSourceLanguage || null,
                    sourceText: translationSourceText,
                    translatedText: args.text,
                    status: "completed",
                    provider: "manual_send_preview",
                    model: "manual_send_preview",
                    updatedAt: new Date().toISOString(),
                },
                available: [{
                    targetLanguage,
                    sourceLanguage: args.options?.translationDetectedSourceLanguage || null,
                    sourceText: translationSourceText,
                    translatedText: args.text,
                    status: "completed",
                    provider: "manual_send_preview",
                    model: "manual_send_preview",
                    updatedAt: new Date().toISOString(),
                }],
                viewDefault: "original",
            },
        } : {}),
    } as unknown as Message;
}

export function buildOptimisticMediaMessage(args: {
    clientMessageId: string;
    conversation: Conversation;
    caption: string;
    fileName: string;
    mimeType?: string;
    objectUrl: string;
}): Message {
    return {
        id: `opt-media-${args.clientMessageId}`,
        clientMessageId: args.clientMessageId,
        conversationId: args.conversation.id,
        contactId: args.conversation.contactId,
        body: args.caption,
        type: 'WhatsApp',
        direction: 'outbound',
        status: 'sending',
        sendState: 'queued',
        outboxState: { id: null, status: 'pending' },
        dateAdded: new Date().toISOString(),
        createdAt: new Date(),
        updatedAt: new Date(),
        attachments: [
            {
                id: `opt-att-${Date.now()}`,
                url: args.objectUrl,
                fileName: args.fileName,
                mimeType: args.mimeType || 'application/octet-stream',
            },
        ],
    } as unknown as Message;
}

export function appendOptimisticMessage(messages: Message[], message: Message): Message[] {
    return [...messages, message];
}

export function markMessageFailedById(messages: Message[], messageId: string, options?: { deadOutbox?: boolean }): Message[] {
    return messages.map((message) => {
        if (message.id !== messageId) return message;
        return {
            ...message,
            status: 'failed',
            sendState: 'failed',
            ...(options?.deadOutbox
                ? { outboxState: { ...(message as any).outboxState, status: 'dead' } }
                : {}),
        } as Message;
    });
}

export function markMessageSendingById(messages: Message[], messageId: string): Message[] {
    return messages.map((message) => (
        message.id === messageId
            ? { ...message, status: 'sending', sendState: 'queued' } as Message
            : message
    ));
}

export function normalizeSendError(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error || "");
    const lower = raw.toLowerCase();
    if (
        lower.includes("failed to find server action")
        || lower.includes("failed-to-find-server-action")
        || (lower.includes("server action") && lower.includes("not found"))
    ) {
        return "Page updated. Reload and try again.";
    }
    return raw || "Unknown error occurred";
}

export function getSendAckState(ack: SendAck, fallbackClientMessageId: string, options?: { media?: boolean }) {
    const ackMessageId = String(ack.messageId || "").trim();
    const ackClientMessageId = String(ack.clientMessageId || fallbackClientMessageId).trim();
    const outboxJobId = String(ack.outboxJobId || "").trim();
    const queued = options?.media ? true : !!ack.queued;
    const queueAccepted = ack.queueAccepted !== false;
    const dispatchMode = String(ack.dispatchMode || "queued").trim();
    const fallbackSent = dispatchMode === "inline_fallback_sent";
    const degradedDelivery = options?.media
        ? !queueAccepted && !fallbackSent
        : !queueAccepted && queued && !fallbackSent;
    const warning = String(ack.warning || "").trim();

    return {
        ackMessageId,
        ackClientMessageId,
        outboxJobId,
        queued,
        fallbackSent,
        degradedDelivery,
        warning,
    };
}

export function applySendAckByCorrelation(messages: Message[], args: {
    optimisticMessageId: string;
    optimisticClientMessageId: string;
    ack: SendAck;
    media?: boolean;
}): Message[] {
    const ackState = getSendAckState(args.ack, args.optimisticClientMessageId, { media: args.media });
    return messages.map((message) => {
        const isTarget = matchesByCorrelation(message as any, {
            messageId: args.optimisticMessageId,
            clientMessageId: args.optimisticClientMessageId,
        });
        if (!isTarget) return message;

        return {
            ...message,
            ...(ackState.ackMessageId ? { id: ackState.ackMessageId } : {}),
            clientMessageId: ackState.ackClientMessageId,
            status: ackState.fallbackSent ? 'sent' : (ackState.queued ? 'sending' : 'sent'),
            sendState: ackState.fallbackSent ? 'sent' : (ackState.degradedDelivery ? 'retrying' : (ackState.queued ? 'queued' : 'sent')),
            outboxState: {
                id: ackState.outboxJobId || (message as any)?.outboxState?.id || null,
                status: ackState.fallbackSent ? 'completed' : (ackState.degradedDelivery ? 'failed' : (ackState.queued ? 'pending' : 'completed')),
            },
        } as Message;
    });
}

export function applyResendAckById(messages: Message[], args: {
    messageId: string;
    clientMessageId: string;
    ack: SendAck;
}): Message[] {
    const ackState = getSendAckState(args.ack, args.clientMessageId);
    return messages.map((message) => {
        if (message.id !== args.messageId) return message;
        return {
            ...message,
            ...(ackState.ackMessageId ? { id: ackState.ackMessageId } : {}),
            clientMessageId: ackState.ackClientMessageId,
            status: ackState.fallbackSent ? 'sent' : (ackState.queued ? 'sending' : 'sent'),
            sendState: ackState.fallbackSent ? 'sent' : (ackState.degradedDelivery ? 'retrying' : (ackState.queued ? 'queued' : 'sent')),
            outboxState: ackState.fallbackSent
                ? { id: ackState.outboxJobId || null, status: 'completed' }
                : ackState.degradedDelivery
                    ? { id: ackState.outboxJobId || null, status: 'failed' }
                    : ackState.queued
                        ? { id: ackState.outboxJobId || null, status: 'pending' }
                        : { id: ackState.outboxJobId || null, status: 'completed' },
        } as Message;
    });
}
