import type { Message } from '@/lib/ghl/conversations';
import { matchesByCorrelation } from '@/lib/conversations/outbound-reconciliation';

export type RealtimeMessagePatchPayload = {
    messageId: string;
    clientMessageId: string;
    wamId: string;
    status: string;
    outboxJobId?: string;
    outboxStatus?: string;
    scheduledAt?: string;
    attemptCount?: number | null;
    lastError?: string | null;
};

export type RealtimeMessagePatchResult = {
    messages: Message[];
    matched: boolean;
    payload: RealtimeMessagePatchPayload;
};

export type InboundRealtimePayload = {
    messageId: string;
    clientMessageId: string;
    wamId: string;
    body: string;
    createdAt: string;
};

export type InboundRealtimeCorrelation = {
    messageId: string;
    wamId: string;
};

export function normalizeRealtimeMessagePatchPayload(payload: Record<string, unknown>): RealtimeMessagePatchPayload {
    return {
        messageId: String(payload?.messageId || "").trim(),
        clientMessageId: String(payload?.clientMessageId || "").trim(),
        wamId: String(payload?.wamId || "").trim(),
        status: String(payload?.status || "").trim(),
        outboxJobId: String(payload?.outboxJobId || "").trim(),
        outboxStatus: String(payload?.outboxStatus || "").trim(),
        scheduledAt: String(payload?.scheduledAt || "").trim(),
        attemptCount: Number.isFinite(Number(payload?.attemptCount)) ? Number(payload?.attemptCount) : null,
        lastError: payload?.lastError ? String(payload.lastError) : null,
    };
}

export function getRealtimeMessageSendState(status: string): "sending" | "failed" | "sent" {
    return status === "sending"
        ? "sending"
        : status === "failed"
            ? "failed"
            : "sent";
}

export function applyRealtimeMessagePatchToMessages(
    messages: Message[],
    payload: Record<string, unknown>
): RealtimeMessagePatchResult {
    const normalized = normalizeRealtimeMessagePatchPayload(payload);
    let matched = false;

    const nextMessages = messages.map((message) => {
        const isMatch = matchesByCorrelation(message as any, {
            messageId: normalized.messageId || null,
            clientMessageId: normalized.clientMessageId || null,
            wamId: normalized.wamId || normalized.messageId || null,
        });
        if (!isMatch) return message;

        matched = true;
        return {
            ...message,
            ...(normalized.messageId ? { id: normalized.messageId } : {}),
            ...(normalized.clientMessageId ? { clientMessageId: normalized.clientMessageId } : {}),
            ...(normalized.wamId ? { wamId: normalized.wamId } : {}),
            ...(normalized.status ? { status: normalized.status } : {}),
            ...(normalized.status ? { sendState: getRealtimeMessageSendState(normalized.status) } : {}),
            ...(normalized.outboxStatus ? {
                outboxState: {
                    ...((message as any).outboxState || {}),
                    id: normalized.outboxJobId || (message as any).outboxState?.id || null,
                    status: normalized.outboxStatus,
                    ...(normalized.scheduledAt ? { scheduledAt: normalized.scheduledAt } : {}),
                    ...(normalized.attemptCount !== null ? { attemptCount: normalized.attemptCount } : {}),
                    ...(normalized.lastError ? { lastError: normalized.lastError } : {}),
                },
            } : {}),
        } as Message;
    });

    return {
        messages: nextMessages,
        matched,
        payload: normalized,
    };
}

export function normalizeInboundRealtimePayload(payload: Record<string, unknown>): InboundRealtimePayload {
    return {
        messageId: String(payload?.messageId || "").trim(),
        clientMessageId: String(payload?.clientMessageId || "").trim(),
        wamId: String(payload?.wamId || "").trim(),
        body: String(payload?.body ?? ""),
        createdAt: String(payload?.createdAt || new Date().toISOString()),
    };
}

export function buildOptimisticInboundMessage(payload: InboundRealtimePayload): Message {
    return {
        id: payload.messageId,
        wamId: payload.wamId || undefined,
        clientMessageId: payload.clientMessageId || undefined,
        conversationId: "",
        contactId: "",
        body: payload.body,
        type: "WhatsApp",
        direction: "inbound" as const,
        status: "received",
        sendState: "sent",
        dateAdded: payload.createdAt,
        attachments: [],
    } as Message;
}

export function appendInboundMessageIfMissing(
    messages: Message[],
    optimisticMessage: Message,
    correlation: InboundRealtimeCorrelation
): Message[] {
    if (!correlation.messageId) return messages;
    if (messages.some((message) => (
        message.id === correlation.messageId
        || (correlation.wamId && (message as any).wamId === correlation.wamId)
    ))) {
        return messages;
    }

    return [...messages, optimisticMessage];
}
