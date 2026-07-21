'use client';

import type { Conversation, Message } from '@/lib/ghl/conversations';
import { matchesByCorrelation } from '@/lib/conversations/outbound-reconciliation';
import { classifyOutboundSendFailure } from '@/lib/conversations/outbound-send-failure';

export type OutboundMessageType = 'SMS' | 'Email' | 'WhatsApp' | 'SMS_RELAY';
export type OutboundWhatsAppUiTone = "muted" | "info" | "success" | "warning" | "danger";
export type OutboundWhatsAppUiIcon = "clock" | "send" | "check" | "checkCheck" | "alert";

type TranslationOptions = {
    translationSourceText?: string | null;
    translationTargetLanguage?: string | null;
    translationDetectedSourceLanguage?: string | null;
};

type SendAck = {
    messageId?: unknown;
    clientMessageId?: unknown;
    body?: unknown;
    translation?: unknown;
    translations?: unknown;
    outboxJobId?: unknown;
    queued?: unknown;
    queueAccepted?: unknown;
    dispatchMode?: unknown;
    warning?: unknown;
    scheduledAt?: unknown;
    typingDelayMs?: unknown;
    typingDelayReason?: unknown;
    transport?: unknown;
    outboxStatus?: unknown;
};

type FailureFallbackUiState = {
    showFailureDetail: boolean;
    label: string | null;
    canSendSmsFallback: boolean;
    smsFallbackLabel: string | null;
    smsFallbackUnavailableLabel: string | null;
};

export type OutboundWhatsAppUiState = {
    label: "Queued" | "Scheduled" | "Rate limited" | "Sending" | "Sent" | "Delivered" | "Read" | "Retrying" | "Send not confirmed" | "Failed" | "SMS fallback available";
    tone: OutboundWhatsAppUiTone;
    icon: OutboundWhatsAppUiIcon;
    detail: string | null;
    showSpinner: boolean;
    canResend: boolean;
    canSmsFallback: boolean;
    scheduledAt: string | null;
    retryAttempt: number | null;
    lastError: string | null;
};

function normalizeString(value: unknown): string {
    return String(value || "").trim();
}

function normalizeLower(value: unknown): string {
    return normalizeString(value).toLowerCase();
}

function isOutboundWhatsAppMessage(message: {
    type?: string | null;
    direction?: string | null;
}): boolean {
    return normalizeString(message.type).toUpperCase().includes("WHATSAPP")
        && normalizeLower(message.direction) === "outbound";
}

function getFutureDelaySeconds(scheduledAt?: string | null, nowMs = Date.now()): number {
    const parsed = Date.parse(String(scheduledAt || ""));
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.ceil((parsed - nowMs) / 1000));
}

export function canManuallyResendOutboundMessageStatus(status: unknown) {
    const normalized = normalizeLower(status);
    return normalized === "failed" || normalized === "delivery_unconfirmed";
}

export function deriveOutboundWhatsAppUiState(message: {
    type?: string | null;
    direction?: string | null;
    status?: string | null;
    sendState?: string | null;
    outboxState?: {
        status?: string | null;
        scheduledAt?: string | null;
        attemptCount?: number | null;
        lastError?: string | null;
        rateLimitReason?: string | null;
        rateLimitNextEligibleAt?: string | null;
    } | null;
}, options?: {
    smsRelayEnabled?: boolean;
    contactPhone?: string | null;
    nowMs?: number;
}): OutboundWhatsAppUiState | null {
    if (!isOutboundWhatsAppMessage(message)) return null;

    const status = normalizeLower(message.status);
    const sendState = normalizeLower(message.sendState);
    const outboxStatus = normalizeLower(message.outboxState?.status);
    const scheduledAt = normalizeString(message.outboxState?.scheduledAt) || null;
    const scheduledDelaySeconds = getFutureDelaySeconds(scheduledAt, options?.nowMs);
    const retryAttempt = Number.isFinite(Number(message.outboxState?.attemptCount))
        ? Number(message.outboxState?.attemptCount)
        : null;
    const lastError = normalizeString(message.outboxState?.lastError) || null;
    const rateLimitReason = normalizeString(message.outboxState?.rateLimitReason) || lastError;

    const fallbackState = getWhatsAppFailureFallbackUiState({
        message,
        smsRelayEnabled: options?.smsRelayEnabled,
        contactPhone: options?.contactPhone || null,
    });

    if (fallbackState.canSendSmsFallback) {
        return {
            label: "SMS fallback available",
            tone: "danger",
            icon: "alert",
            detail: fallbackState.label,
            showSpinner: false,
            canResend: true,
            canSmsFallback: true,
            scheduledAt,
            retryAttempt,
            lastError,
        };
    }

    if (status === "read" || status === "played") {
        return {
            label: "Read",
            tone: "success",
            icon: "checkCheck",
            detail: null,
            showSpinner: false,
            canResend: false,
            canSmsFallback: false,
            scheduledAt,
            retryAttempt,
            lastError,
        };
    }

    if (status === "delivered") {
        return {
            label: "Delivered",
            tone: "success",
            icon: "checkCheck",
            detail: null,
            showSpinner: false,
            canResend: false,
            canSmsFallback: false,
            scheduledAt,
            retryAttempt,
            lastError,
        };
    }

    if (status === "delivery_unconfirmed" || outboxStatus === "delivery_unconfirmed") {
        return {
            label: "Send not confirmed",
            tone: "warning",
            icon: "alert",
            detail: "This warning is about this message, not the WhatsApp connection. Estio could not confirm it was sent. Check this contact's WhatsApp chat before retrying.",
            showSpinner: false,
            canResend: true,
            canSmsFallback: false,
            scheduledAt,
            retryAttempt,
            lastError,
        };
    }

    if (status === "dispatch_accepted" || outboxStatus === "dispatch_accepted") {
        return {
            label: "Sending",
            tone: "info",
            icon: "send",
            detail: "Waiting for WhatsApp confirmation",
            showSpinner: true,
            canResend: false,
            canSmsFallback: false,
            scheduledAt,
            retryAttempt,
            lastError,
        };
    }

    if (status === "sent" || outboxStatus === "completed" || sendState === "sent") {
        return {
            label: "Sent",
            tone: "muted",
            icon: "check",
            detail: null,
            showSpinner: false,
            canResend: false,
            canSmsFallback: false,
            scheduledAt,
            retryAttempt,
            lastError,
        };
    }

    if (status === "failed" || outboxStatus === "dead" || sendState === "failed") {
        return {
            label: "Failed",
            tone: "danger",
            icon: "alert",
            detail: lastError,
            showSpinner: false,
            canResend: true,
            canSmsFallback: false,
            scheduledAt,
            retryAttempt,
            lastError,
        };
    }

    if (sendState === "retrying" || outboxStatus === "failed") {
        return {
            label: "Retrying",
            tone: "warning",
            icon: "alert",
            detail: scheduledDelaySeconds > 0 ? `Retrying automatically in ${scheduledDelaySeconds}s` : "Retrying automatically",
            showSpinner: true,
            canResend: false,
            canSmsFallback: false,
            scheduledAt,
            retryAttempt,
            lastError,
        };
    }

    if (outboxStatus === "rate_limited") {
        return {
            label: "Rate limited",
            tone: "warning",
            icon: "clock",
            detail: rateLimitReason || (scheduledDelaySeconds > 0
                ? `Eligible for retry in ${scheduledDelaySeconds}s`
                : "Waiting for the next safe send window"),
            showSpinner: true,
            canResend: false,
            canSmsFallback: false,
            scheduledAt,
            retryAttempt,
            lastError,
        };
    }

    if (outboxStatus === "processing" || sendState === "sending") {
        return {
            label: "Sending",
            tone: "info",
            icon: "send",
            detail: "Waiting for WhatsApp bridge",
            showSpinner: true,
            canResend: false,
            canSmsFallback: false,
            scheduledAt,
            retryAttempt,
            lastError,
        };
    }

    if (scheduledDelaySeconds > 0) {
        return {
            label: "Scheduled",
            tone: "info",
            icon: "clock",
            detail: `Scheduled in ${scheduledDelaySeconds}s`,
            showSpinner: true,
            canResend: false,
            canSmsFallback: false,
            scheduledAt,
            retryAttempt,
            lastError,
        };
    }

    return {
        label: "Queued",
        tone: "muted",
        icon: "clock",
        detail: "Waiting briefly before sending",
        showSpinner: true,
        canResend: false,
        canSmsFallback: false,
        scheduledAt,
        retryAttempt,
        lastError,
    };
}

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

export function getWhatsAppFailureFallbackUiState(args: {
    message: {
        type?: string | null;
        direction?: string | null;
        status?: string | null;
        outboxState?: {
            status?: string | null;
            lastError?: string | null;
        } | null;
    };
    smsRelayEnabled?: boolean;
    contactPhone?: string | null;
}): FailureFallbackUiState {
    const type = String(args.message.type || "").toUpperCase();
    const isFailedOutboundWhatsApp = type.includes("WHATSAPP")
        && String(args.message.direction || "").toLowerCase() === "outbound"
        && String(args.message.status || "").toLowerCase() === "failed";
    if (!isFailedOutboundWhatsApp) {
        return {
            showFailureDetail: false,
            label: null,
            canSendSmsFallback: false,
            smsFallbackLabel: null,
            smsFallbackUnavailableLabel: null,
        };
    }

    const classification = classifyOutboundSendFailure(args.message.outboxState || {});
    if (classification.code !== "WHATSAPP_NUMBER_NOT_FOUND") {
        return {
            showFailureDetail: false,
            label: null,
            canSendSmsFallback: false,
            smsFallbackLabel: null,
            smsFallbackUnavailableLabel: null,
        };
    }

    const hasPhone = String(args.contactPhone || "").replace(/\D/g, "").length >= 7;
    const canSendSmsFallback = !!args.smsRelayEnabled && hasPhone;

    return {
        showFailureDetail: true,
        label: classification.label,
        canSendSmsFallback,
        smsFallbackLabel: canSendSmsFallback ? "Retry via Android SMS" : null,
        smsFallbackUnavailableLabel: canSendSmsFallback ? null : "SMS fallback unavailable",
    };
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
    const scheduledAt = String(ack.scheduledAt || "").trim();
    const typingDelayMs = Number(ack.typingDelayMs);
    const typingDelayReason = String(ack.typingDelayReason || "").trim();
    const outboxStatus = String(ack.outboxStatus || "").trim();

    return {
        ackMessageId,
        ackClientMessageId,
        outboxJobId,
        queued,
        fallbackSent,
        degradedDelivery,
        warning,
        scheduledAt,
        typingDelayMs: Number.isFinite(typingDelayMs) ? typingDelayMs : null,
        typingDelayReason,
        outboxStatus,
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
        const dispatchAccepted = ackState.outboxStatus === "dispatch_accepted";
        const completedFallback = ackState.fallbackSent && !dispatchAccepted;

        return {
            ...message,
            ...(ackState.ackMessageId ? { id: ackState.ackMessageId } : {}),
            clientMessageId: ackState.ackClientMessageId,
            ...(typeof args.ack.body === "string" ? { body: args.ack.body } : {}),
            ...(args.ack.translation && typeof args.ack.translation === "object" ? { translation: args.ack.translation as any } : {}),
            ...(Array.isArray(args.ack.translations) ? { translations: args.ack.translations as any } : {}),
            status: completedFallback ? 'sent' : (dispatchAccepted ? 'dispatch_accepted' : (ackState.queued ? 'sending' : 'sent')),
            sendState: completedFallback ? 'sent' : (dispatchAccepted ? 'queued' : (ackState.degradedDelivery ? 'retrying' : (ackState.queued ? 'queued' : 'sent'))),
            outboxState: {
                id: ackState.outboxJobId || (message as any)?.outboxState?.id || null,
                status: completedFallback ? 'completed' : (ackState.degradedDelivery ? 'failed' : (ackState.outboxStatus || (ackState.queued ? 'pending' : 'completed'))),
                ...(ackState.scheduledAt ? { scheduledAt: ackState.scheduledAt } : {}),
                ...(ackState.typingDelayMs !== null ? { typingDelayMs: ackState.typingDelayMs } : {}),
                ...(ackState.typingDelayReason ? { typingDelayReason: ackState.typingDelayReason } : {}),
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
        const dispatchAccepted = ackState.outboxStatus === "dispatch_accepted";
        const completedFallback = ackState.fallbackSent && !dispatchAccepted;
        return {
            ...message,
            ...(ackState.ackMessageId ? { id: ackState.ackMessageId } : {}),
            clientMessageId: ackState.ackClientMessageId,
            status: completedFallback ? 'sent' : (dispatchAccepted ? 'dispatch_accepted' : (ackState.queued ? 'sending' : 'sent')),
            sendState: completedFallback ? 'sent' : (dispatchAccepted ? 'queued' : (ackState.degradedDelivery ? 'retrying' : (ackState.queued ? 'queued' : 'sent'))),
            outboxState: completedFallback
                ? { id: ackState.outboxJobId || null, status: 'completed' }
                : dispatchAccepted
                    ? { id: ackState.outboxJobId || null, status: 'dispatch_accepted', ...(ackState.scheduledAt ? { scheduledAt: ackState.scheduledAt } : {}) }
                : ackState.degradedDelivery
                    ? { id: ackState.outboxJobId || null, status: 'failed', ...(ackState.scheduledAt ? { scheduledAt: ackState.scheduledAt } : {}) }
                    : ackState.queued
                        ? { id: ackState.outboxJobId || null, status: ackState.outboxStatus || 'pending', ...(ackState.scheduledAt ? { scheduledAt: ackState.scheduledAt } : {}) }
                        : { id: ackState.outboxJobId || null, status: 'completed' },
        } as Message;
    });
}
