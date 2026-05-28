import assert from 'node:assert/strict';
import test from 'node:test';

import type { Conversation, Message } from '@/lib/ghl/conversations';
import {
    applyResendAckById,
    applySendAckByCorrelation,
    buildOptimisticTextMessage,
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
        ack: { messageId: 'server-1', clientMessageId: 'cmid_1', outboxJobId: 'job-1', queued: true },
    })[0] as any;
    assert.equal(queued.id, 'server-1');
    assert.equal(queued.status, 'sending');
    assert.equal(queued.sendState, 'queued');
    assert.equal(queued.outboxState.status, 'pending');

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
