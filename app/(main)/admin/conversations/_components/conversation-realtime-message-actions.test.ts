import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message } from '@/lib/ghl/conversations';
import {
    appendInboundMessageIfMissing,
    applyRealtimeMessagePatchToMessages,
    buildOptimisticInboundMessage,
    getRealtimeMessageSendState,
    normalizeInboundRealtimePayload,
} from './conversation-realtime-message-actions';

function message(overrides: Partial<Message> & Record<string, unknown>): Message {
    return {
        id: 'msg-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        body: 'hello',
        type: 'WhatsApp',
        direction: 'outbound',
        status: 'sending',
        sendState: 'queued',
        dateAdded: '2026-05-24T00:00:00.000Z',
        attachments: [],
        ...overrides,
    } as Message;
}

test('applyRealtimeMessagePatchToMessages patches by messageId', () => {
    const original = message({ id: 'server-1', clientMessageId: 'cmid-1' });

    const result = applyRealtimeMessagePatchToMessages([original], {
        messageId: 'server-1',
        status: 'sent',
    });

    assert.equal(result.matched, true);
    assert.equal(result.payload.messageId, 'server-1');
    assert.equal(result.messages[0].id, 'server-1');
    assert.equal(result.messages[0].status, 'sent');
    assert.equal((result.messages[0] as any).sendState, 'sent');
});

test('applyRealtimeMessagePatchToMessages patches by clientMessageId', () => {
    const original = message({ id: 'opt-cmid-2', clientMessageId: 'cmid-2' });

    const result = applyRealtimeMessagePatchToMessages([original], {
        messageId: 'server-2',
        clientMessageId: 'cmid-2',
        status: 'sending',
    });

    assert.equal(result.matched, true);
    assert.equal(result.messages[0].id, 'server-2');
    assert.equal((result.messages[0] as any).clientMessageId, 'cmid-2');
    assert.equal(result.messages[0].status, 'sending');
    assert.equal((result.messages[0] as any).sendState, 'sending');
});

test('applyRealtimeMessagePatchToMessages carries outbox state updates', () => {
    const original = message({
        id: 'opt-cmid-2',
        clientMessageId: 'cmid-2',
        outboxState: { id: 'job-old', status: 'pending' },
    });

    const result = applyRealtimeMessagePatchToMessages([original], {
        clientMessageId: 'cmid-2',
        status: 'sending',
        outboxJobId: 'job-2',
        outboxStatus: 'failed',
        scheduledAt: '2026-05-24T10:00:05.000Z',
        attemptCount: 2,
        lastError: 'temporary provider error',
    });

    assert.equal(result.matched, true);
    assert.equal((result.messages[0] as any).outboxState.id, 'job-2');
    assert.equal((result.messages[0] as any).outboxState.status, 'failed');
    assert.equal((result.messages[0] as any).outboxState.scheduledAt, '2026-05-24T10:00:05.000Z');
    assert.equal((result.messages[0] as any).outboxState.attemptCount, 2);
    assert.equal((result.messages[0] as any).outboxState.lastError, 'temporary provider error');
});

test('applyRealtimeMessagePatchToMessages replaces optimistic body and translation state', () => {
    const original = message({
        id: 'opt-cmid-greek',
        clientMessageId: 'cmid-greek',
        body: 'English optimistic draft',
    });
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

    const result = applyRealtimeMessagePatchToMessages([original], {
        messageId: 'server-greek-1',
        clientMessageId: 'cmid-greek',
        body: 'Ελληνικό μήνυμα',
        translation,
        translations: [translation.active],
        status: 'sending',
    });

    assert.equal(result.matched, true);
    assert.equal(result.messages[0].id, 'server-greek-1');
    assert.equal(result.messages[0].body, 'Ελληνικό μήνυμα');
    assert.equal((result.messages[0] as any).translation.active.sourceText, 'English source');
    assert.equal((result.messages[0] as any).translation.active.translatedText, 'Ελληνικό μήνυμα');
    assert.equal((result.messages[0] as any).translations[0].targetLanguage, 'el');
});

test('applyRealtimeMessagePatchToMessages patches by wamId', () => {
    const original = message({ id: 'local-1', wamId: 'wam-1' });

    const result = applyRealtimeMessagePatchToMessages([original], {
        messageId: 'server-3',
        wamId: 'wam-1',
        status: 'delivered',
    });

    assert.equal(result.matched, true);
    assert.equal(result.messages[0].id, 'server-3');
    assert.equal((result.messages[0] as any).wamId, 'wam-1');
    assert.equal(result.messages[0].status, 'delivered');
    assert.equal((result.messages[0] as any).sendState, 'sent');
});

test('applyRealtimeMessagePatchToMessages returns no match when correlation does not match', () => {
    const original = message({ id: 'msg-4', clientMessageId: 'cmid-4', wamId: 'wam-4' });

    const result = applyRealtimeMessagePatchToMessages([original], {
        messageId: 'server-missing',
        clientMessageId: 'cmid-missing',
        wamId: 'wam-missing',
        status: 'failed',
    });

    assert.equal(result.matched, false);
    assert.equal(result.messages[0], original);
    assert.deepEqual(result.messages, [original]);
});

test('getRealtimeMessageSendState preserves realtime status mapping', () => {
    assert.equal(getRealtimeMessageSendState('sending'), 'sending');
    assert.equal(getRealtimeMessageSendState('failed'), 'failed');
    assert.equal(getRealtimeMessageSendState('sent'), 'sent');
    assert.equal(getRealtimeMessageSendState('delivered'), 'sent');
    assert.equal(getRealtimeMessageSendState('read'), 'sent');
});

test('buildOptimisticInboundMessage builds optimistic inbound WhatsApp message with same defaults', () => {
    const payload = normalizeInboundRealtimePayload({
        messageId: 'msg-in-1',
        clientMessageId: 'cmid-in-1',
        wamId: 'wam-in-1',
        body: 'hello inbound',
        createdAt: '2026-05-24T10:00:00.000Z',
    });

    const optimistic = buildOptimisticInboundMessage(payload, 'conv-1');

    assert.deepEqual(optimistic, {
        id: 'msg-in-1',
        wamId: 'wam-in-1',
        clientMessageId: 'cmid-in-1',
        conversationId: 'conv-1',
        contactId: '',
        body: 'hello inbound',
        type: 'WhatsApp',
        direction: 'inbound',
        status: 'received',
        sendState: 'sent',
        dateAdded: '2026-05-24T10:00:00.000Z',
        attachments: [],
    } as Message);
});

test('normalizeInboundRealtimePayload accepts provider id aliases', () => {
    const payload = normalizeInboundRealtimePayload({
        id: 'msg-alias-1',
        providerMessageId: 'wam-alias-1',
        client_message_id: 'cmid-alias-1',
        body: 'hello aliases',
        createdAt: '2026-05-24T10:00:00.000Z',
    });

    assert.deepEqual(payload, {
        messageId: 'msg-alias-1',
        wamId: 'wam-alias-1',
        clientMessageId: 'cmid-alias-1',
        body: 'hello aliases',
        createdAt: '2026-05-24T10:00:00.000Z',
    });
});

test('buildOptimisticInboundMessage falls back to wamId when local messageId is absent', () => {
    const payload = normalizeInboundRealtimePayload({
        wamId: 'wam-only-1',
        body: 'hello by provider id',
        createdAt: '2026-05-24T10:00:00.000Z',
    });

    const optimistic = buildOptimisticInboundMessage(payload, 'conv-1');

    assert.equal(optimistic.id, 'wam-only-1');
    assert.equal((optimistic as any).wamId, 'wam-only-1');
    assert.equal(optimistic.conversationId, 'conv-1');
});

test('appendInboundMessageIfMissing skips append when id exists', () => {
    const existing = message({ id: 'msg-in-1', direction: 'inbound' });
    const optimistic = message({ id: 'msg-in-1', direction: 'inbound' });

    const result = appendInboundMessageIfMissing([existing], optimistic, {
        messageId: 'msg-in-1',
        wamId: '',
    });

    assert.deepEqual(result, [existing]);
});

test('appendInboundMessageIfMissing skips append when wamId exists', () => {
    const existing = message({ id: 'msg-existing', direction: 'inbound', wamId: 'wam-in-1' });
    const optimistic = message({ id: 'msg-in-1', direction: 'inbound', wamId: 'wam-in-1' });

    const result = appendInboundMessageIfMissing([existing], optimistic, {
        messageId: 'msg-in-1',
        wamId: 'wam-in-1',
    });

    assert.deepEqual(result, [existing]);
});

test('appendInboundMessageIfMissing skips append when clientMessageId exists', () => {
    const existing = message({ id: 'msg-existing', direction: 'inbound', clientMessageId: 'cmid-in-1' });
    const optimistic = message({ id: 'msg-in-1', direction: 'inbound', clientMessageId: 'cmid-in-1' });

    const result = appendInboundMessageIfMissing([existing], optimistic, {
        clientMessageId: 'cmid-in-1',
    });

    assert.deepEqual(result, [existing]);
});

test('appendInboundMessageIfMissing appends when missing', () => {
    const existing = message({ id: 'msg-existing', direction: 'inbound', wamId: 'wam-existing' });
    const optimistic = message({ id: 'msg-in-1', direction: 'inbound', wamId: 'wam-in-1' });

    const result = appendInboundMessageIfMissing([existing], optimistic, {
        messageId: 'msg-in-1',
        wamId: 'wam-in-1',
    });

    assert.deepEqual(result, [existing, optimistic]);
});

test('appendInboundMessageIfMissing appends with wamId when messageId is missing', () => {
    const optimistic = message({ id: 'wam-in-1', direction: 'inbound', wamId: 'wam-in-1' });

    const result = appendInboundMessageIfMissing([], optimistic, {
        messageId: '',
        wamId: 'wam-in-1',
    });

    assert.deepEqual(result, [optimistic]);
});

test('appendInboundMessageIfMissing handles missing correlation as not appendable', () => {
    const optimistic = message({ id: '', direction: 'inbound' });

    const result = appendInboundMessageIfMissing([], optimistic, {});

    assert.deepEqual(result, []);
});
