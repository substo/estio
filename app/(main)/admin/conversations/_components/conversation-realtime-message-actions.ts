import type { Message } from '@/lib/ghl/conversations';
import { matchesByCorrelation } from '@/lib/conversations/outbound-reconciliation';

export type RealtimeMessagePatchPayload = {
    messageId: string;
    clientMessageId: string;
    wamId: string;
    body?: string;
    translation?: unknown;
    translations?: unknown[];
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
    messageId?: string | null;
    wamId?: string | null;
    clientMessageId?: string | null;
};

export function normalizeRealtimeMessagePatchPayload(payload: Record<string, unknown>): RealtimeMessagePatchPayload {
    return {
        messageId: String(payload?.messageId || "").trim(),
        clientMessageId: String(payload?.clientMessageId || "").trim(),
        wamId: String(payload?.wamId || "").trim(),
        body: typeof payload?.body === "string" ? payload.body : undefined,
        translation: payload?.translation && typeof payload.translation === "object" ? payload.translation : undefined,
        translations: Array.isArray(payload?.translations) ? payload.translations : undefined,
        status: String(payload?.status || "").trim(),
        outboxJobId: String(payload?.outboxJobId || "").trim(),
        outboxStatus: String(payload?.outboxStatus || "").trim(),
        scheduledAt: String(payload?.scheduledAt || "").trim(),
        attemptCount: Number.isFinite(Number(payload?.attemptCount)) ? Number(payload?.attemptCount) : null,
        lastError: payload?.lastError ? String(payload.lastError) : null,
    };
}

export function getRealtimeMessageSendState(status: string): "sending" | "failed" | "sent" {
    return status === "sending" || status === "dispatch_accepted"
        ? "sending"
        : status === "failed" || status === "delivery_unconfirmed"
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
            ...(typeof normalized.body === "string" ? { body: normalized.body } : {}),
            ...(normalized.translation && typeof normalized.translation === "object" ? { translation: normalized.translation as any } : {}),
            ...(Array.isArray(normalized.translations) ? { translations: normalized.translations as any } : {}),
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
    const messageId = String(
        payload?.messageId
        || payload?.id
        || payload?.message_id
        || payload?.localMessageId
        || ""
    ).trim();
    const wamId = String(
        payload?.wamId
        || payload?.wam_id
        || payload?.providerMessageId
        || payload?.provider_message_id
        || payload?.externalMessageId
        || ""
    ).trim();
    const clientMessageId = String(
        payload?.clientMessageId
        || payload?.client_message_id
        || ""
    ).trim();

    return {
        messageId,
        clientMessageId,
        wamId,
        body: String(payload?.body ?? ""),
        createdAt: String(payload?.createdAt || new Date().toISOString()),
    };
}

export function buildOptimisticInboundMessage(payload: InboundRealtimePayload, conversationId = ""): Message {
    const fallbackId = payload.messageId || payload.wamId || payload.clientMessageId;

    return {
        id: fallbackId,
        wamId: payload.wamId || undefined,
        clientMessageId: payload.clientMessageId || undefined,
        conversationId,
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
    const messageId = String(correlation.messageId || "").trim();
    const wamId = String(correlation.wamId || "").trim();
    const clientMessageId = String(correlation.clientMessageId || "").trim();
    if (!messageId && !wamId && !clientMessageId) return messages;

    if (messages.some((message) => (
        (messageId && message.id === messageId)
        || (wamId && (message as any).wamId === wamId)
        || (clientMessageId && (message as any).clientMessageId === clientMessageId)
    ))) {
        return messages;
    }

    return [...messages, optimisticMessage];
}
