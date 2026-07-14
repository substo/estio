import assert from 'node:assert/strict';
import test from 'node:test';

import type { Conversation, Message } from '@/lib/ghl/conversations';
import {
    applyResendAckById,
    applySendAckByCorrelation,
    buildOptimisticTextMessage,
    deriveOutboundWhatsAppUiState,
    getSendAckState,
    getWhatsAppFailureFallbackUiState,
    markMessageFailedById,
    markMessageSendingById,
    normalizeSendError,
} from './conversation-message-actions';

const conversation = {
    id: 'conv-1',
    contactId: 'contact-1',
    replyLanguageOverride: 'el',
} as Conversation;

const baseMessage = {
    id: 'msg-1',
    clientMessageId: 'cmid_1',
    conversationId: 'conv-1',
    contactId: 'contact-1',
    body: 'hello',
    type: 'WhatsApp',
    direction: 'outbound',
    status: 'sending',
    sendState: 'queued',
    outboxState: { id: null, status: 'pending' },
    dateAdded: '2026-05-21T10:00:00.000Z',
} as unknown as Message;

test('buildOptimisticTextMessage preserves manual translation metadata', () => {
    const message = buildOptimisticTextMessage({
        clientMessageId: 'cmid_translation',
        conversation,
        text: 'γειά',
        type: 'WhatsApp',
        options: {
            translationSourceText: 'hello',
            translationDetectedSourceLanguage: 'en',
        },
    }) as any;

    assert.equal(message.id, 'opt-cmid_translation');
    assert.equal(message.status, 'sending');
    assert.equal(message.sendState, 'queued');
    assert.equal(message.outboxState.status, 'pending');
    assert.equal(message.translation.active.targetLanguage, 'el');
    assert.equal(message.translation.active.sourceText, 'hello');
    assert.equal(message.translation.available[0].translatedText, 'γειά');
});

test('message failure and resend sending transitions keep outbox behavior distinct', () => {
    const failedDead = markMessageFailedById([baseMessage], 'msg-1', { deadOutbox: true })[0] as any;
    assert.equal(failedDead.status, 'failed');
    assert.equal(failedDead.sendState, 'failed');
    assert.equal(failedDead.outboxState.status, 'dead');

    const failedPlain = markMessageFailedById([baseMessage], 'msg-1')[0] as any;
    assert.equal(failedPlain.status, 'failed');
    assert.equal(failedPlain.sendState, 'failed');
    assert.equal(failedPlain.outboxState.status, 'pending');

    const sending = markMessageSendingById([failedPlain], 'msg-1')[0] as any;
    assert.equal(sending.status, 'sending');
    assert.equal(sending.sendState, 'queued');
});

test('text send ack applies queued, degraded, and fallback states by correlation', () => {
    const queued = applySendAckByCorrelation([baseMessage], {
        optimisticMessageId: 'msg-1',
        optimisticClientMessageId: 'cmid_1',
        ack: {
            messageId: 'server-1',
            clientMessageId: 'cmid_1',
            outboxJobId: 'job-1',
            queued: true,
            scheduledAt: '2026-05-21T10:00:08.000Z',
            typingDelayMs: 8000,
            typingDelayReason: 'length_based',
        },
    })[0] as any;
    assert.equal(queued.id, 'server-1');
    assert.equal(queued.status, 'sending');
    assert.equal(queued.sendState, 'queued');
    assert.equal(queued.outboxState.status, 'pending');
    assert.equal(queued.outboxState.scheduledAt, '2026-05-21T10:00:08.000Z');
    assert.equal(queued.outboxState.typingDelayMs, 8000);

    const degraded = applySendAckByCorrelation([baseMessage], {
        optimisticMessageId: 'msg-1',
        optimisticClientMessageId: 'cmid_1',
        ack: { outboxJobId: 'job-2', queued: true, queueAccepted: false },
    })[0] as any;
    assert.equal(degraded.status, 'sending');
    assert.equal(degraded.sendState, 'retrying');
    assert.equal(degraded.outboxState.status, 'failed');

    const fallback = applySendAckByCorrelation([baseMessage], {
        optimisticMessageId: 'msg-1',
        optimisticClientMessageId: 'cmid_1',
        ack: { outboxJobId: 'job-3', queued: true, queueAccepted: false, dispatchMode: 'inline_fallback_sent' },
    })[0] as any;
    assert.equal(fallback.status, 'sent');
    assert.equal(fallback.sendState, 'sent');
    assert.equal(fallback.outboxState.status, 'completed');

    const webBridgeFallback = applySendAckByCorrelation([baseMessage], {
        optimisticMessageId: 'msg-1',
        optimisticClientMessageId: 'cmid_1',
        ack: {
            outboxJobId: 'job-4',
            queued: true,
            queueAccepted: false,
            dispatchMode: 'inline_fallback_sent',
            outboxStatus: 'dispatch_accepted',
        },
    })[0] as any;
    assert.equal(webBridgeFallback.status, 'dispatch_accepted');
    assert.equal(webBridgeFallback.sendState, 'queued');
    assert.equal(webBridgeFallback.outboxState.status, 'dispatch_accepted');
});

test('text send ack replaces optimistic body and translation state with server canonical values', () => {
    const optimistic = buildOptimisticTextMessage({
        clientMessageId: 'cmid_translation_ack',
        conversation,
        text: 'English optimistic draft',
        type: 'WhatsApp',
    }) as any;
    const translation = {
        active: {
            targetLanguage: 'el',
            sourceLanguage: 'en',
            sourceText: 'English source',
            translatedText: 'Ελληνικό μήνυμα',
            status: 'completed',
            provider: 'manual_send_preview',
            model: 'manual_send_preview',
            updatedAt: '2026-06-13T10:55:29.946Z',
        },
        available: [],
        viewDefault: 'original',
    };

    const acknowledged = applySendAckByCorrelation([optimistic], {
        optimisticMessageId: optimistic.id,
        optimisticClientMessageId: 'cmid_translation_ack',
        ack: {
            messageId: 'server-greek-1',
            clientMessageId: 'cmid_translation_ack',
            queued: true,
            body: 'Ελληνικό μήνυμα',
            translation,
            translations: [translation.active],
        },
    })[0] as any;

    assert.equal(acknowledged.id, 'server-greek-1');
    assert.equal(acknowledged.body, 'Ελληνικό μήνυμα');
    assert.equal(acknowledged.translation.active.sourceText, 'English source');
    assert.equal(acknowledged.translation.active.translatedText, 'Ελληνικό μήνυμα');
    assert.equal(acknowledged.translations[0].targetLanguage, 'el');
});

test('deriveOutboundWhatsAppUiState maps queued and scheduled states clearly', () => {
    const queued = deriveOutboundWhatsAppUiState(baseMessage as any, { nowMs: Date.parse('2026-05-21T10:00:00.000Z') });
    assert.equal(queued?.label, 'Queued');
    assert.equal(queued?.detail, 'Waiting briefly before sending');
    assert.equal(queued?.showSpinner, true);

    const scheduled = deriveOutboundWhatsAppUiState({
        ...baseMessage,
        outboxState: {
            id: 'job-1',
            status: 'pending',
            scheduledAt: '2026-05-21T10:00:07.000Z',
        },
    } as any, { nowMs: Date.parse('2026-05-21T10:00:00.000Z') });
    assert.equal(scheduled?.label, 'Scheduled');
    assert.equal(scheduled?.detail, 'Scheduled in 7s');
});

test('deriveOutboundWhatsAppUiState maps processing, retrying, failed, sent, delivered, and read', () => {
    assert.equal(deriveOutboundWhatsAppUiState({
        ...baseMessage,
        outboxState: { id: 'job-1', status: 'processing' },
    } as any)?.label, 'Sending');

    const dispatchAccepted = deriveOutboundWhatsAppUiState({
        ...baseMessage,
        status: 'dispatch_accepted',
        outboxState: { id: 'job-1', status: 'dispatch_accepted' },
    } as any);
    assert.equal(dispatchAccepted?.label, 'Sending');
    assert.equal(dispatchAccepted?.detail, 'Waiting for WhatsApp confirmation');

    const unconfirmed = deriveOutboundWhatsAppUiState({
        ...baseMessage,
        status: 'delivery_unconfirmed',
        outboxState: {
            id: 'job-1',
            status: 'delivery_unconfirmed',
            lastError: 'WhatsApp Web dispatch accepted but no delivery ack arrived.',
        },
    } as any);
    assert.equal(unconfirmed?.label, 'Delivery unconfirmed');
    assert.equal(unconfirmed?.canResend, true);

    const retrying = deriveOutboundWhatsAppUiState({
        ...baseMessage,
        outboxState: {
            id: 'job-1',
            status: 'failed',
            scheduledAt: '2026-05-21T10:00:05.000Z',
            attemptCount: 2,
            lastError: 'temporary provider error',
        },
    } as any, { nowMs: Date.parse('2026-05-21T10:00:00.000Z') });
    assert.equal(retrying?.label, 'Retrying');
    assert.equal(retrying?.detail, 'Retrying automatically in 5s');
    assert.equal(retrying?.retryAttempt, 2);

    const failed = deriveOutboundWhatsAppUiState({
        ...baseMessage,
        status: 'failed',
        outboxState: { id: 'job-1', status: 'dead', lastError: 'provider rejected send' },
    } as any);
    assert.equal(failed?.label, 'Failed');
    assert.equal(failed?.canResend, true);

    assert.equal(deriveOutboundWhatsAppUiState({
        ...baseMessage,
        status: 'sent',
        outboxState: { id: 'job-1', status: 'pending' },
    } as any)?.label, 'Sent');
    assert.equal(deriveOutboundWhatsAppUiState({ ...baseMessage, status: 'delivered' } as any)?.label, 'Delivered');
    assert.equal(deriveOutboundWhatsAppUiState({ ...baseMessage, status: 'read' } as any)?.label, 'Read');
});

test('deriveOutboundWhatsAppUiState keeps SMS fallback gated to number-not-on-WhatsApp', () => {
    const fallback = deriveOutboundWhatsAppUiState({
        ...baseMessage,
        status: 'failed',
        outboxState: {
            id: 'job-1',
            status: 'dead',
            lastError: 'phone number is not registered on WhatsApp',
        },
    } as any, {
        smsRelayEnabled: true,
        contactPhone: '+35799306050',
    });
    assert.equal(fallback?.label, 'SMS fallback available');
    assert.equal(fallback?.canSmsFallback, true);
});

test('media ack treats queued as true while resend ack preserves exact outbox replacement', () => {
    const mediaState = getSendAckState({ queueAccepted: false }, 'cmid_media', { media: true });
    assert.equal(mediaState.queued, true);
    assert.equal(mediaState.degradedDelivery, true);

    const resent = applyResendAckById([baseMessage], {
        messageId: 'msg-1',
        clientMessageId: 'cmid_resend',
        ack: { messageId: 'resent-1', clientMessageId: 'cmid_resend', outboxJobId: 'job-resend', queued: false },
    })[0] as any;
    assert.equal(resent.id, 'resent-1');
    assert.equal(resent.status, 'sent');
    assert.equal(resent.sendState, 'sent');
    assert.deepEqual(resent.outboxState, { id: 'job-resend', status: 'completed' });
});

test('normalizeSendError keeps server action reload copy unchanged', () => {
    assert.equal(
        normalizeSendError(new Error('Failed to find Server Action "abc"')),
        'Page updated. Reload and try again.'
    );
    assert.equal(normalizeSendError(''), 'Unknown error occurred');
    assert.equal(normalizeSendError('No route'), 'No route');
});

test('failed WhatsApp number-not-found message shows Android SMS fallback action when available', () => {
    const state = getWhatsAppFailureFallbackUiState({
        message: {
            type: 'TYPE_WHATSAPP',
            direction: 'outbound',
            status: 'failed',
            outboxState: {
                status: 'dead',
                lastError: 'WhatsApp Web send failed. No LID for user',
            },
        },
        smsRelayEnabled: true,
        contactPhone: '+35799306050',
    });

    assert.equal(state.showFailureDetail, true);
    assert.equal(state.label, 'This number is not available on WhatsApp.');
    assert.equal(state.canSendSmsFallback, true);
    assert.equal(state.smsFallbackLabel, 'Retry via Android SMS');
    assert.equal(state.smsFallbackUnavailableLabel, null);
});

test('failed WhatsApp number-not-found message shows unavailable fallback when SMS is unavailable', () => {
    const state = getWhatsAppFailureFallbackUiState({
        message: {
            type: 'TYPE_WHATSAPP',
            direction: 'outbound',
            status: 'failed',
            outboxState: {
                status: 'dead',
                lastError: 'phone number is not registered on WhatsApp',
            },
        },
        smsRelayEnabled: false,
        contactPhone: '+35799306050',
    });

    assert.equal(state.showFailureDetail, true);
    assert.equal(state.canSendSmsFallback, false);
    assert.equal(state.smsFallbackLabel, null);
    assert.equal(state.smsFallbackUnavailableLabel, 'SMS fallback unavailable');
});

test('unknown WhatsApp failure keeps normal retry behavior without SMS fallback action', () => {
    const state = getWhatsAppFailureFallbackUiState({
        message: {
            type: 'TYPE_WHATSAPP',
            direction: 'outbound',
            status: 'failed',
            outboxState: {
                status: 'dead',
                lastError: 'Unexpected provider response',
            },
        },
        smsRelayEnabled: true,
        contactPhone: '+35799306050',
    });

    assert.equal(state.showFailureDetail, false);
    assert.equal(state.canSendSmsFallback, false);
    assert.equal(state.smsFallbackLabel, null);
});
